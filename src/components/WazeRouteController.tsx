import React, { useEffect, useRef, useState } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import type { WeatherStation } from '../types/weather';
import {
  analyzeRouteTraffic,
  computeDryBypassWaypoint,
  evaluateRouteRainExposure,
  extractRainZones,
  normalizeManeuver,
  parseStepBannerDisplay,
  rankRoutes,
  type LatLngPoint,
  type NavManeuverType,
  type RainZone,
  type RouteSpeedSegment,
  type RouteTrafficSummary,
  type RouteWeatherEvaluation,
} from '../utils/routeWeatherLogic';

export type NavTravelMode = 'DRIVING' | 'TWO_WHEELER' | 'BICYCLING' | 'WALKING';

export interface NavStep {
  instruction: string;
  maneuver: NavManeuverType;
  bannerPrefix: string;
  primaryRoad: string;
  currentRoad: string;
  actionShort: string;
  distanceMeters: number;
  durationMillis: number;
  startLocation: LatLngPoint | null;
  path: LatLngPoint[];
}

export interface ComputedNavRoute {
  id: string;
  description: string;
  distanceMeters: number;
  durationMillis: number;
  staticDurationMillis: number;
  localizedDuration: string | null;
  trafficDelayMin: number;
  traffic: RouteTrafficSummary;
  speedSegments: RouteSpeedSegment[];
  trafficUpdatedAt: number;
  weather: RouteWeatherEvaluation;
  isBypassDetour: boolean;
  path: LatLngPoint[];
  steps: NavStep[];
  viewport?: google.maps.LatLngBounds | null;
}

interface WazeRouteControllerProps {
  origin: LatLngPoint;
  destination: LatLngPoint | null;
  travelMode: NavTravelMode;
  avoidRain: boolean;
  showTraffic: boolean;
  stations: WeatherStation[];
  selectedRouteId: string | null;
  trafficRefreshNonce: number;
  onRoutesComputed: (routes: ComputedNavRoute[], activeId: string | null, isBackgroundRefresh?: boolean) => void;
  onRouteLoading: (loading: boolean) => void;
  onRouteError: (error: string | null) => void;
  onSelectRoute: (routeId: string) => void;
}

function isQuotaError(err: unknown): boolean {
  const msg = String(err ?? '');
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('QuotaExceeded') ||
    msg.includes('429')
  );
}

function toLatLngPoint(p: any): LatLngPoint | null {
  if (!p) return null;
  if (typeof p.lat === 'function' && typeof p.lng === 'function') {
    return { lat: p.lat(), lng: p.lng() };
  }
  if (typeof p.lat === 'number' && typeof p.lng === 'number') {
    return { lat: p.lat, lng: p.lng };
  }
  return null;
}

// Safely extracts plain LatLngPoint array from Routes JS SDK route object
function extractPathPoints(rawRoute: any): LatLngPoint[] {
  const pts: LatLngPoint[] = [];
  if (Array.isArray(rawRoute?.path) && rawRoute.path.length > 0) {
    for (const p of rawRoute.path) {
      const pt = toLatLngPoint(p);
      if (pt) pts.push(pt);
    }
    if (pts.length > 0) return pts;
  }

  // Fallback: collect points from legs if top-level path is absent
  const legs = Array.isArray(rawRoute?.legs) ? rawRoute.legs : [];
  for (const leg of legs) {
    if (Array.isArray(leg?.path)) {
      for (const p of leg.path) {
        const pt = toLatLngPoint(p);
        if (pt) pts.push(pt);
      }
    }
  }
  return pts;
}

