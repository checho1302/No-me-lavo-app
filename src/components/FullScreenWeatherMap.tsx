import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Crosshair,
  Info,
  Layers,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import type { RadarProductsResponse, WeatherStation } from '../types/weather';
import { buildStationTooltipHtml, createStationLeafletIcon } from '../utils/sabMapMarkers';

interface FullScreenWeatherMapProps {
  center: { latitude: number; longitude: number; locality: string; city: string };
  stations: WeatherStation[];
  radar: RadarProductsResponse | null;
  bogotaGeoJson: unknown | null;
  theme: 'light' | 'dark';
  radarBarOpen: boolean;
  onCloseRadarBar: () => void;
  onRefreshRadar: () => void;
  onSelectStation: (station: WeatherStation) => void;
}

const SAB_LEGEND_ITEMS = [
  { label: 'Sin lluvias (0.0)', color: '#9CA3AF', stroke: '#374151' },
  { label: 'Bajos (0–10 mm)', color: '#22D3EE', stroke: '#0E7490' },
  { label: 'Moderados (10.1–30 mm)', color: '#84CC16', stroke: '#3F6212' },
  { label: 'Altos (30.1–50 mm)', color: '#F97316', stroke: '#9A3412' },
  { label: 'Muy altos (>50.1 mm)', color: '#9333EA', stroke: '#581C87' },
];

