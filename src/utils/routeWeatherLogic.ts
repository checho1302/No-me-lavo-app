import type { WeatherStation } from '../types/weather';
import { calculateDistanceKm } from './weatherLogic';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface RainZone {
  stationId: string;
  stationName: string;
  locality: string;
  lat: number;
  lng: number;
  radiusKm: number;
  severity: 'active' | 'moderate' | 'light';
  accDayMm: number;
  isRainingNow: boolean;
  weight: number;
}

export interface RouteWeatherEvaluation {
  rainExposureScore: number; // 0 = dry, 100 = heavy/prolonged rain exposure
  wetSegmentsCount: number;
  totalSamples: number;
  wetPercentage: number;
  affectedZones: RainZone[];
  isDry: boolean;
  verdictLabel: string;
}

export interface EvaluatedRouteSummary {
  id: string;
  label: string;
  description: string;
  distanceMeters: number;
  durationMillis: number;
  staticDurationMillis: number;
  trafficDelayMin: number;
  weather: RouteWeatherEvaluation;
  isBypassDetour: boolean;
}

/**
 * Extracts active & recent wet rain zones from live meteorological stations.
 * Stations actively raining right now get higher radius and hazard weight;
 * stations with significant daily accumulation (>= 2.0 mm) mark wet corridors/puddle risk.
 */
export function extractRainZones(stations: WeatherStation[]): RainZone[] {
  const zones: RainZone[] = [];

  for (const st of stations) {
    if (st.status === 'maintenance') continue;
    const r = st.latestReading;
    const accDay = r.accDayMm ?? 0;
    const currentRain = r.rainfallMmH ?? 0;
    const isRainingNow = Boolean(r.isRainingNow) || currentRain >= 0.3;

    if (!isRainingNow && accDay < 1.5) continue;

    let severity: RainZone['severity'] = 'light';
    let radiusKm = 1.3;
    let weight = 1.0;

    if (isRainingNow || accDay >= 10) {
      severity = 'active';
      radiusKm = isRainingNow ? 2.1 : 1.8;
      weight = isRainingNow ? 3.0 : 2.2;
    } else if (accDay >= 4) {
      severity = 'moderate';
      radiusKm = 1.6;
      weight = 1.6;
    }

    zones.push({
      stationId: st.id,
      stationName: st.name,
      locality: st.locality,
      lat: st.latitude,
      lng: st.longitude,
      radiusKm,
      severity,
      accDayMm: accDay,
      isRainingNow,
      weight,
    });
  }

  return zones;
}

/**
 * Downsamples a decoded route path evenly to keep geospatial checks fast & accurate.
 */
export function sampleRoutePath(path: LatLngPoint[], maxSamples = 60): LatLngPoint[] {
  if (path.length <= maxSamples) return path;
  const sampled: LatLngPoint[] = [];
  const step = (path.length - 1) / (maxSamples - 1);
  for (let i = 0; i < maxSamples; i++) {
    const idx = Math.round(i * step);
    sampled.push(path[Math.min(idx, path.length - 1)]);
  }
  return sampled;
}

/**
 * Scores a candidate route polyline against all live rain zones.
 */
export function evaluateRouteRainExposure(
  path: LatLngPoint[],
  rainZones: RainZone[]
): RouteWeatherEvaluation {
  if (path.length === 0 || rainZones.length === 0) {
    return {
      rainExposureScore: 0,
      wetSegmentsCount: 0,
      totalSamples: path.length,
      wetPercentage: 0,
      affectedZones: [],
      isDry: true,
      verdictLabel: 'Ruta seca · Sin lluvia en el recorrido',
    };
  }

  const samples = sampleRoutePath(path, 60);
  let wetSamples = 0;
  let weightedSum = 0;
  const hitZoneIds = new Set<string>();
  const affectedZones: RainZone[] = [];

  for (const pt of samples) {
    let sampleWeight = 0;
    for (const zone of rainZones) {
      const distKm = calculateDistanceKm(
        { latitude: pt.lat, longitude: pt.lng },
        { latitude: zone.lat, longitude: zone.lng }
      );
      if (distKm <= zone.radiusKm) {
        const proximityFactor = 1 - (distKm / zone.radiusKm) * 0.45;
        sampleWeight = Math.max(sampleWeight, zone.weight * proximityFactor);
        if (!hitZoneIds.has(zone.stationId)) {
          hitZoneIds.add(zone.stationId);
          affectedZones.push(zone);
        }
      }
    }
    if (sampleWeight > 0) {
      wetSamples += 1;
      weightedSum += sampleWeight;
    }
  }

  const wetPercentage = Math.round((wetSamples / samples.length) * 100);
  const rawScore = (weightedSum / samples.length) * 55 + affectedZones.length * 6;
  const rainExposureScore = Math.min(100, Math.round(rawScore));

  // Sort affected zones: actively raining & highest daily accumulation first
  affectedZones.sort((a, b) => {
    if (a.isRainingNow !== b.isRainingNow) return a.isRainingNow ? -1 : 1;
    return b.accDayMm - a.accDayMm;
  });

  const isDry = rainExposureScore === 0;
  let verdictLabel = 'Ruta seca · Sin lluvia detectada';
  if (!isDry) {
    const primaryLoc = affectedZones[0]?.locality ?? 'la zona';
    if (rainExposureScore >= 40) {
      verdictLabel = `Cruza lluvia activa en ${primaryLoc}`;
    } else if (rainExposureScore >= 18) {
      verdictLabel = `Lluvia moderada cerca de ${primaryLoc}`;
    } else {
      verdictLabel = `Tramo húmedo leve por ${primaryLoc}`;
    }
  }

  return {
    rainExposureScore,
    wetSegmentsCount: wetSamples,
    totalSamples: samples.length,
    wetPercentage,
    affectedZones,
    isDry,
    verdictLabel,
  };
}