function extractSpeedSegments(rawRoute: any): RouteSpeedSegment[] {
  const segments: RouteSpeedSegment[] = [];
  const rawSpeedPaths = Array.isArray(rawRoute?.speedPaths) ? rawRoute.speedPaths : [];
  for (const sp of rawSpeedPaths) {
    const speedRaw = String(sp?.speed ?? 'NORMAL').toUpperCase();
    const speed: RouteSpeedSegment['speed'] =
      speedRaw === 'TRAFFIC_JAM'
        ? 'TRAFFIC_JAM'
        : speedRaw === 'SLOW'
          ? 'SLOW'
          : 'NORMAL';
    const path: LatLngPoint[] = [];
    if (Array.isArray(sp?.path)) {
      for (const p of sp.path) {
        const pt = toLatLngPoint(p);
        if (pt) path.push(pt);
      }
    }
    if (path.length >= 2) {
      segments.push({ speed, path });
    }
  }
  return segments;
}

function parseDurationMs(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const match = val.match(/^(\d+(?:\.\d+)?)s$/);
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return 0;
}

function extractNavSteps(rawRoute: any, fallbackRoad = ''): NavStep[] {
  const steps: NavStep[] = [];
  const legs = Array.isArray(rawRoute?.legs) ? rawRoute.legs : [];
  let runningRoad = fallbackRoad;

  for (const leg of legs) {
    const rawSteps = Array.isArray(leg?.steps) ? leg.steps : [];
    for (const st of rawSteps) {
      const text = String(
        st?.instructions ||
          st?.navigationInstruction?.instructions ||
          'Continúa por la vía principal'
      );
      const rawManeuver = st?.maneuver ?? st?.navigationInstruction?.maneuver;
      const maneuver = normalizeManeuver(rawManeuver, text);
      const banner = parseStepBannerDisplay({ instruction: text, maneuver }, runningRoad || fallbackRoad);
      if (banner.currentRoad) {
        runningRoad = banner.currentRoad;
      }

      const dist = Number(st?.distanceMeters ?? 0);
      const dur = parseDurationMs(
        st?.durationMillis ?? st?.duration ?? st?.staticDurationMillis ?? st?.staticDuration
      );

      const stepPath: LatLngPoint[] = [];
      if (Array.isArray(st?.path)) {
        for (const p of st.path) {
          const pt = toLatLngPoint(p);
          if (pt) stepPath.push(pt);
        }
      }

      steps.push({
        instruction: text,
        maneuver,
        bannerPrefix: banner.prefix,
        primaryRoad: banner.primaryRoad,
        currentRoad: banner.currentRoad,
        actionShort: banner.actionShort,
        distanceMeters: dist,
        durationMillis: dur,
        startLocation: toLatLngPoint(st?.startLocation) ?? stepPath[0] ?? null,
        path: stepPath,
      });
    }
  }
  return steps;
}

function sumLegsDurationMs(rawRoute: any, field: 'durationMillis' | 'staticDurationMillis'): number {
  const legs = Array.isArray(rawRoute?.legs) ? rawRoute.legs : [];
  let sum = 0;
  for (const leg of legs) {
    sum += parseDurationMs(leg?.[field]);
  }
  return sum;
}

const LIVE_TRAFFIC_REFRESH_INTERVAL_MS = 60_000;

