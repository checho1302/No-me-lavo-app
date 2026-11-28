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

/**
 * Computes initial compass bearing in degrees [0, 360) from point A to point B.
 */
export function computeBearingDeg(from: LatLngPoint, to: LatLngPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

/**
 * Finds the index of the closest point along a polyline path to a live GPS position.
 */
export function findNearestPointIndex(pos: LatLngPoint, path: LatLngPoint[]): number {
  if (path.length === 0) return -1;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = calculateDistanceKm(
      { latitude: pos.lat, longitude: pos.lng },
      { latitude: path[i].lat, longitude: path[i].lng }
    );
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Decides whether a new GPS position has moved far enough from the last computed route origin
 * to justify recalculating the route without spamming the Routes API on minor GPS jitter.
 */
export function shouldRecalculateRouteOrigin(
  previousOrigin: LatLngPoint | null,
  currentPos: LatLngPoint,
  minMoveMeters = 120
): boolean {
  if (!previousOrigin) return true;
  const distKm = calculateDistanceKm(
    { latitude: previousOrigin.lat, longitude: previousOrigin.lng },
    { latitude: currentPos.lat, longitude: currentPos.lng }
  );
  return distKm * 1000 >= minMoveMeters;
}

export interface RouteSpeedSegment {
  speed: 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';
  path: LatLngPoint[];
}

export interface RouteTrafficSummary {
  delayMin: number;
  jamSegmentCount: number;
  slowSegmentCount: number;
  severity: 'fluid' | 'moderate' | 'heavy';
  label: string;
  shortLabel: string;
}

/**
 * Classifies real-time traffic conditions along a route using BOTH Google's live
 * duration vs historical static duration AND live per-segment speed readings (`speedPaths`).
 * Never claims "Tráfico fluido" when live TRAFFIC_JAM or SLOW segments exist on the route.
 */
export function analyzeRouteTraffic(
  durationMillis: number,
  staticDurationMillis: number | undefined,
  speedSegments: RouteSpeedSegment[] = [],
  supportsLiveTraffic = true
): RouteTrafficSummary {
  if (!supportsLiveTraffic) {
    return {
      delayMin: 0,
      jamSegmentCount: 0,
      slowSegmentCount: 0,
      severity: 'fluid',
      label: 'Sin tráfico vehicular',
      shortLabel: 'Ruta directa',
    };
  }

  const delayMin = computeTrafficDelayMin(durationMillis, staticDurationMillis);
  let jamSegmentCount = 0;
  let slowSegmentCount = 0;

  for (const seg of speedSegments) {
    if (seg.speed === 'TRAFFIC_JAM') jamSegmentCount += 1;
    else if (seg.speed === 'SLOW') slowSegmentCount += 1;
  }

  if (delayMin >= 8 || (jamSegmentCount >= 2 && delayMin >= 3)) {
    return {
      delayMin,
      jamSegmentCount,
      slowSegmentCount,
      severity: 'heavy',
      label:
        delayMin > 0
          ? `Tráfico pesado · +${delayMin} min`
          : `Trancón en ${jamSegmentCount} tramos`,
      shortLabel: delayMin > 0 ? `+${delayMin} min trancón` : 'Trancón',
    };
  }

  if (delayMin >= 2 || jamSegmentCount > 0 || slowSegmentCount > 0) {
    const detail =
      delayMin > 0
        ? `+${delayMin} min tráfico`
        : jamSegmentCount > 0
          ? `Trancón en ${jamSegmentCount === 1 ? '1 tramo' : `${jamSegmentCount} tramos`}`
          : 'Tráfico lento en tramo';
    return {
      delayMin,
      jamSegmentCount,
      slowSegmentCount,
      severity: jamSegmentCount > 0 ? 'heavy' : 'moderate',
      label: detail,
      shortLabel: delayMin > 0 ? `+${delayMin} min` : jamSegmentCount > 0 ? 'Trancón' : 'Lento',
    };
  }

  return {
    delayMin: 0,
    jamSegmentCount: 0,
    slowSegmentCount: 0,
    severity: 'fluid',
    label: 'Tráfico fluido',
    shortLabel: 'Fluido',
  };
}

/**
 * Formats estimated arrival clock time in Spanish (e.g., "8:28 p. m.") from real live durationMillis.
 */
export function formatArrivalTimeEs(durationMillis: number, nowMs = Date.now()): string {
  const safeDuration = Math.max(60_000, durationMillis);
  const arrivalDate = new Date(nowMs + safeDuration);
  return arrivalDate.toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Computes remaining real-time duration and distance from the active turn-by-turn step index,
 * preserving Google's live traffic multiplier instead of assuming synthetic fixed speeds.
 */
export function computeRemainingTripMetrics(
  totalDurationMillis: number,
  totalDistanceMeters: number,
  steps: Array<{ distanceMeters: number; durationMillis?: number }>,
  activeStepIdx: number
): { remainingDurationMillis: number; remainingDistanceMeters: number } {
  if (steps.length === 0 || activeStepIdx <= 0) {
    return {
      remainingDurationMillis: totalDurationMillis,
      remainingDistanceMeters: totalDistanceMeters,
    };
  }

  const clampedIdx = Math.min(activeStepIdx, steps.length - 1);
  const remainingSteps = steps.slice(clampedIdx);
  const remainingDist = remainingSteps.reduce((acc, st) => acc + Math.max(0, st.distanceMeters), 0);
  const totalStepDur = steps.reduce((acc, st) => acc + Math.max(0, st.durationMillis ?? 0), 0);
  const remainingStepDur = remainingSteps.reduce((acc, st) => acc + Math.max(0, st.durationMillis ?? 0), 0);

  if (totalStepDur > 0 && remainingStepDur > 0) {
    const ratio = Math.min(1, Math.max(0, remainingStepDur / totalStepDur));
    return {
      remainingDurationMillis: Math.max(60_000, Math.round(totalDurationMillis * ratio)),
      remainingDistanceMeters: remainingDist > 0 ? remainingDist : totalDistanceMeters,
    };
  }

  if (totalDistanceMeters > 0 && remainingDist > 0) {
    const distRatio = Math.min(1, Math.max(0, remainingDist / totalDistanceMeters));
    return {
      remainingDurationMillis: Math.max(60_000, Math.round(totalDurationMillis * distRatio)),
      remainingDistanceMeters: remainingDist,
    };
  }

  return {
    remainingDurationMillis: totalDurationMillis,
    remainingDistanceMeters: totalDistanceMeters,
  };
}

/**
 * Formats how recently live traffic was refreshed.
 */
export function formatLastUpdatedEs(updatedAtMs: number | null, nowMs = Date.now()): string {
  if (!updatedAtMs) return 'En vivo';
  const elapsedSec = Math.max(0, Math.floor((nowMs - updatedAtMs) / 1000));
  if (elapsedSec < 45) return 'Ahora';
  const mins = Math.max(1, Math.round(elapsedSec / 60));
  return `Hace ${mins} min`;
}

export type NavManeuverType =
  | 'DEPART'
  | 'STRAIGHT'
  | 'NAME_CHANGE'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'TURN_SLIGHT_LEFT'
  | 'TURN_SLIGHT_RIGHT'
  | 'TURN_SHARP_LEFT'
  | 'TURN_SHARP_RIGHT'
  | 'UTURN_LEFT'
  | 'UTURN_RIGHT'
  | 'RAMP_LEFT'
  | 'RAMP_RIGHT'
  | 'FORK_LEFT'
  | 'FORK_RIGHT'
  | 'MERGE'
  | 'ROUNDABOUT_LEFT'
  | 'ROUNDABOUT_RIGHT'
  | 'ARRIVE';

export function normalizeManeuver(rawManeuver: unknown, instruction = ''): NavManeuverType {
  const m = String(rawManeuver ?? '').toUpperCase().trim();
  const valid: NavManeuverType[] = [
    'DEPART',
    'STRAIGHT',
    'NAME_CHANGE',
    'TURN_LEFT',
    'TURN_RIGHT',
    'TURN_SLIGHT_LEFT',
    'TURN_SLIGHT_RIGHT',
    'TURN_SHARP_LEFT',
    'TURN_SHARP_RIGHT',
    'UTURN_LEFT',
    'UTURN_RIGHT',
    'RAMP_LEFT',
    'RAMP_RIGHT',
    'FORK_LEFT',
    'FORK_RIGHT',
    'MERGE',
    'ROUNDABOUT_LEFT',
    'ROUNDABOUT_RIGHT',
    'ARRIVE',
  ];
  if (valid.includes(m as NavManeuverType)) {
    return m as NavManeuverType;
  }

  // Fallback inference from Spanish navigation text if API returns MANEUVER_UNSPECIFIED
  const lower = instruction.toLowerCase();
  if (lower.includes('rotonda') || lower.includes('glorieta')) {
    return lower.includes('izquierda') ? 'ROUNDABOUT_LEFT' : 'ROUNDABOUT_RIGHT';
  }
  if (lower.includes('retorno') || lower.includes('vuelta en u') || lower.includes('cambio de sentido')) {
    return lower.includes('derecha') ? 'UTURN_RIGHT' : 'UTURN_LEFT';
  }
  if (lower.includes('ligeramente a la izquierda') || lower.includes('mantente a la izquierda')) {
    return 'TURN_SLIGHT_LEFT';
  }
  if (lower.includes('ligeramente a la derecha') || lower.includes('mantente a la derecha')) {
    return 'TURN_SLIGHT_RIGHT';
  }
  if (lower.includes('izquierda')) return 'TURN_LEFT';
  if (lower.includes('derecha')) return 'TURN_RIGHT';
  if (lower.includes('incorpora')) return 'MERGE';
  return 'STRAIGHT';
}

function cleanRoadText(raw: string): string {
  const firstSegment = raw
    .split(/\n/)[0]
    .split(/\s+durante\s+/i)[0]
    .split(/\s+pasa por\s+/i)[0]
    .split(/\s*\(/)[0]
    .trim();
  // If Google returns slash-separated aliases like "Av. Cdad. de Quito/Ave Cra 30/Av NQS", keep the cleanest primary name
  const parts = firstSegment
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  const chosen = parts[0] ?? firstSegment;
  return chosen.replace(/[.,;:\s]+$/, '').trim();
}

/**
 * Extracts the current road name and target turn road name from a Spanish Google Maps step instruction.
 */
export function extractRoadInfoFromInstruction(
  instruction: string,
  fallbackRoad = ''
): { currentRoad: string; targetRoad: string } {
  const clean = instruction.replace(/\s+/g, ' ').trim();
  const fallback = cleanRoadText(fallbackRoad);

  // Pattern 1: "Dirígete hacia el sureste en Cl. 93a hacia Cra. 11a"
  const departMatch = clean.match(/\ben\s+(.+?)\s+hacia\s+(.+)$/i);
  if (departMatch) {
    return {
      currentRoad: cleanRoadText(departMatch[1]) || fallback,
      targetRoad: cleanRoadText(departMatch[2]) || cleanRoadText(departMatch[1]) || fallback,
    };
  }

  // Pattern 2: "... para incorporarte a Av. Cdad. de Quito/Ave Cra 30"
  const mergeMatch = clean.match(/incorporarte\s+a\s+(.+)$/i);
  if (mergeMatch) {
    const road = cleanRoadText(mergeMatch[1]);
    return { currentRoad: road || fallback, targetRoad: road || fallback };
  }

  // Pattern 3: "... en dirección Av NQS al Sur"
  const dirMatch = clean.match(/en\s+direcci[oó]n\s+(?:a\s+)?(.+)$/i);
  if (dirMatch) {
    const road = cleanRoadText(dirMatch[1]);
    return { currentRoad: road || fallback, targetRoad: road || fallback };
  }

  // Pattern 4: "Continúa por Puente Avenida Carrera 45" / "Mantente a la izquierda para continuar por ..."
  const porMatch = clean.match(/(?:contin[uú]a|sigue|toma)\s+(?:por|la|el)?\s*(.+)$/i);
  if (porMatch) {
    const road = cleanRoadText(porMatch[1].replace(/^(?:por|hacia)\s+/i, ''));
    return { currentRoad: road || fallback, targetRoad: road || fallback };
  }

  // Pattern 5: "Gira a la derecha hacia Cra. 11" / "Gira a la izquierda en Cl. 26" / "Gira ligeramente a la derecha por Av. Boyacá"
  const withoutTurnPhrase = clean.replace(
    /^(?:gira|dobla|mantente|contin[uú]a|sigue|toma\s+la\s+salida)\s+(?:(?:ligeramente|levemente|fuertemente|pronunciadamente)\s+)?(?:a\s+la\s+(?:derecha|izquierda)|en\s+u)\s*/i,
    ''
  );
  const turnPrepMatch = withoutTurnPhrase.match(/\b(?:hacia|en|por|para\s+tomar|a)\s+(.+)$/i);
  if (turnPrepMatch) {
    const road = cleanRoadText(turnPrepMatch[1]);
    return { currentRoad: road || fallback, targetRoad: road || fallback };
  }

  return { currentRoad: fallback || 'Vía principal', targetRoad: fallback || clean };
}

export interface StepBannerDisplay {
  prefix: string;
  primaryRoad: string;
  currentRoad: string;
  actionShort: string;
}

/**
 * Formats a Google Routes step into concise Google Maps / Waze HUD copy:
 * e.g. prefix="hacia", primaryRoad="Cra. 11a", currentRoad="Cl. 93a"
 */
export function parseStepBannerDisplay(
  step: { instruction: string; maneuver: NavManeuverType },
  fallbackRoad = ''
): StepBannerDisplay {
  const { currentRoad, targetRoad } = extractRoadInfoFromInstruction(step.instruction, fallbackRoad);

  const actionByManeuver: Record<NavManeuverType, { prefix: string; short: string }> = {
    DEPART: { prefix: 'hacia', short: 'Salir' },
    STRAIGHT: { prefix: 'Continúa por', short: 'Recto' },
    NAME_CHANGE: { prefix: 'Sigue por', short: 'Sigue' },
    TURN_LEFT: { prefix: 'Gira a la izquierda hacia', short: 'Izquierda' },
    TURN_RIGHT: { prefix: 'Gira a la derecha hacia', short: 'Derecha' },
    TURN_SLIGHT_LEFT: { prefix: 'Mantente a la izquierda hacia', short: 'Izq. suave' },
    TURN_SLIGHT_RIGHT: { prefix: 'Mantente a la derecha hacia', short: 'Der. suave' },
    TURN_SHARP_LEFT: { prefix: 'Giro cerrado a la izquierda', short: 'Izq. cerrada' },
    TURN_SHARP_RIGHT: { prefix: 'Giro cerrado a la derecha', short: 'Der. cerrada' },
    UTURN_LEFT: { prefix: 'Retorno en U hacia', short: 'Retorno U' },
    UTURN_RIGHT: { prefix: 'Retorno en U hacia', short: 'Retorno U' },
    RAMP_LEFT: { prefix: 'Toma el ramal izq. hacia', short: 'Ramal izq.' },
    RAMP_RIGHT: { prefix: 'Toma el ramal der. hacia', short: 'Ramal der.' },
    FORK_LEFT: { prefix: 'Bifurcación izq. hacia', short: 'Izquierda' },
    FORK_RIGHT: { prefix: 'Bifurcación der. hacia', short: 'Derecha' },
    MERGE: { prefix: 'Incorpórate a', short: 'Incorporar' },
    ROUNDABOUT_LEFT: { prefix: 'Glorieta a la izquierda', short: 'Glorieta' },
    ROUNDABOUT_RIGHT: { prefix: 'Glorieta a la derecha', short: 'Glorieta' },
    ARRIVE: { prefix: 'Llegada a', short: 'Llegada' },
  };

  const info = actionByManeuver[step.maneuver] ?? { prefix: 'hacia', short: 'Sigue' };
  return {
    prefix: info.prefix,
    primaryRoad: targetRoad || currentRoad || step.instruction,
    currentRoad: currentRoad || fallbackRoad || 'Vía actual',
    actionShort: info.short,
  };
}

/**
 * Matches a live GPS coordinate to the closest active step along the route so the
 * road name pill and turn banner advance automatically while driving.
 */
export function findCurrentStepIndexForGps(
  livePos: LatLngPoint,
  steps: Array<{ startLocation: LatLngPoint | null; path?: LatLngPoint[] }>
): number {
  if (steps.length === 0) return 0;
  let bestIdx = 0;
  let bestDistKm = Infinity;

  for (let i = 0; i < steps.length; i++) {
    const pts =
      steps[i].path && steps[i].path!.length > 0
        ? steps[i].path!
        : steps[i].startLocation
          ? [steps[i].startLocation!]
          : [];
    for (const pt of pts) {
      const d = calculateDistanceKm(
        { latitude: livePos.lat, longitude: livePos.lng },
        { latitude: pt.lat, longitude: pt.lng }
      );
      if (d < bestDistKm) {
        bestDistKm = d;
        bestIdx = i;
      }
    }
  }

  return bestIdx;
}

/**
 * Maps real device GPS coordinates to the nearest known Colombian locality when within range,
 * or returns a neutral live GPS label when the user is outside catalog coverage.
 */
export function resolveLocalityLabelForGps(
  latitude: number,
  longitude: number,
  localities: Array<{ name: string; city: string; latitude: number; longitude: number }>,
  maxMatchKm = 25
): { locality: string; city: string } {
  let closest: { name: string; city: string; dist: number } | null = null;
  for (const loc of localities) {
    const dist = calculateDistanceKm(
      { latitude, longitude },
      { latitude: loc.latitude, longitude: loc.longitude }
    );
    if (!closest || dist < closest.dist) {
      closest = { name: loc.name, city: loc.city, dist };
    }
  }
  if (closest && closest.dist <= maxMatchKm) {
    return { locality: closest.name, city: closest.city };
  }
  return { locality: 'Mi ubicación GPS', city: 'En vivo' };
}

/**
 * Projects a geographic coordinate `distanceMeters` ahead along `headingDeg` (0° = North, 90° = East).
 * Used in Waze-style driving mode so the camera looks ahead along the route and places the vehicle
 * cursor cleanly centered in the lower third of the screen right above the street name pill.
 */
export function offsetCenterAhead(
  origin: LatLngPoint,
  headingDeg: number,
  distanceMeters: number
): LatLngPoint {
  if (!Number.isFinite(distanceMeters) || distanceMeters === 0) {
    return origin;
  }
  const earthRadiusM = 6_371_000;
  const angularDist = distanceMeters / earthRadiusM;
  const bearingRad = (headingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angularDist) +
    Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearingRad);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));

  const y = Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(lat1);
  const x = Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2);
  const lng2 = lng1 + Math.atan2(y, x);

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  };
}