/**
 * Computes a perpendicular lateral bypass waypoint around the wet centroid along a route,
 * steering away from the rain cluster toward the drier side of the corridor.
 */
export function computeDryBypassWaypoint(
  origin: LatLngPoint,
  destination: LatLngPoint,
  affectedZones: RainZone[],
  allRainZones: RainZone[]
): LatLngPoint | null {
  if (affectedZones.length === 0) return null;

  const tripDistKm = calculateDistanceKm(
    { latitude: origin.lat, longitude: origin.lng },
    { latitude: destination.lat, longitude: destination.lng }
  );
  if (tripDistKm < 1.5 || tripDistKm > 90) return null;

  // Compute centroid of the rain zones hit by the direct route
  const wetLat = affectedZones.reduce((acc, z) => acc + z.lat, 0) / affectedZones.length;
  const wetLng = affectedZones.reduce((acc, z) => acc + z.lng, 0) / affectedZones.length;

  // Direction vector from origin to destination
  const dLat = destination.lat - origin.lat;
  const dLng = destination.lng - origin.lng;
  const norm = Math.hypot(dLat, dLng);
  if (norm < 1e-5) return null;

  // Two unit perpendicular vectors in degree space (~111 km per degree)
  const perpA = { lat: -dLng / norm, lng: dLat / norm };
  const perpB = { lat: dLng / norm, lng: -dLat / norm };

  // Offset distance scales gently with trip distance (2.6 km to 4.5 km)
  const offsetKm = Math.min(4.5, Math.max(2.6, tripDistKm * 0.25));
  const offsetDeg = offsetKm / 111.0;

  const candidateA: LatLngPoint = {
    lat: Number((wetLat + perpA.lat * offsetDeg).toFixed(5)),
    lng: Number((wetLng + perpA.lng * offsetDeg).toFixed(5)),
  };
  const candidateB: LatLngPoint = {
    lat: Number((wetLat + perpB.lat * offsetDeg).toFixed(5)),
    lng: Number((wetLng + perpB.lng * offsetDeg).toFixed(5)),
  };

  // Pick whichever side has greater clearance from ALL rain zones
  const clearance = (pt: LatLngPoint) => {
    if (allRainZones.length === 0) return 999;
    return Math.min(
      ...allRainZones.map(
        (z) =>
          calculateDistanceKm(
            { latitude: pt.lat, longitude: pt.lng },
            { latitude: z.lat, longitude: z.lng }
          ) - z.radiusKm
      )
    );
  };

  return clearance(candidateA) >= clearance(candidateB) ? candidateA : candidateB;
}

/**
 * Calculates traffic delay in whole minutes from live duration vs static free-flow duration.
 */
export function computeTrafficDelayMin(durationMillis: number, staticDurationMillis?: number): number {
  if (!staticDurationMillis || staticDurationMillis <= 0) return 0;
  const diffMs = durationMillis - staticDurationMillis;
  return diffMs > 60_000 ? Math.round(diffMs / 60_000) : 0;
}

/**
 * Ranks candidate routes either prioritizing avoiding rain (default for "No me lavo")
 * or prioritizing fastest live-traffic ETA.
 */
export function rankRoutes<T extends { durationMillis: number; weather: RouteWeatherEvaluation }>(
  routes: T[],
  avoidRain: boolean
): T[] {
  return [...routes].sort((a, b) => {
    if (avoidRain) {
      // Strongly prefer drier routes unless the detour adds extreme time (>25 min)
      const scoreA = a.weather.rainExposureScore * 1.4 + a.durationMillis / 60_000;
      const scoreB = b.weather.rainExposureScore * 1.4 + b.durationMillis / 60_000;
      if (Math.abs(scoreA - scoreB) > 1) return scoreA - scoreB;
    }
    return a.durationMillis - b.durationMillis;
  });
}

/**
 * Formats duration in milliseconds into concise Spanish travel time (e.g., "24 min", "1 h 12 min").
 */
export function formatDurationEs(durationMillis: number): string {
  const totalMin = Math.max(1, Math.round(durationMillis / 60_000));
  if (totalMin < 60) return `${totalMin} min`;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hrs} h ${mins} min` : `${hrs} h`;
}

/**
 * Formats meters into concise Spanish distance (e.g., "850 m", "8.4 km").
 */
export function formatDistanceEs(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
