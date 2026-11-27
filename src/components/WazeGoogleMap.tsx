import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  APIProvider,
  Map as GoogleMap,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  Bike,
  Car,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Compass,
  Crosshair,
  Footprints,
  Info,
  Layers,
  Maximize2,
  Minus,
  Navigation,
  Plus,
  RefreshCw,
  ShieldCheck,
  TrafficCone,
  X,
} from 'lucide-react';
import type { FavoriteLocation, RadarProductsResponse, WeatherStation } from '../types/weather';
import { classifySabDailyAccumulation } from '../utils/weatherLogic';
import {
  computeBearingDeg,
  findNearestPointIndex,
  formatDistanceEs,
  formatDurationEs,
  type LatLngPoint,
} from '../utils/routeWeatherLogic';
import {
  DestinationSearchBar,
  type RouteDestination,
} from './DestinationSearchBar';
import {
  WazeRouteController,
  type ComputedNavRoute,
  type NavTravelMode,
} from './WazeRouteController';

type CameraMode = 'follow' | 'overview' | 'free';

interface WazeGoogleMapProps {
  apiKey: string;
  center: { latitude: number; longitude: number; locality: string; city: string };
  stations: WeatherStation[];
  radar: RadarProductsResponse | null;
  bogotaGeoJson: unknown | null;
  favorites: FavoriteLocation[];
  theme: 'light' | 'dark';
  radarBarOpen: boolean;
  onCloseRadarBar: () => void;
  onRefreshRadar: () => void;
  onSelectStation: (station: WeatherStation) => void;
  onRouteActiveChange: (active: boolean) => void;
  onNavigatingChange?: (navigating: boolean) => void;
}

const SAB_LEGEND_ITEMS = [
  { label: 'Sin lluvias (0.0)', color: '#9CA3AF', stroke: '#374151' },
  { label: 'Bajos (0–10 mm)', color: '#22D3EE', stroke: '#0E7490' },
  { label: 'Moderados (10.1–30 mm)', color: '#84CC16', stroke: '#3F6212' },
  { label: 'Altos (30.1–50 mm)', color: '#F97316', stroke: '#9A3412' },
  { label: 'Muy altos (>50.1 mm)', color: '#9333EA', stroke: '#581C87' },
];

const TRAVEL_MODES: Array<{
  id: NavTravelMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'DRIVING', label: 'Carro', icon: Car },
  { id: 'TWO_WHEELER', label: 'Moto', icon: Navigation },
  { id: 'BICYCLING', label: 'Bici', icon: Bike },
  { id: 'WALKING', label: 'A pie', icon: Footprints },
];

/**
 * Imperative Google Maps layers & Waze-style follow-me camera controller:
 * TrafficLayer, Bogotá 20 Localidades GeoJSON, live IDIGER 1399BOG Weather Radar GroundOverlay,
 * close-up driver follow camera (zoom 17–17.5 + tilt + heading), and overview fitBounds toggle.
 */