/**
 * Computes screen-space rotation angle (0..360°) for the vehicle cursor arrow relative to the map's
 * current heading so it points straight UP (0°) in heading-up 3D navigation and stays accurate in 2D.
 */
export function computeRelativeArrowRotation(
  travelHeadingDeg: number,
  mapHeadingDeg: number
): number {
  if (!Number.isFinite(travelHeadingDeg)) return 0;
  const safeMapHeading = Number.isFinite(mapHeadingDeg) ? mapHeadingDeg : 0;
  return ((travelHeadingDeg - safeMapHeading) % 360 + 360) % 360;
}

export interface TimedGpsFix {
  lat: number;
  lng: number;
  timestampMs: number;
}

/**
 * Computes live travel speed in km/h from real mobile GPS telemetry:
 * 1. Uses native `position.coords.speed` (m/s) when available from device GPS hardware.
 * 2. Falls back to Haversine distance / delta time between consecutive fixes when `coords.speed` is null.
 * Filters stationary GPS jitter (< 6 m or < 1.8 km/h) cleanly to 0 km/h.
 */
export function computeGpsSpeedKmh(
  coordsSpeedMps: number | null | undefined,
  prevFix: TimedGpsFix | null,
  currFix: TimedGpsFix,
  prevSpeedKmh: number | null = null
): number {
  if (typeof coordsSpeedMps === 'number' && Number.isFinite(coordsSpeedMps) && coordsSpeedMps >= 0) {
    const rawKmh = coordsSpeedMps * 3.6;
    if (rawKmh < 1.8) return 0;
    return Math.min(220, Math.round(rawKmh));
  }

  if (!prevFix) {
    return 0;
  }

  const deltaSec = (currFix.timestampMs - prevFix.timestampMs) / 1000;
  if (deltaSec < 0.8 || deltaSec > 30) {
    return 0;
  }

  const distKm = calculateDistanceKm(
    { latitude: prevFix.lat, longitude: prevFix.lng },
    { latitude: currFix.lat, longitude: currFix.lng }
  );
  const distMeters = distKm * 1000;
  if (distMeters < 6) {
    return 0;
  }

  const computedKmh = distKm / (deltaSec / 3600);
  if (!Number.isFinite(computedKmh) || computedKmh < 1.8 || computedKmh > 220) {
    return 0;
  }

  if (typeof prevSpeedKmh === 'number' && Number.isFinite(prevSpeedKmh) && prevSpeedKmh > 0) {
    return Math.min(220, Math.round(computedKmh * 0.7 + prevSpeedKmh * 0.3));
  }

  return Math.min(220, Math.round(computedKmh));
}
