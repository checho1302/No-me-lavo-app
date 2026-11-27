import React, { useEffect, useRef } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import type { WeatherStation } from '../types/weather';
import {
  computeDryBypassWaypoint,
  computeTrafficDelayMin,
  evaluateRouteRainExposure,
  extractRainZones,
  rankRoutes,
  type LatLngPoint,
  type RainZone,
  type RouteWeatherEvaluation,
} from '../utils/routeWeatherLogic';

export type NavTravelMode = 'DRIVING' | 'TWO_WHEELER' | 'BICYCLING' | 'WALKING';

export interface NavStep {
  instruction: string;
  distanceMeters: number;
  startLocation: LatLngPoint | null;
}

export interface ComputedNavRoute {
  id: string;
  description: string;
  distanceMeters: number;
  durationMillis: number;
  staticDurationMillis: number;
  trafficDelayMin: number;
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
  stations: WeatherStation[];
  selectedRouteId: string | null;
  onRoutesComputed: (routes: ComputedNavRoute[], activeId: string | null) => void;
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

// Safely extracts plain LatLngPoint array from Routes JS SDK route object
function extractPathPoints(rawRoute: any): LatLngPoint[] {
  const pts: LatLngPoint[] = [];
  if (Array.isArray(rawRoute?.path) && rawRoute.path.length > 0) {
    for (const p of rawRoute.path) {
      if (typeof p?.lat === 'function' && typeof p?.lng === 'function') {
        pts.push({ lat: p.lat(), lng: p.lng() });
      } else if (typeof p?.lat === 'number' && typeof p?.lng === 'number') {
        pts.push({ lat: p.lat, lng: p.lng });
      }
    }
    if (pts.length > 0) return pts;
  }

  // Fallback: collect points from legs/steps if path is nested
  const legs = Array.isArray(rawRoute?.legs) ? rawRoute.legs : [];
  for (const leg of legs) {
    if (Array.isArray(leg?.path)) {
      for (const p of leg.path) {
        if (typeof p?.lat === 'function') pts.push({ lat: p.lat(), lng: p.lng() });
        else if (typeof p?.lat === 'number') pts.push({ lat: p.lat, lng: p.lng });
      }
    }
  }
  return pts;
}

function extractNavSteps(rawRoute: any): NavStep[] {
  const steps: NavStep[] = [];
  const legs = Array.isArray(rawRoute?.legs) ? rawRoute.legs : [];
  for (const leg of legs) {
    const rawSteps = Array.isArray(leg?.steps) ? leg.steps : [];
    for (const st of rawSteps) {
      const text =
        st?.instructions ||
        st?.navigationInstruction?.instructions ||
        'Continúa por la vía principal';
      const dist = Number(st?.distanceMeters ?? 0);
      const start = st?.startLocation;
      let startLoc: LatLngPoint | null = null;
      if (start && typeof start.lat === 'function' && typeof start.lng === 'function') {
        startLoc = { lat: start.lat(), lng: start.lng() };
      } else if (start && typeof start.lat === 'number' && typeof start.lng === 'number') {
        startLoc = { lat: start.lat, lng: start.lng };
      }
      steps.push({
        instruction: String(text),
        distanceMeters: dist,
        startLocation: startLoc,
      });
    }
  }
  return steps;
}

function parseDurationMs(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const match = val.match(/^(\d+(?:\.\d+)?)s$/);
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return 0;
}

export const WazeRouteController: React.FC<WazeRouteControllerProps> = ({
  origin,
  destination,
  travelMode,
  avoidRain,
  stations,
  selectedRouteId,
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

  const clearDrawn = () => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    rainCirclesRef.current.forEach((c) => c.setMap(null));
    rainCirclesRef.current = [];
  };

  // Compute live traffic-aware routes + automatic dry bypass detour when needed
  useEffect(() => {
    if (!map || !routesLib || !destination) {
      clearDrawn();
      computedRoutesRef.current = [];
      onRoutesComputed([], null);
      onRouteError(null);
      return;
    }

    let cancelled = false;
    onRouteLoading(true);
    onRouteError(null);

    const rainZones: RainZone[] = extractRainZones(stations);
    const RouteClass = (routesLib as unknown as { Route: any }).Route;

    const buildRequest = (intermediates?: Array<{ location: LatLngPoint; via: boolean }>) => {
      const req: Record<string, unknown> = {
        origin,
        destination,
        travelMode,
        computeAlternativeRoutes: !intermediates,
        fields: [
          'path',
          'distanceMeters',
          'durationMillis',
          'staticDurationMillis',
          'viewport',
          'legs',
          'description',
        ],
      };

      if (travelMode === 'DRIVING' || travelMode === 'TWO_WHEELER') {
        req.routingPreference = 'TRAFFIC_AWARE';
      }
      if (intermediates && intermediates.length > 0) {
        req.intermediates = intermediates;
      }
      return req;
    };

    const normalizeRoute = (raw: any, id: string, isBypassDetour: boolean): ComputedNavRoute => {
      const path = extractPathPoints(raw);
      const durationMillis = parseDurationMs(raw?.durationMillis ?? raw?.duration);
      const staticDurationMillis = parseDurationMs(raw?.staticDurationMillis ?? raw?.staticDuration);
      const trafficDelayMin = computeTrafficDelayMin(durationMillis, staticDurationMillis);
      const weather = evaluateRouteRainExposure(path, rainZones);
      return {
        id,
        description:
          raw?.description ||
          (isBypassDetour ? 'Desvío evitando lluvia' : 'Ruta principal'),
        distanceMeters: Number(raw?.distanceMeters ?? 0),
        durationMillis,
        staticDurationMillis,
        trafficDelayMin,
        weather,
        isBypassDetour,
        path,
        steps: extractNavSteps(raw),
        viewport: raw?.viewport ?? null,
      };
    };

    (async () => {
      try {
        const primaryRes = await RouteClass.computeRoutes(buildRequest());
        if (cancelled) return;

        const rawRoutes: any[] = Array.isArray(primaryRes?.routes) ? primaryRes.routes : [];
        if (rawRoutes.length === 0) {
          computedRoutesRef.current = [];
          onRoutesComputed([], null);
          onRouteError('No encontramos una ruta disponible para ese destino.');
          return;
        }

        const evaluated: ComputedNavRoute[] = rawRoutes.map((r, idx) =>
          normalizeRoute(r, `route-${idx}`, false)
        );

        // If "Evitar lluvia" is enabled and even the driest Google alternative crosses rain,
        // compute a lateral dry-bypass waypoint around the rain cluster and query Routes API.
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
                    true
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
        const bestId = ranked[0]?.id ?? null;
        onRoutesComputed(ranked, bestId);

        // Fit map cleanly around the selected route
        if (ranked[0]?.path.length > 1) {
          const bounds = new google.maps.LatLngBounds();
          ranked[0].path.forEach((pt) => bounds.extend(pt));
          map.fitBounds(bounds, { top: 140, bottom: 260, left: 36, right: 36 });
        } else if (ranked[0]?.viewport) {
          map.fitBounds(ranked[0].viewport);
        }
      } catch (err) {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        if (!cancelled) {
          computedRoutesRef.current = [];
          onRoutesComputed([], null);
          onRouteError('No se pudo calcular la ruta en este momento. Intenta otro destino.');
        }
      } finally {
        if (!cancelled) onRouteLoading(false);
      }
    })();

    return () => {
      cancelled = true;
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
  ]);

  // Draw polylines & active rain-zone hazard circles whenever routes or selection change
  useEffect(() => {
    clearDrawn();
    if (!map || !destination) return;

    const routes = computedRoutesRef.current;
    if (routes.length === 0) return;

    // 1. Highlight active rain zones with soft blue translucent hazard rings so user sees what's avoided
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

    // 2. Draw non-selected alternative routes underneath
    for (const rt of routes) {
      if (rt.id === selectedRouteId || rt.path.length < 2) continue;
      const altLine = new google.maps.Polyline({
        path: rt.path,
        map,
        geodesic: true,
        strokeColor: '#64748B',
        strokeOpacity: 0.65,
        strokeWeight: 6,
        zIndex: 20,
      });
      altLine.addListener('click', () => onSelectRoute(rt.id));
      polylinesRef.current.push(altLine);
    }

    // 3. Draw active selected route on top with crisp Waze-style white border casing
    const active = routes.find((r) => r.id === selectedRouteId) ?? routes[0];
    if (active && active.path.length >= 2) {
      const mainColor = active.weather.isDry
        ? '#059669' // Emerald green = Dry recommended route
        : active.weather.rainExposureScore < 25
          ? '#0284C7' // Waze sky blue = light humidity
          : '#D97706'; // Amber = unavoidable rain on route

      const casing = new google.maps.Polyline({
        path: active.path,
        map,
        geodesic: true,
        strokeColor: '#FFFFFF',
        strokeOpacity: 0.95,
        strokeWeight: 11,
        zIndex: 30,
      });
      const core = new google.maps.Polyline({
        path: active.path,
        map,
        geodesic: true,
        strokeColor: mainColor,
        strokeOpacity: 1,
        strokeWeight: 7,
        zIndex: 31,
      });
      polylinesRef.current.push(casing, core);
    }

    return () => {
      clearDrawn();
    };
  }, [map, destination, selectedRouteId, stations, onSelectRoute]);

  return null;
};