export const WazeRouteController: React.FC<WazeRouteControllerProps> = ({
  origin,
  destination,
  travelMode,
  avoidRain,
  showTraffic,
  stations,
  selectedRouteId,
  trafficRefreshNonce,
  onRoutesComputed,
  onRouteLoading,
  onRouteError,
  onSelectRoute,
}) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const rainCirclesRef = useRef<google.maps.Circle[]>([]);
  const computedRoutesRef = useRef<ComputedNavRoute[]>([]);
  const selectedRouteIdRef = useRef<string | null>(selectedRouteId);
  const autoTickRef = useRef<number | null>(null);
  const [drawVersion, setDrawVersion] = useState(0);

  useEffect(() => {
    selectedRouteIdRef.current = selectedRouteId;
  }, [selectedRouteId]);

  const clearDrawn = () => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    rainCirclesRef.current.forEach((c) => c.setMap(null));
    rainCirclesRef.current = [];
  };

  // Compute real-time TRAFFIC_AWARE_OPTIMAL routes + live speedPaths + 60s auto-refresh
  useEffect(() => {
    if (autoTickRef.current !== null) {
      window.clearInterval(autoTickRef.current);
      autoTickRef.current = null;
    }

    if (!map || !routesLib || !destination) {
      clearDrawn();
      computedRoutesRef.current = [];
      onRoutesComputed([], null, false);
      onRouteError(null);
      return;
    }

    let cancelled = false;
    const supportsLiveTraffic = travelMode === 'DRIVING' || travelMode === 'TWO_WHEELER';
    const rainZones: RainZone[] = extractRainZones(stations);
    const RouteClass = (routesLib as unknown as { Route: any }).Route;

    // Official Google Routes API JS SDK:
    // - TRAFFIC_AWARE_OPTIMAL gives Google Maps app-grade real-time traffic ETA
    // - Omitting departureTime uses Google's live real-time traffic clock now without clock-skew errors
    // - TRAFFIC_ON_POLYLINE + speedPaths returns exact NORMAL/SLOW/TRAFFIC_JAM segments on the route
    const buildRequest = (intermediates?: Array<{ location: LatLngPoint; via: boolean }>) => {
      const fields = [
        'path',
        'distanceMeters',
        'durationMillis',
        'staticDurationMillis',
        'localizedValues',
        'viewport',
        'legs',
        'description',
      ];
      if (supportsLiveTraffic) {
        fields.push('speedPaths', 'travelAdvisory');
      }

      const req: Record<string, unknown> = {
        origin,
        destination,
        travelMode,
        computeAlternativeRoutes: !intermediates,
        fields,
      };

      if (supportsLiveTraffic) {
        req.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
        req.extraComputations = ['TRAFFIC_ON_POLYLINE'];
      }
      if (intermediates && intermediates.length > 0) {
        req.intermediates = intermediates;
      }
      return req;
    };

    const normalizeRoute = (
      raw: any,
      id: string,
      isBypassDetour: boolean,
      updatedAt: number
    ): ComputedNavRoute => {
      const path = extractPathPoints(raw);
      const rawDuration =
        parseDurationMs(raw?.durationMillis ?? raw?.duration) ||
        sumLegsDurationMs(raw, 'durationMillis');
      const rawStatic =
        parseDurationMs(raw?.staticDurationMillis ?? raw?.staticDuration) ||
        sumLegsDurationMs(raw, 'staticDurationMillis') ||
        rawDuration;
      const speedSegments = supportsLiveTraffic ? extractSpeedSegments(raw) : [];
      const traffic = analyzeRouteTraffic(
        rawDuration,
        rawStatic,
        speedSegments,
        supportsLiveTraffic
      );
      const weather = evaluateRouteRainExposure(path, rainZones);
      const localizedDuration =
        typeof raw?.localizedValues?.duration === 'string' && raw.localizedValues.duration.trim()
          ? raw.localizedValues.duration.trim()
          : null;

      const routeDesc =
        raw?.description ||
        (isBypassDetour ? 'Desvío evitando lluvia' : 'Ruta principal');

      return {
        id,
        description: routeDesc,
        distanceMeters: Number(raw?.distanceMeters ?? 0),
        durationMillis: rawDuration,
        staticDurationMillis: rawStatic,
        localizedDuration,
        trafficDelayMin: traffic.delayMin,
        traffic,
        speedSegments,
        trafficUpdatedAt: updatedAt,
        weather,
        isBypassDetour,
        path,
        steps: extractNavSteps(raw, routeDesc),
        viewport: raw?.viewport ?? null,
      };
    };

    const fetchLiveRoutes = async (isBackgroundRefresh: boolean) => {
      if (!isBackgroundRefresh) {
        onRouteLoading(true);
        onRouteError(null);
      }

      try {
        const primaryRes = await RouteClass.computeRoutes(buildRequest());
        if (cancelled) return;

        const rawRoutes: any[] = Array.isArray(primaryRes?.routes) ? primaryRes.routes : [];
        if (rawRoutes.length === 0) {
          if (!isBackgroundRefresh) {
            computedRoutesRef.current = [];
            onRoutesComputed([], null, false);
            onRouteError(
              travelMode === 'BICYCLING'
                ? 'Google Maps no tiene rutas en bicicleta para este tramo. Prueba en Carro, Moto o A pie.'
                : 'No encontramos una ruta disponible para ese destino.'
            );
          }
          return;
        }

        const updatedAt = Date.now();
        const evaluated: ComputedNavRoute[] = rawRoutes.map((r, idx) =>
          normalizeRoute(r, `route-${idx}`, false, updatedAt)
        );

        // If "Evitar lluvia" is enabled and even the driest Google alternative crosses rain,
        // compute a lateral dry-bypass waypoint around the rain cluster with live traffic.
        if (avoidRain) {
          const driestDirect = [...evaluated].sort(
            (a, b) => a.weather.rainExposureScore - b.weather.rainExposureScore
          )[0];

          if (driestDirect && driestDirect.weather.rainExposureScore > 12) {
            const bypassPt = computeDryBypassWaypoint(
              origin,
              destination,
              driestDirect.weather.affectedZones,
              rainZones
            );
            if (bypassPt) {
              try {
                const bypassRes = await RouteClass.computeRoutes(
                  buildRequest([{ location: bypassPt, via: true }])
                );
                if (!cancelled && Array.isArray(bypassRes?.routes) && bypassRes.routes[0]) {
                  const bypassRoute = normalizeRoute(
                    bypassRes.routes[0],
                    'route-dry-bypass',
                    true,
                    updatedAt
                  );
                  if (
                    bypassRoute.weather.rainExposureScore <
                    driestDirect.weather.rainExposureScore
                  ) {
                    evaluated.push(bypassRoute);
                  }
                }
              } catch {
                // Keep direct alternatives if bypass fails
              }
            }
          }
        }

        if (cancelled) return;

        const ranked = rankRoutes(evaluated, avoidRain);
        computedRoutesRef.current = ranked;
        setDrawVersion((v) => v + 1);

        const prevId = selectedRouteIdRef.current;
        const preservedId =
          isBackgroundRefresh && prevId && ranked.some((r) => r.id === prevId)
            ? prevId
            : ranked[0]?.id ?? null;

        onRoutesComputed(ranked, preservedId, isBackgroundRefresh);
      } catch (err) {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        if (!cancelled && !isBackgroundRefresh) {
          computedRoutesRef.current = [];
          onRoutesComputed([], null, false);
          onRouteError('No se pudo calcular la ruta con tráfico en vivo. Intenta otro destino.');
        }
      } finally {
        if (!cancelled && !isBackgroundRefresh) onRouteLoading(false);
      }
    };

    fetchLiveRoutes(false);

    // Keep live traffic ETA & congestion segments fresh every 60s for motorized modes
    if (supportsLiveTraffic) {
      autoTickRef.current = window.setInterval(() => {
        if (!cancelled && document.visibilityState === 'visible') {
          fetchLiveRoutes(true);
        }
      }, LIVE_TRAFFIC_REFRESH_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (autoTickRef.current !== null) {
        window.clearInterval(autoTickRef.current);
        autoTickRef.current = null;
      }
    };
  }, [
    map,
    routesLib,
    origin.lat,
    origin.lng,
    destination?.lat,
    destination?.lng,
    travelMode,
    avoidRain,
    stations.length,
    trafficRefreshNonce,
  ]);

  // Draw polylines, live traffic congestion overlays (SLOW / TRAFFIC_JAM), & rain hazard circles
  useEffect(() => {
    clearDrawn();
    if (!map || !destination) return;

    const routes = computedRoutesRef.current;
    if (routes.length === 0) return;

    // 1. Highlight active rain zones with soft blue translucent hazard rings
    const rainZones = extractRainZones(stations);
    for (const z of rainZones) {
      if (z.severity !== 'active' && z.severity !== 'moderate') continue;
      const circle = new google.maps.Circle({
        map,
        center: { lat: z.lat, lng: z.lng },
        radius: z.radiusKm * 1000,
        strokeColor: z.isRainingNow ? '#0284C7' : '#0EA5E9',
        strokeOpacity: 0.45,
        strokeWeight: 1.5,
        fillColor: '#38BDF8',
        fillOpacity: z.isRainingNow ? 0.16 : 0.08,
        clickable: false,
        zIndex: 10,
      });
      rainCirclesRef.current.push(circle);
    }

    // 2. Draw non-selected alternative routes underneath in subtle neutral slate
    for (const rt of routes) {
      if (rt.id === selectedRouteId || rt.path.length < 2) continue;
      const altCasing = new google.maps.Polyline({
        path: rt.path,
        map,
        geodesic: true,
        strokeColor: '#FFFFFF',
        strokeOpacity: 0.7,
        strokeWeight: 8,
        zIndex: 19,
      });
      const altLine = new google.maps.Polyline({
        path: rt.path,
        map,
        geodesic: true,
        strokeColor: '#94A3B8',
        strokeOpacity: 0.8,
        strokeWeight: 5,
        zIndex: 20,
      });
      altLine.addListener('click', () => onSelectRoute(rt.id));
      polylinesRef.current.push(altCasing, altLine);
    }

    // 3. Draw active selected route on top in distinct Waze-style electric purple (#7C3AED)
    //    + overlay real-time SLOW (amber) and TRAFFIC_JAM (crimson) segments from Google Routes speedPaths
    const active = routes.find((r) => r.id === selectedRouteId) ?? routes[0];
    if (active && active.path.length >= 2) {
      const mainColor =
        active.weather.rainExposureScore >= 25
          ? '#C026D3' // Vivid fuchsia-magenta when unavoidable rain is on the route
          : '#7C3AED'; // Distinct Waze purple for the active route to follow

      const outerShadow = new google.maps.Polyline({
        path: active.path,
        map,
        geodesic: true,
        strokeColor: '#3B0764',
        strokeOpacity: 0.35,
        strokeWeight: 14,
        zIndex: 29,
      });
      const casing = new google.maps.Polyline({
        path: active.path,
        map,
        geodesic: true,
        strokeColor: '#FFFFFF',
        strokeOpacity: 0.98,
        strokeWeight: 11,
        zIndex: 30,
      });
      const core = new google.maps.Polyline({
        path: active.path,
        map,
        geodesic: true,
        strokeColor: mainColor,
        strokeOpacity: 1,
        strokeWeight: 7.5,
        zIndex: 31,
      });
      polylinesRef.current.push(outerShadow, casing, core);

      // Paint real-time traffic slowdowns & jams directly on top of the active route
      if (showTraffic && active.speedSegments.length > 0) {
        for (const seg of active.speedSegments) {
          if (seg.speed === 'NORMAL' || seg.path.length < 2) continue;
          const isJam = seg.speed === 'TRAFFIC_JAM';
          const segLine = new google.maps.Polyline({
            path: seg.path,
            map,
            geodesic: true,
            strokeColor: isJam ? '#DC2626' : '#F59E0B',
            strokeOpacity: 1,
            strokeWeight: 7.5,
            zIndex: isJam ? 33 : 32,
          });
          polylinesRef.current.push(segLine);
        }
      }
    }

    return () => {
      clearDrawn();
    };
  }, [map, destination, selectedRouteId, showTraffic, stations, onSelectRoute, drawVersion]);

  return null;
};

