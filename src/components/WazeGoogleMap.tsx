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
  Crosshair,
  Footprints,
  Info,
  Layers,
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
 * Imperative Google Maps layers: TrafficLayer, Bogotá 20 Localidades GeoJSON,
 * live IDIGER 1399BOG Weather Radar GroundOverlay, and camera controls.
 */
const MapOverlaysAndCamera: React.FC<{
  center: { latitude: number; longitude: number; city: string };
  radar: RadarProductsResponse | null;
  bogotaGeoJson: unknown | null;
  showTraffic: boolean;
  showRadar: boolean;
  radarOpacity: number;
  theme: 'light' | 'dark';
  hasActiveRoute: boolean;
  recenterNonce: number;
  zoomDelta: { seq: number; delta: number };
}> = ({
  center,
  radar,
  bogotaGeoJson,
  showTraffic,
  showRadar,
  radarOpacity,
  theme,
  hasActiveRoute,
  recenterNonce,
  zoomDelta,
}) => {
  const map = useMap();
  const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null);
  const groundOverlayRef = useRef<google.maps.GroundOverlay | null>(null);
  const dataLoadedRef = useRef(false);
  const lastCityKeyRef = useRef('');

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

  // Recenter when city/location changes (unless actively viewing a route)
  useEffect(() => {
    if (!map || hasActiveRoute) return;
    const key = `${center.city}:${center.latitude.toFixed(3)}:${center.longitude.toFixed(3)}`;
    if (lastCityKeyRef.current === key) return;
    lastCityKeyRef.current = key;
    const isBogota = center.city.toLowerCase().includes('bogot');
    map.panTo(isBogota ? { lat: 4.635, lng: -74.085 } : { lat: center.latitude, lng: center.longitude });
    map.setZoom(12);
  }, [map, center.latitude, center.longitude, center.city, hasActiveRoute]);

  // Manual recenter trigger
  useEffect(() => {
    if (!map || recenterNonce === 0) return;
    const isBogota = center.city.toLowerCase().includes('bogot');
    map.panTo(isBogota ? { lat: 4.635, lng: -74.085 } : { lat: center.latitude, lng: center.longitude });
    map.setZoom(12);
  }, [map, recenterNonce, center.latitude, center.longitude, center.city]);

  // Manual zoom buttons
  useEffect(() => {
    if (!map || zoomDelta.seq === 0) return;
    const currentZoom = map.getZoom() ?? 12;
    map.setZoom(Math.max(5, Math.min(19, currentZoom + zoomDelta.delta)));
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

  const handleRoutesComputed = useCallback(
    (computed: ComputedNavRoute[], bestId: string | null) => {
      setRoutes(computed);
      setSelectedRouteId(bestId);
      setActiveStepIdx(0);
    },
    []
  );

  const handleClearRoute = () => {
    setDestination(null);
    setRoutes([]);
    setSelectedRouteId(null);
    setRouteError(null);
    setIsNavigating(false);
    setActiveStepIdx(0);
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
            radar={radar}
            bogotaGeoJson={bogotaGeoJson}
            showTraffic={showTraffic}
            showRadar={showRadar}
            radarOpacity={radarOpacity}
            theme={theme}
            hasActiveRoute={Boolean(destination)}
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

          {/* Origin Marker (Waze-style blue position dot) */}
          <AdvancedMarker position={originPoint} title={`Origen: ${center.locality}`} zIndex={40}>
            <div className="w-5 h-5 rounded-full bg-sky-600 border-[3px] border-white shadow-lg" />
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

        {/* Waze-Style "¿A dónde vas?" Floating Search Bar (sits cleanly below top brand header when not navigating) */}
        {!isNavigating && (
          <div className="fixed top-[68px] sm:top-4 left-3.5 right-3.5 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto sm:w-[360px] md:w-[400px] z-20 pointer-events-none pt-safe">
            <DestinationSearchBar
              destination={destination}
              originCenter={originPoint}
              favorites={favorites}
              onSelectDestination={(dest) => {
                setDestination(dest);
                setIsNavigating(false);
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
                  onClick={() => setActiveStepIdx((i) => Math.max(0, i - 1))}
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
                  onClick={() =>
                    setActiveStepIdx((i) => Math.min(activeRoute.steps.length - 1, i + 1))
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 disabled:opacity-35 hover:bg-white/20 font-semibold"
                >
                  Siguiente <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Right Edge Minimal Map Controls: Traffic Toggle + Zoom + Recenter */}
        <div
          className={`fixed right-3.5 z-20 flex flex-col gap-2 transition-all ${
            destination ? 'bottom-64 sm:bottom-52' : 'bottom-28 sm:bottom-12'
          }`}
        >
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
            onClick={() => setRecenterNonce((n) => n + 1)}
            aria-label="Centrar mapa"
            title="Centrar mapa"
            className="w-11 h-11 rounded-2xl bg-white/92 dark:bg-slate-900/92 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 shadow-lg flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        </div>

        {/* Bottom-Left Collapsible SAB Legend (only when not covered by route sheet on mobile) */}
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
                          setIsNavigating(true);
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