const MapOverlaysAndCamera: React.FC<{
  center: { latitude: number; longitude: number; city: string };
  driverPosition: LatLngPoint;
  headingDeg: number;
  activeRoute: ComputedNavRoute | null;
  isNavigating: boolean;
  cameraMode: CameraMode;
  onUserDragMap: () => void;
  radar: RadarProductsResponse | null;
  bogotaGeoJson: unknown | null;
  showTraffic: boolean;
  showRadar: boolean;
  radarOpacity: number;
  theme: 'light' | 'dark';
  recenterNonce: number;
  zoomDelta: { seq: number; delta: number };
}> = ({
  center,
  driverPosition,
  headingDeg,
  activeRoute,
  isNavigating,
  cameraMode,
  onUserDragMap,
  radar,
  bogotaGeoJson,
  showTraffic,
  showRadar,
  radarOpacity,
  theme,
  recenterNonce,
  zoomDelta,
}) => {
  const map = useMap();
  const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null);
  const groundOverlayRef = useRef<google.maps.GroundOverlay | null>(null);
  const dataLoadedRef = useRef(false);
  const lastCityKeyRef = useRef('');

  // Pause auto-follow cleanly if the user drags the map manually
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener('dragstart', () => {
      onUserDragMap();
    });
    return () => {
      listener.remove();
    };
  }, [map, onUserDragMap]);

  // Live Google Traffic Layer
  useEffect(() => {
    if (!map) return;
    if (!trafficLayerRef.current) {
      trafficLayerRef.current = new google.maps.TrafficLayer();
    }
    trafficLayerRef.current.setMap(showTraffic ? map : null);
    return () => {
      trafficLayerRef.current?.setMap(null);
    };
  }, [map, showTraffic]);

  // Bogotá 20 Localidades outline overlay via map.data
  useEffect(() => {
    if (!map || !bogotaGeoJson) return;
    if (!dataLoadedRef.current) {
      try {
        map.data.addGeoJson(bogotaGeoJson as object);
        dataLoadedRef.current = true;
      } catch {
        // Ignore malformed GeoJSON gracefully
      }
    }
    map.data.setStyle({
      strokeColor: theme === 'dark' ? '#94A3B8' : '#334155',
      strokeWeight: 1.2,
      strokeOpacity: 0.55,
      fillColor: '#64748B',
      fillOpacity: 0.02,
      clickable: false,
    });
  }, [map, bogotaGeoJson, theme]);

  // Live IDIGER 1399BOG Radar Reflectivity GroundOverlay
  useEffect(() => {
    if (groundOverlayRef.current) {
      groundOverlayRef.current.setMap(null);
      groundOverlayRef.current = null;
    }
    if (!map || !showRadar || !radar?.idigerRadar?.available) return;

    const { north, south, east, west } = radar.idigerRadar.bounds;
    const cacheKey = radar.idigerRadar.observedAt ?? radar.generatedAt;
    const imageUrl = `${radar.idigerRadar.imageUrl}?t=${encodeURIComponent(cacheKey)}`;

    const overlay = new google.maps.GroundOverlay(
      imageUrl,
      { north, south, east, west },
      { opacity: radarOpacity, clickable: false }
    );
    overlay.setMap(map);
    groundOverlayRef.current = overlay;

    return () => {
      overlay.setMap(null);
    };
  }, [map, showRadar, radar, radarOpacity]);

  // Waze Close-Up Follow-Me Camera when a route is active
  useEffect(() => {
    if (!map || !activeRoute) return;

    if (cameraMode === 'follow') {
      const targetZoom = isNavigating ? 18 : 17;
      map.panTo(driverPosition);
      map.setZoom(targetZoom);
      return;
    }

    if (cameraMode === 'overview') {
      // Frame the entire route only when user explicitly taps "Ver toda la ruta"
      if (activeRoute.path.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        activeRoute.path.forEach((pt) => bounds.extend(pt));
        map.fitBounds(bounds, { top: 135, bottom: 265, left: 36, right: 36 });
      } else if (activeRoute.viewport) {
        map.fitBounds(activeRoute.viewport);
      }
    }
  }, [
    map,
    activeRoute?.id,
    cameraMode,
    isNavigating,
    driverPosition.lat,
    driverPosition.lng,
    recenterNonce,
  ]);

  // Recenter cleanly when city/location changes and no route is active
  useEffect(() => {
    if (!map || activeRoute) return;
    const key = `${center.city}:${center.latitude.toFixed(3)}:${center.longitude.toFixed(3)}`;
    if (lastCityKeyRef.current === key) return;
    lastCityKeyRef.current = key;
    const isBogota = center.city.toLowerCase().includes('bogot');
    const target = isBogota
      ? { lat: 4.635, lng: -74.085 }
      : { lat: center.latitude, lng: center.longitude };
    map.panTo(target);
    map.setZoom(12);
  }, [map, center.latitude, center.longitude, center.city, activeRoute]);

  // Manual recenter button when no route is active
  useEffect(() => {
    if (!map || recenterNonce === 0 || activeRoute) return;
    map.panTo({ lat: center.latitude, lng: center.longitude });
    map.setZoom(14);
  }, [map, recenterNonce, activeRoute, center.latitude, center.longitude]);

  // Manual zoom buttons
  useEffect(() => {
    if (!map || zoomDelta.seq === 0) return;
    const currentZoom = map.getZoom() ?? 12;
    map.setZoom(Math.max(5, Math.min(20, currentZoom + zoomDelta.delta)));
  }, [map, zoomDelta]);

  return null;
};