export const FullScreenWeatherMap: React.FC<FullScreenWeatherMapProps> = ({
  center,
  stations,
  radar,
  bogotaGeoJson,
  theme,
  radarBarOpen,
  onCloseRadarBar,
  onRefreshRadar,
  onSelectStation,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const localitiesLayerRef = useRef<L.GeoJSON | null>(null);
  const idigerOverlayRef = useRef<L.ImageOverlay | null>(null);
  const rainViewerLayerRef = useRef<L.TileLayer | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const lastCityRef = useRef<string>('');

  const [showRadar, setShowRadar] = useState(true);
  const [radarMode, setRadarMode] = useState<'idiger' | 'rainviewer'>('idiger');
  const [radarOpacity, setRadarOpacity] = useState(0.75);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const isBogota = center.city.toLowerCase().includes('bogot');
  const frames = useMemo(() => radar?.frames ?? [], [radar]);

  useEffect(() => {
    if (frames.length > 0) {
      setFrameIndex(frames.length - 1);
    }
  }, [frames]);

  // RainViewer playback interval when animation mode is active
  useEffect(() => {
    if (!isPlaying || frames.length <= 1 || radarMode !== 'rainviewer') return;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % frames.length);
    }, 800);
    return () => window.clearInterval(id);
  }, [isPlaying, frames.length, radarMode]);

  // Initialize Leaflet full-screen map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [4.625, -74.095],
      zoom: 11,
      zoomControl: false,
      attributionControl: true,
    });

    map.attributionControl.setPrefix(false);
    map.attributionControl.setPosition('bottomright');

    markersGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      localitiesLayerRef.current = null;
      idigerOverlayRef.current = null;
      rainViewerLayerRef.current = null;
      markersGroupRef.current = null;
    };
  }, []);

  // Recenter smoothly when city/location changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${center.city}:${center.locality}:${center.latitude.toFixed(3)}:${center.longitude.toFixed(3)}`;
    if (lastCityRef.current === key) return;
    lastCityRef.current = key;

    if (isBogota) {
      map.setView([4.625, -74.095], 11, { animate: true });
    } else {
      map.setView([center.latitude, center.longitude], 11, { animate: true });
    }
  }, [center.latitude, center.longitude, center.city, center.locality, isBogota]);

  // Basemap layer matching SAB topographic style in light mode, clean dark canvas in dark mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
    }

    const tileUrl =
      theme === 'dark'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
        : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';

    baseLayerRef.current = L.tileLayer(tileUrl, {
      attribution: '© Esri · SAB IDIGER',
      maxZoom: 18,
    }).addTo(map);
  }, [theme]);

  // Bogotá Localidades GeoJSON outline overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (localitiesLayerRef.current) {
      map.removeLayer(localitiesLayerRef.current);
      localitiesLayerRef.current = null;
    }

    if (!bogotaGeoJson) return;

    localitiesLayerRef.current = L.geoJSON(bogotaGeoJson as GeoJSON.GeoJsonObject, {
      style: {
        color: theme === 'dark' ? '#94A3B8' : '#334155',
        weight: 1.25,
        opacity: 0.72,
        fillColor: theme === 'dark' ? '#38BDF8' : '#64748B',
        fillOpacity: 0.03,
      },
      interactive: false,
    }).addTo(map);
  }, [bogotaGeoJson, theme]);

  // Radar overlay: Live IDIGER 1399BOG in Bogotá OR RainViewer tiles
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (idigerOverlayRef.current) {
      map.removeLayer(idigerOverlayRef.current);
      idigerOverlayRef.current = null;
    }
    if (rainViewerLayerRef.current) {
      map.removeLayer(rainViewerLayerRef.current);
      rainViewerLayerRef.current = null;
    }

    if (!showRadar) return;

    const useIdigerLive = isBogota && radarMode === 'idiger' && radar?.idigerRadar?.available;
    if (
      useIdigerLive &&
      radar?.idigerRadar &&
      radar.idigerRadar.imageUrl.startsWith('/api/v1/radar/idiger/image')
    ) {
      const { north, south, east, west } = radar.idigerRadar.bounds;
      const cacheKey = radar.idigerRadar.observedAt ?? radar.generatedAt;
      const sep = radar.idigerRadar.imageUrl.includes('?') ? '&' : '?';
      const imageUrl = `${radar.idigerRadar.imageUrl}${sep}t=${encodeURIComponent(cacheKey)}`;
      idigerOverlayRef.current = L.imageOverlay(
        imageUrl,
        [
          [south, west],
          [north, east],
        ],
        {
          opacity: radarOpacity,
          interactive: false,
          zIndex: 250,
        }
      ).addTo(map);
      return;
    }

    const activeFrame = frames[frameIndex] ?? frames[frames.length - 1];
    if (activeFrame) {
      rainViewerLayerRef.current = L.tileLayer(activeFrame.tileUrlTemplate, {
        opacity: radarOpacity,
        zIndex: 250,
        maxNativeZoom: 7,
        maxZoom: 18,
      }).addTo(map);
    }
  }, [showRadar, radarMode, isBogota, radar, frames, frameIndex, radarOpacity]);

  // All 69 live IDIGER SAB triangle markers + national stations
  useEffect(() => {
    const group = markersGroupRef.current;
    if (!group) return;
    group.clearLayers();

    for (const st of stations) {
      const icon = createStationLeafletIcon(st);
      const marker = L.marker([st.latitude, st.longitude], {
        icon,
        zIndexOffset: st.latestReading.isRainingNow ? 350 : 120,
      });

      marker.bindTooltip(buildStationTooltipHtml(st), {
        direction: 'top',
        offset: [0, -10],
        opacity: 0.96,
      });

      marker.on('click', () => onSelectStation(st));
      marker.addTo(group);
    }
  }, [stations, onSelectStation]);

  const activeFrame = frames[frameIndex] ?? frames[frames.length - 1] ?? null;

  const handleRecenter = () => {
    const map = mapRef.current;
    if (!map) return;
    if (isBogota) {
      map.setView([4.625, -74.095], 11, { animate: true });
    } else {
      map.setView([center.latitude, center.longitude], 11, { animate: true });
    }
  };

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-slate-200 dark:bg-[#0B1320]">
      {/* 100% Full-Screen Leaflet Map */}
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        aria-label="Mapa en vivo de lluvia y estaciones de No me lavo"
      />

      {/* Minimal Floating Zoom & Recenter Controls (Right Edge, Middle-Lower) */}
      <div className="fixed right-3.5 bottom-28 sm:bottom-12 z-20 flex flex-col gap-2">
        <div className="flex flex-col rounded-2xl bg-white/92 dark:bg-slate-900/92 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn()}
            aria-label="Acercar mapa"
            className="w-11 h-11 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-200/70 dark:border-slate-800"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut()}
            aria-label="Alejar mapa"
            className="w-11 h-11 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={handleRecenter}
          aria-label={isBogota ? 'Centrar en toda Bogotá' : 'Centrar en mi ubicación'}
          title={isBogota ? 'Ver toda Bogotá' : 'Centrar'}
          className="w-11 h-11 rounded-2xl bg-white/92 dark:bg-slate-900/92 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 shadow-lg flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Crosshair className="w-4 h-4" />
        </button>
      </div>

      {/* Collapsible SAB Legend Button & Card (Bottom-Left) */}
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
                    <polygon
                      points="7,1 13,12 1,12"
                      fill={item.color}
                      stroke={item.stroke}
                      strokeWidth="1.2"
                    />
                  </svg>
                  <span className="text-[11px] leading-tight">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1">
              <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Radar IDIGER (dBZ)
              </p>
              <div
                className="h-2 rounded-full"
                style={{
                  background: 'linear-gradient(90deg, #38bdf8 0%, #22c55e 35%, #facc15 65%, #f97316 82%, #dc2626 100%)',
                }}
              />
              <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span>Débil</span>
                <span>Moderada</span>
                <span>Fuerte</span>
              </div>
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

      {/* Compact Floating Radar Control Bar (only visible when toggled via Wheel -> Radar) */}
      {radarBarOpen && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-24px)] max-w-md rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/90 shadow-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Layers className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {radarMode === 'idiger' && isBogota ? 'Radar IDIGER Bogotá en vivo' : 'Animación RainViewer'}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
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
              onClick={() => setShowRadar((v) => !v)}
              className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold transition-colors ${
                showRadar
                  ? 'bg-[#0F213D] dark:bg-sky-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {showRadar ? 'Radar: Sí' : 'Radar: No'}
            </button>

            {isBogota && (
              <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setRadarMode('idiger');
                    setIsPlaying(false);
                    setShowRadar(true);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors ${
                    radarMode === 'idiger'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  IDIGER
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRadarMode('rainviewer');
                    setShowRadar(true);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors ${
                    radarMode === 'rainviewer'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Animar
                </button>
              </div>
            )}

            <label className="ml-auto flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <span>Opacidad</span>
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

          {radarMode === 'rainviewer' && frames.length > 0 && (
            <div className="flex items-center gap-2.5 pt-1 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                aria-label={isPlaying ? 'Pausar animación' : 'Reproducir animación'}
                className="w-9 h-9 rounded-xl bg-[#0F213D] dark:bg-sky-500 text-white flex items-center justify-center shrink-0"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, frames.length - 1)}
                value={frameIndex}
                onChange={(e) => {
                  setIsPlaying(false);
                  setFrameIndex(Number(e.target.value));
                }}
                aria-label="Línea de tiempo del radar"
                className="flex-1 accent-sky-600"
              />
              <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300 shrink-0">
                {activeFrame
                  ? new Date(activeFrame.time * 1000).toLocaleTimeString('es-CO', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '--:--'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