export const WazeGoogleMap: React.FC<WazeGoogleMapProps> = ({
  apiKey,
  center,
  stations,
  radar,
  bogotaGeoJson,
  favorites,
  theme,
  radarBarOpen,
  onCloseRadarBar,
  onRefreshRadar,
  onSelectStation,
  onRouteActiveChange,
  onNavigatingChange,
}) => {
  const [showTraffic, setShowTraffic] = useState(true);
  const [showRadar, setShowRadar] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(0.72);
  const [showLegend, setShowLegend] = useState(false);

  const [destination, setDestination] = useState<RouteDestination | null>(null);
  const [travelMode, setTravelMode] = useState<NavTravelMode>('DRIVING');
  const [avoidRain, setAvoidRain] = useState(true);
  const [routes, setRoutes] = useState<ComputedNavRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>('follow');

  // Live GPS tracking while routing/navigating
  const [liveGpsPos, setLiveGpsPos] = useState<LatLngPoint | null>(null);
  const [liveGpsHeading, setLiveGpsHeading] = useState<number | null>(null);

  const [recenterNonce, setRecenterNonce] = useState(0);
  const [zoomDelta, setZoomDelta] = useState({ seq: 0, delta: 0 });

  const originPoint: LatLngPoint = useMemo(
    () => ({ lat: center.latitude, lng: center.longitude }),
    [center.latitude, center.longitude]
  );

  const activeRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? routes[0] ?? null,
    [routes, selectedRouteId]
  );

  useEffect(() => {
    onRouteActiveChange(Boolean(destination));
  }, [destination, onRouteActiveChange]);

  useEffect(() => {
    onNavigatingChange?.(isNavigating);
  }, [isNavigating, onNavigatingChange]);

  // Real-time GPS watchPosition during active navigation (gracefully falls back when denied/unavailable)
  useEffect(() => {
    if (!isNavigating || typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLiveGpsPos(null);
      setLiveGpsHeading(null);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const nextPt = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLiveGpsPos(nextPt);
        if (typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading)) {
          setLiveGpsHeading(pos.coords.heading);
        }
      },
      () => {
        // Keep step/origin tracking cleanly without interrupting navigation
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 10000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isNavigating]);

  // Determine the exact live driver position & compass heading along the route
  const { driverPosition, headingDeg } = useMemo(() => {
    // 1. Live GPS position takes priority during active navigation
    if (isNavigating && liveGpsPos) {
      let heading = liveGpsHeading ?? 0;
      if (activeRoute && activeRoute.path.length > 1) {
        const nearestIdx = findNearestPointIndex(liveGpsPos, activeRoute.path);
        const lookAhead = activeRoute.path[Math.min(nearestIdx + 2, activeRoute.path.length - 1)];
        if (lookAhead && (lookAhead.lat !== liveGpsPos.lat || lookAhead.lng !== liveGpsPos.lng)) {
          heading = liveGpsHeading ?? computeBearingDeg(liveGpsPos, lookAhead);
        }
      }
      return { driverPosition: liveGpsPos, headingDeg: heading };
    }

    // 2. Active step position when stepping through turn-by-turn navigation
    if (isNavigating && activeRoute && activeRoute.steps[activeStepIdx]?.startLocation) {
      const stepPos = activeRoute.steps[activeStepIdx].startLocation!;
      const nextStepPos =
        activeRoute.steps[activeStepIdx + 1]?.startLocation ??
        activeRoute.path[activeRoute.path.length - 1] ??
        stepPos;
      const brng =
        nextStepPos.lat !== stepPos.lat || nextStepPos.lng !== stepPos.lng
          ? computeBearingDeg(stepPos, nextStepPos)
          : 0;
      return { driverPosition: stepPos, headingDeg: brng };
    }

    // 3. Starting corridor position oriented along the first stretch of the computed route
    if (activeRoute && activeRoute.path.length > 1) {
      const startPt = activeRoute.path[0];
      const lookAheadPt = activeRoute.path[Math.min(3, activeRoute.path.length - 1)];
      return {
        driverPosition: startPt,
        headingDeg: computeBearingDeg(startPt, lookAheadPt),
      };
    }

    return { driverPosition: originPoint, headingDeg: 0 };
  }, [isNavigating, liveGpsPos, liveGpsHeading, activeRoute, activeStepIdx, originPoint]);

  const handleRoutesComputed = useCallback(
    (computed: ComputedNavRoute[], bestId: string | null) => {
      setRoutes(computed);
      setSelectedRouteId(bestId);
      setActiveStepIdx(0);
      // Immediately center close-up on the user's position along the route (Waze-style)
      if (computed.length > 0) {
        setCameraMode('follow');
        setRecenterNonce((n) => n + 1);
      }
    },
    []
  );

  const handleUserDragMap = useCallback(() => {
    setCameraMode((prev) => (prev === 'follow' ? 'free' : prev));
  }, []);

  const handleClearRoute = () => {
    setDestination(null);
    setRoutes([]);
    setSelectedRouteId(null);
    setRouteError(null);
    setIsNavigating(false);
    setActiveStepIdx(0);
    setCameraMode('follow');
    setLiveGpsPos(null);
    setLiveGpsHeading(null);
  };

  const activeStep = activeRoute?.steps[activeStepIdx] ?? null;

  return (
    <APIProvider
      apiKey={apiKey}
      language="es"
      region="CO"
      libraries={['places', 'routes', 'marker']}
    >
      <div className="fixed inset-0 z-0 overflow-hidden bg-slate-200 dark:bg-[#0B1320]">
        {/* Full-Screen Modern Google Map with Mandatory mapId & Usage Attribution */}
        <GoogleMap
          mapId="DEMO_MAP_ID"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          colorScheme={theme === 'dark' ? 'DARK' : 'LIGHT'}
          defaultCenter={{ lat: 4.635, lng: -74.085 }}
          defaultZoom={12}
          gestureHandling="greedy"
          disableDefaultUI={true}
          clickableIcons={false}
          className="w-full h-full"
        >
          <MapOverlaysAndCamera
            center={{
              latitude: center.latitude,
              longitude: center.longitude,
              city: center.city,
            }}
            driverPosition={driverPosition}
            headingDeg={headingDeg}
            activeRoute={activeRoute}
            isNavigating={isNavigating}
            cameraMode={cameraMode}
            onUserDragMap={handleUserDragMap}
            radar={radar}
            bogotaGeoJson={bogotaGeoJson}
            showTraffic={showTraffic}
            showRadar={showRadar}
            radarOpacity={radarOpacity}
            theme={theme}
            recenterNonce={recenterNonce}
            zoomDelta={zoomDelta}
          />

          {/* Live Traffic-Aware & Rain-Avoiding Route Engine */}
          <WazeRouteController
            origin={originPoint}
            destination={destination ? { lat: destination.lat, lng: destination.lng } : null}
            travelMode={travelMode}
            avoidRain={avoidRain}
            stations={stations}
            selectedRouteId={selectedRouteId}
            onRoutesComputed={handleRoutesComputed}
            onRouteLoading={setRouteLoading}
            onRouteError={setRouteError}
            onSelectRoute={setSelectedRouteId}
          />

          {/* Driver Position Marker: Waze-Style Directional Arrow Puck when Routing, Clean Dot Otherwise */}
          <AdvancedMarker
            position={driverPosition}
            title={`Tu posición · ${center.locality}`}
            zIndex={50}
          >
            {activeRoute ? (
              <div className="relative flex items-center justify-center w-12 h-12">
                <div className="absolute inset-1 rounded-full bg-sky-500/20 border border-sky-400/50" />
                <div
                  style={{
                    transform: `rotate(${Math.round(headingDeg)}deg)`,
                  }}
                  className="relative w-9 h-9 rounded-full bg-white shadow-xl border-2 border-[#0F213D] flex items-center justify-center transition-transform duration-300"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                    <path
                      d="M12 2.5L20 20L12 16.2L4 20L12 2.5Z"
                      fill="#0284C7"
                      stroke="#0F213D"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="w-5 h-5 rounded-full bg-sky-600 border-[3px] border-white shadow-lg" />
            )}
          </AdvancedMarker>

          {/* Destination Marker */}
          {destination && (
            <AdvancedMarker
              position={{ lat: destination.lat, lng: destination.lng }}
              title={destination.name}
              zIndex={45}
            >
              <div className="flex flex-col items-center -translate-y-2">
                <div className="px-2 py-0.5 rounded-lg bg-[#0F213D] text-white text-[11px] font-bold shadow-md max-w-[140px] truncate mb-1">
                  {destination.name}
                </div>
                <div className="w-4 h-4 rounded-full bg-rose-500 border-[3px] border-white shadow-md" />
              </div>
            </AdvancedMarker>
          )}

          {/* All 69 Live IDIGER SAB Bogotá Triangle Stations (△) */}
          {showStations &&
            stations.map((st) => {
              const r = st.latestReading;
              const isIdiger = st.source === 'IDIGER';
              const sab = classifySabDailyAccumulation(r.accDayMm ?? r.acc24hMm);
              const isRaining = Boolean(r.isRainingNow);

              return (
                <AdvancedMarker
                  key={st.id}
                  position={{ lat: st.latitude, lng: st.longitude }}
                  title={`${st.name} · ${(r.accDayMm ?? 0).toFixed(1)} mm hoy`}
                  zIndex={isRaining ? 35 : 15}
                  onClick={() => onSelectStation(st)}
                >
                  {isIdiger ? (
                    <button
                      type="button"
                      aria-label={`Estación ${st.name}`}
                      className="block p-0.5 cursor-pointer hover:scale-125 transition-transform focus:outline-none"
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        style={{ filter: 'drop-shadow(0 1px 1.5px rgba(15,23,42,0.5))' }}
                        aria-hidden="true"
                      >
                        {isRaining && (
                          <circle
                            cx="12"
                            cy="14"
                            r="10"
                            fill="none"
                            stroke={sab.color}
                            strokeWidth="2.2"
                            opacity="0.85"
                          >
                            <animate attributeName="r" from="7" to="11.5" dur="1.4s" repeatCount="indefinite" />
                            <animate attributeName="opacity" from="0.9" to="0" dur="1.4s" repeatCount="indefinite" />
                          </circle>
                        )}
                        <polygon
                          points="12,3 21.5,19.5 2.5,19.5"
                          fill={sab.color}
                          stroke={sab.stroke}
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Estación ${st.name}`}
                      className="w-3.5 h-3.5 rounded-full border-2 border-white shadow cursor-pointer"
                      style={{ backgroundColor: sab.tier === 'none' ? '#059669' : sab.color }}
                    />
                  )}
                </AdvancedMarker>
              );
            })}
        </GoogleMap>

        {/* Waze-Style "¿A dónde vas?" Floating Search Bar */}
        {!isNavigating && (
          <div className="fixed top-[68px] sm:top-4 left-3.5 right-3.5 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto sm:w-[360px] md:w-[400px] z-20 pointer-events-none pt-safe">
            <DestinationSearchBar
              destination={destination}
              originCenter={originPoint}
              favorites={favorites}
              onSelectDestination={(dest) => {
                setDestination(dest);
                setIsNavigating(false);
                setCameraMode('follow');
              }}
              onClearDestination={handleClearRoute}
            />
          </div>
        )}

        {/* Active Turn-by-Turn Waze Navigation Top Banner */}
        {isNavigating && activeRoute && (
          <div className="fixed top-3 left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:w-[440px] z-30 rounded-2xl bg-[#0F213D] text-white shadow-2xl border border-white/15 p-3.5 space-y-2 pt-safe">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                  <Navigation className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                    Paso {activeStepIdx + 1} de {Math.max(1, activeRoute.steps.length)} ·{' '}
                    {activeStep ? formatDistanceEs(activeStep.distanceMeters) : formatDistanceEs(activeRoute.distanceMeters)}
                  </p>
                  <p className="text-sm font-bold leading-snug line-clamp-2 mt-0.5">
                    {activeStep?.instruction ?? `Dirígete hacia ${destination?.name}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNavigating(false)}
                aria-label="Salir de navegación"
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeRoute.steps.length > 1 && (
              <div className="flex items-center justify-between pt-1.5 border-t border-white/10 text-xs">
                <button
                  type="button"
                  disabled={activeStepIdx === 0}
                  onClick={() => {
                    setActiveStepIdx((i) => Math.max(0, i - 1));
                    setCameraMode('follow');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 disabled:opacity-35 hover:bg-white/20 font-semibold"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </button>
                <span className="text-[11px] text-emerald-300 font-semibold truncate px-2">
                  {activeRoute.weather.verdictLabel}
                </span>
                <button
                  type="button"
                  disabled={activeStepIdx >= activeRoute.steps.length - 1}
                  onClick={() => {
                    setActiveStepIdx((i) => Math.min(activeRoute.steps.length - 1, i + 1));
                    setCameraMode('follow');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 disabled:opacity-35 hover:bg-white/20 font-semibold"
                >
                  Siguiente <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Quick Floating "Centrar en mí" Re-Lock Pill when user pans away from active route */}
        {activeRoute && cameraMode !== 'follow' && (
          <div className="fixed left-3.5 bottom-[244px] sm:bottom-52 z-20">
            <button
              type="button"
              onClick={() => {
                setCameraMode('follow');
                setRecenterNonce((n) => n + 1);
              }}
              className="min-h-[42px] px-3.5 rounded-full bg-[#0F213D] dark:bg-sky-500 text-white text-xs font-bold shadow-xl inline-flex items-center gap-2 hover:bg-[#17325C] dark:hover:bg-sky-400"
            >
              <Compass className="w-4 h-4" />
              Centrar en mí
            </button>
          </div>
        )}

        {/* Right Edge Minimal Map Controls: Overview/Follow Toggle + Traffic + Zoom + Recenter */}
        <div
          className={`fixed right-3.5 z-20 flex flex-col gap-2 transition-all ${
            destination ? 'bottom-64 sm:bottom-52' : 'bottom-28 sm:bottom-12'
          }`}
        >
          {activeRoute && (
            <button
              type="button"
              onClick={() => {
                setCameraMode((m) => (m === 'overview' ? 'follow' : 'overview'));
                setRecenterNonce((n) => n + 1);
              }}
              aria-label={cameraMode === 'overview' ? 'Volver a vista cercana' : 'Ver toda la ruta'}
              title={cameraMode === 'overview' ? 'Vista cercana' : 'Ver ruta completa'}
              className={`w-11 h-11 rounded-2xl backdrop-blur-md border shadow-lg flex items-center justify-center transition-colors ${
                cameraMode === 'overview'
                  ? 'bg-[#0F213D] dark:bg-sky-500 text-white border-[#0F213D] dark:border-sky-400'
                  : 'bg-white/92 dark:bg-slate-900/92 text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-slate-700/80'
              }`}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowTraffic((v) => !v)}
            aria-pressed={showTraffic}
            aria-label={showTraffic ? 'Ocultar tráfico en vivo' : 'Mostrar tráfico en vivo'}
            title={showTraffic ? 'Tráfico activo' : 'Activar tráfico'}
            className={`w-11 h-11 rounded-2xl backdrop-blur-md border shadow-lg flex items-center justify-center transition-colors ${
              showTraffic
                ? 'bg-[#0F213D] dark:bg-sky-500 text-white border-[#0F213D] dark:border-sky-400'
                : 'bg-white/92 dark:bg-slate-900/92 text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-slate-700/80'
            }`}
          >
            <TrafficCone className="w-4 h-4" />
          </button>

          <div className="flex flex-col rounded-2xl bg-white/92 dark:bg-slate-900/92 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 shadow-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setZoomDelta((z) => ({ seq: z.seq + 1, delta: 1 }))}
              aria-label="Acercar mapa"
              className="w-11 h-11 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-200/70 dark:border-slate-800"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoomDelta((z) => ({ seq: z.seq + 1, delta: -1 }))}
              aria-label="Alejar mapa"
              className="w-11 h-11 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (activeRoute) setCameraMode('follow');
              setRecenterNonce((n) => n + 1);
            }}
            aria-label="Centrar en mi ubicación"
            title="Centrar en mi ubicación"
            className="w-11 h-11 rounded-2xl bg-white/92 dark:bg-slate-900/92 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 shadow-lg flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        </div>

        {/* Bottom-Left Collapsible SAB Legend (only when no route card covers bottom-left) */}
        {!destination && (
          <div className="fixed left-3.5 bottom-6 z-20 flex flex-col items-start gap-2 pb-safe">
            {showLegend && (
              <div className="w-56 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/90 p-3 shadow-xl text-xs space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-slate-900 dark:text-white font-display">
                    Lluvia hoy (SAB)
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowLegend(false)}
                    aria-label="Cerrar leyenda"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {SAB_LEGEND_ITEMS.map((item) => (
                    <div key={item.label} className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                      <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
                        <polygon points="7,1 13,12 1,12" fill={item.color} stroke={item.stroke} strokeWidth="1.2" />
                      </svg>
                      <span className="text-[11px] leading-tight">{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1">
                  <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                    Radar IDIGER + Tráfico vivo
                  </p>
                  <div
                    className="h-2 rounded-full"
                    style={{
                      background:
                        'linear-gradient(90deg, #38bdf8 0%, #22c55e 35%, #facc15 65%, #f97316 82%, #dc2626 100%)',
                    }}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowLegend((v) => !v)}
              aria-expanded={showLegend}
              aria-label="Ver escala de colores de lluvia"
              className="h-11 px-3.5 rounded-full bg-white/92 dark:bg-slate-900/92 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 shadow-lg inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-800"
            >
              <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span className="hidden sm:inline">Escala</span>
            </button>
          </div>
        )}

        {/* Compact Radar & Map Layers Bar (when toggled from Wheel -> Radar) */}
        {radarBarOpen && !destination && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-24px)] max-w-md rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/90 shadow-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  Capas en vivo · Tráfico y Radar IDIGER
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onRefreshRadar}
                  aria-label="Actualizar radar"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onCloseRadarBar}
                  aria-label="Cerrar controles de radar"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTraffic((v) => !v)}
                className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold transition-colors ${
                  showTraffic
                    ? 'bg-[#0F213D] dark:bg-sky-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                Tráfico: {showTraffic ? 'Sí' : 'No'}
              </button>
              <button
                type="button"
                onClick={() => setShowRadar((v) => !v)}
                className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold transition-colors ${
                  showRadar
                    ? 'bg-[#0F213D] dark:bg-sky-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                Radar: {showRadar ? 'Sí' : 'No'}
              </button>
              <button
                type="button"
                onClick={() => setShowStations((v) => !v)}
                className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold transition-colors ${
                  showStations
                    ? 'bg-[#0F213D] dark:bg-sky-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                Estaciones: {showStations ? 'Sí' : 'No'}
              </button>
              <label className="ml-auto flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span>Radar</span>
                <input
                  type="range"
                  min={0.25}
                  max={0.95}
                  step={0.05}
                  value={radarOpacity}
                  onChange={(e) => setRadarOpacity(Number(e.target.value))}
                  className="w-16 accent-sky-600"
                />
              </label>
            </div>
          </div>
        )}

        {/* Waze-Style Bottom Route Summary & Rain-Avoidance Card */}
        {destination && (
          <div className="fixed bottom-3 left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:w-[440px] z-30 rounded-3xl bg-white/97 dark:bg-slate-900/97 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-2xl p-4 space-y-3 pb-safe">
            {isNavigating && activeRoute ? (
              /* Compact live ETA footer bar during navigation */
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xl font-extrabold font-display tabular-nums text-slate-900 dark:text-white leading-none">
                    {formatDurationEs(activeRoute.durationMillis)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {formatDistanceEs(activeRoute.distanceMeters)}
                    {activeRoute.trafficDelayMin > 0
                      ? ` · +${activeRoute.trafficDelayMin} min tráfico`
                      : ' · Tráfico fluido'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClearRoute}
                  className="min-h-[44px] px-5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold shadow"
                >
                  Finalizar
                </button>
              </div>
            ) : (
              /* Route preview & rain-avoidance selector */
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      Desde {center.locality} hasta
                    </p>
                    <h2 className="text-base font-extrabold font-display text-slate-900 dark:text-white truncate">
                      {destination.name}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearRoute}
                    aria-label="Cerrar ruta"
                    className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Mode selector + Evitar lluvia toggle */}
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 gap-0.5">
                    {TRAVEL_MODES.map((m) => {
                      const Icon = m.icon;
                      const active = travelMode === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setTravelMode(m.id)}
                          aria-label={m.label}
                          className={`min-h-[36px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
                            active
                              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span className="hidden xs:inline sm:inline">{m.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setAvoidRain((v) => !v)}
                    aria-pressed={avoidRain}
                    className={`min-h-[38px] px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      avoidRain
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Evitar lluvia
                  </button>
                </div>

                {/* Route Loading / Error / Alternatives */}
                {routeLoading ? (
                  <div className="py-3 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <CloudRain className="w-4 h-4 text-sky-600 animate-bounce" />
                    <span>Calculando ruta con tráfico y evitando zonas con lluvia...</span>
                  </div>
                ) : routeError ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400 py-1">{routeError}</p>
                ) : activeRoute ? (
                  <div className="space-y-3">
                    {/* Alternative Route Chips when > 1 option exists */}
                    {routes.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-0.5">
                        {routes.map((rt, i) => {
                          const isSelected = rt.id === activeRoute.id;
                          return (
                            <button
                              key={rt.id}
                              type="button"
                              onClick={() => setSelectedRouteId(rt.id)}
                              className={`shrink-0 px-3 py-2 rounded-2xl border text-left transition-colors ${
                                isSelected
                                  ? 'border-sky-600 bg-sky-50/80 dark:bg-sky-950/50 dark:border-sky-400'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60'
                              }`}
                            >
                              <p className="text-xs font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                                {formatDurationEs(rt.durationMillis)} · {formatDistanceEs(rt.distanceMeters)}
                              </p>
                              <p
                                className={`text-[11px] font-semibold mt-0.5 ${
                                  rt.weather.isDry
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-amber-700 dark:text-amber-400'
                                }`}
                              >
                                {rt.isBypassDetour
                                  ? 'Desvío seco'
                                  : rt.weather.isDry
                                    ? 'Ruta seca'
                                    : `${rt.weather.wetPercentage}% en lluvia`}
                                {i === 0 ? ' · Recomendada' : ''}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Primary ETA + Rain Verdict + Start Navigation CTA */}
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-extrabold font-display tabular-nums text-slate-900 dark:text-white leading-none">
                            {formatDurationEs(activeRoute.durationMillis)}
                          </span>
                          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {formatDistanceEs(activeRoute.distanceMeters)}
                          </span>
                        </div>
                        <p className="text-xs font-semibold mt-1 truncate">
                          <span
                            className={
                              activeRoute.weather.isDry
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }
                          >
                            {activeRoute.weather.verdictLabel}
                          </span>
                          {activeRoute.trafficDelayMin > 0 && (
                            <span className="text-slate-500 dark:text-slate-400">
                              {' '}
                              · +{activeRoute.trafficDelayMin} min tráfico
                            </span>
                          )}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveStepIdx(0);
                          setCameraMode('follow');
                          setIsNavigating(true);
                          setRecenterNonce((n) => n + 1);
                        }}
                        className="min-h-[46px] px-5 rounded-2xl bg-[#0F213D] dark:bg-sky-500 hover:bg-[#17325C] dark:hover:bg-sky-400 text-white text-sm font-bold inline-flex items-center gap-2 shadow-lg shrink-0"
                      >
                        <Navigation className="w-4 h-4" />
                        Iniciar
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </APIProvider>
  );
};
