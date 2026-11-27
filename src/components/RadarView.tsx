import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Info, Layers, Pause, Play, RefreshCw, SkipBack, SkipForward } from 'lucide-react';
import type { RadarProductsResponse, WeatherStation } from '../types/weather';
import { buildStationTooltipHtml, createStationLeafletIcon } from '../utils/sabMapMarkers';

interface RadarViewProps {
  radar: RadarProductsResponse | null;
  stations: WeatherStation[];
  bogotaGeoJson: unknown | null;
  loading: boolean;
  theme: 'light' | 'dark';
  onRefresh: () => void;
  onSelectStation: (station: WeatherStation) => void;
}

const SAB_LEGEND_ITEMS = [
  { label: 'Sin lluvias (0.0)', color: '#9CA3AF', stroke: '#374151' },
  { label: 'Bajos (0–10 mm)', color: '#22D3EE', stroke: '#0E7490' },
  { label: 'Moderados (10.1–30 mm)', color: '#84CC16', stroke: '#3F6212' },
  { label: 'Altos (30.1–50 mm)', color: '#F97316', stroke: '#9A3412' },
  { label: 'Muy altos (>50.1 mm)', color: '#9333EA', stroke: '#581C87' },
];

export const RadarView: React.FC<RadarViewProps> = ({
  radar,
  stations,
  bogotaGeoJson,
  loading,
  theme,
  onRefresh,
  onSelectStation,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const radarTileLayerRef = useRef<L.TileLayer | null>(null);
  const idigerOverlayRef = useRef<L.ImageOverlay | null>(null);
  const localitiesLayerRef = useRef<L.GeoJSON | null>(null);
  const stationsLayerRef = useRef<L.LayerGroup | null>(null);
  const rangeCircleRef = useRef<L.Circle | null>(null);

  const [selectedSiteId, setSelectedSiteId] = useState<string>('radar-bogota');
  const [bogotaRadarMode, setBogotaRadarMode] = useState<'idiger' | 'rainviewer'>('idiger');
  const [showRadarLayer, setShowRadarLayer] = useState<boolean>(true);
  const [showStationsLayer, setShowStationsLayer] = useState<boolean>(true);
  const [showLocalitiesLayer, setShowLocalitiesLayer] = useState<boolean>(true);
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const [opacity, setOpacity] = useState<number>(0.8);

  const sites = radar?.sites ?? [];
  const frames = radar?.frames ?? [];
  const idigerRadar = radar?.idigerRadar ?? null;
  const activeSite = sites.find((s) => s.id === selectedSiteId) ?? sites[0] ?? null;
  const activeFrame = frames[frameIndex] ?? null;

  const isBogotaSite = (activeSite?.id ?? selectedSiteId) === 'radar-bogota';
  const useIdigerLive = isBogotaSite && bogotaRadarMode === 'idiger' && Boolean(idigerRadar?.available);

  const idigerBogotaStations = useMemo(
    () => stations.filter((s) => s.source === 'IDIGER' && s.city === 'Bogotá'),
    [stations]
  );

  const rainingCount = useMemo(
    () => idigerBogotaStations.filter((s) => (s.latestReading.accDayMm ?? 0) > 0).length,
    [idigerBogotaStations]
  );

  // Set default frame to latest observed past frame when frames load
  useEffect(() => {
    if (frames.length > 0) {
      const lastPastIdx = Math.max(
        0,
        frames.reduce((last, f, i) => (!f.isForecast ? i : last), 0)
      );
      setFrameIndex(lastPastIdx);
    }
  }, [frames.length]);

  // Initialize Leaflet map once framed on Bogotá like SAB
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: [4.625, -74.095],
      zoom: 11,
      zoomControl: true,
    });
    stationsLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      radarTileLayerRef.current = null;
      idigerOverlayRef.current = null;
      localitiesLayerRef.current = null;
      stationsLayerRef.current = null;
      rangeCircleRef.current = null;
    };
  }, []);

  // Update base map tile layer on theme change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
    }
    const url =
      theme === 'dark'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
        : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
    const attribution = 'Tiles &copy; Esri &mdash; SAB IDIGER Bogotá';
    baseLayerRef.current = L.tileLayer(url, {
      attribution,
      maxZoom: 18,
    }).addTo(map);
  }, [theme]);

  // Frame map on selected radar site
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeSite) return;
    if (activeSite.id === 'radar-bogota') {
      map.setView([4.625, -74.095], 11, { animate: true });
    } else {
      map.setView([activeSite.latitude, activeSite.longitude], activeSite.zoom, { animate: true });
    }

    if (rangeCircleRef.current) {
      map.removeLayer(rangeCircleRef.current);
      rangeCircleRef.current = null;
    }
    if (activeSite.status === 'active' && activeSite.id !== 'radar-bogota') {
      rangeCircleRef.current = L.circle([activeSite.latitude, activeSite.longitude], {
        radius: activeSite.rangeKm * 1000,
        color: '#2563EB',
        weight: 1.5,
        dashArray: '6 6',
        fillOpacity: 0.03,
      }).addTo(map);
    }
  }, [activeSite]);

  // Draw real Bogotá Localidades_SAB polygon outlines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (localitiesLayerRef.current) {
      map.removeLayer(localitiesLayerRef.current);
      localitiesLayerRef.current = null;
    }
    if (!showLocalitiesLayer || !bogotaGeoJson) return;

    localitiesLayerRef.current = L.geoJSON(bogotaGeoJson as GeoJSON.GeoJsonObject, {
      style: {
        color: theme === 'dark' ? '#94A3B8' : '#1E293B',
        weight: 1.35,
        opacity: 0.85,
        fillColor: theme === 'dark' ? '#1E293B' : '#FFFFFF',
        fillOpacity: 0.03,
      },
      onEachFeature: (feature, layer) => {
        const props = (feature.properties ?? {}) as { LocNombre?: string };
        if (props.LocNombre) {
          layer.bindTooltip(`Localidad: ${props.LocNombre}`, { sticky: true });
        }
      },
    }).addTo(map);
  }, [bogotaGeoJson, showLocalitiesLayer, theme]);

  // Render Radar Layer (Real Live IDIGER 1399BOG KMZ PNG OR RainViewer animated tiles)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (idigerOverlayRef.current) {
      map.removeLayer(idigerOverlayRef.current);
      idigerOverlayRef.current = null;
    }
    if (radarTileLayerRef.current) {
      map.removeLayer(radarTileLayerRef.current);
      radarTileLayerRef.current = null;
    }

    if (!showRadarLayer) return;

    if (useIdigerLive && idigerRadar) {
      const { south, west, north, east } = idigerRadar.bounds;
      idigerOverlayRef.current = L.imageOverlay(
        idigerRadar.imageUrl,
        [
          [south, west],
          [north, east],
        ],
        {
          opacity,
          zIndex: 20,
          interactive: false,
        }
      ).addTo(map);
    } else if (activeFrame) {
      radarTileLayerRef.current = L.tileLayer(activeFrame.tileUrlTemplate, {
        opacity,
        zIndex: 20,
        maxNativeZoom: 7,
        maxZoom: 16,
        attribution: 'Radar &copy; RainViewer',
      }).addTo(map);
    }
  }, [showRadarLayer, useIdigerLive, idigerRadar, activeFrame]);

  // Live opacity update
  useEffect(() => {
    if (idigerOverlayRef.current) {
      idigerOverlayRef.current.setOpacity(opacity);
    }
    if (radarTileLayerRef.current) {
      radarTileLayerRef.current.setOpacity(opacity);
    }
  }, [opacity]);

  // Render ALL 69 IDIGER Bogotá stations (△) on top of radar just like SAB
  useEffect(() => {
    const group = stationsLayerRef.current;
    if (!group) return;
    group.clearLayers();
    if (!showStationsLayer) return;

    const list = isBogotaSite ? idigerBogotaStations : stations;
    list.forEach((st) => {
      const marker = L.marker([st.latitude, st.longitude], {
        icon: createStationLeafletIcon(st),
        zIndexOffset: st.latestReading.isRainingNow ? 600 : (st.latestReading.accDayMm ?? 0) > 0 ? 400 : 100,
      });
      marker.bindTooltip(buildStationTooltipHtml(st), { direction: 'top' });
      marker.on('click', () => onSelectStation(st));
      marker.addTo(group);
    });
  }, [stations, idigerBogotaStations, showStationsLayer, isBogotaSite, onSelectStation]);

  // Playback loop (RainViewer temporal animation)
  useEffect(() => {
    if (!playing || frames.length <= 1 || useIdigerLive) return;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % frames.length);
    }, 850);
    return () => window.clearInterval(id);
  }, [playing, frames.length, useIdigerLive]);

  const idigerTimeLabel = idigerRadar?.observedAt
    ? new Date(idigerRadar.observedAt).toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Bogota',
      })
    : '--:--';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Radar de lluvias · Bogotá y Colombia
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {useIdigerLive
              ? `Radar Meteorológico IDIGER Bogotá · ${idigerBogotaStations.length} estaciones en tiempo real (${rainingCount} con acumulado hoy)`
              : `Reflectividad compuesta y animación temporal · ${activeSite?.provider ?? 'RainViewer'}`}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="self-start sm:self-auto min-h-[44px] px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 whitespace-nowrap"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar radar</span>
        </button>
      </div>

      {/* Radar Region Selector & Layer Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Selección de cobertura radar">
          {sites.map((site) => {
            const isActive = site.id === (activeSite?.id ?? selectedSiteId);
            return (
              <button
                key={site.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setSelectedSiteId(site.id);
                  setPlaying(false);
                }}
                className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#0F213D] text-white dark:bg-blue-600'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-blue-400'
                }`}
              >
                {site.name}
              </button>
            );
          })}
        </div>

        {isBogotaSite && (
          <div className="inline-flex p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setBogotaRadarMode('idiger');
              }}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                bogotaRadarMode === 'idiger'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Radar IDIGER en vivo
            </button>
            <button
              type="button"
              onClick={() => setBogotaRadarMode('rainviewer')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                bogotaRadarMode === 'rainviewer'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Animación RainViewer
            </button>
          </div>
        )}
      </div>

      {/* Main Radar Canvas + Overlays */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="relative h-[460px] sm:h-[560px] w-full">
          <div
            ref={mapContainerRef}
            data-testid="radar-map-canvas"
            className="h-full w-full"
            aria-label="Mapa interactivo de reflectividad de radar y estaciones IDIGER Bogotá"
          />

          {/* Top-right Timestamp & Active Feed Indicator */}
          <div className="absolute top-3 right-3 z-[400] rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 px-3.5 py-2 shadow-sm">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {useIdigerLive
                ? 'Radar IDIGER 1399BOG'
                : activeFrame?.isForecast
                  ? 'Estimación corto plazo'
                  : 'Reflectividad RainViewer'}
            </p>
            <p className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {useIdigerLive ? `${idigerTimeLabel} COT` : activeFrame ? activeFrame.label : 'Sin fotograma'}
            </p>
          </div>

          {/* SAB Style Compact Legend Overlay on Desktop */}
          {isBogotaSite && (
            <div className="hidden md:block absolute bottom-7 right-3 z-[400] w-60 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-md overflow-hidden">
              <div className="bg-[#0F213D] dark:bg-blue-950 text-white px-3 py-2">
                <p className="text-xs font-bold font-display">
                  {idigerBogotaStations.length} Estaciones IDIGER (△)
                </p>
                <p className="text-[10px] text-sky-200">Acumulado desde las 0:00 de hoy</p>
              </div>
              <div className="p-2.5 space-y-1.5">
                {SAB_LEGEND_ITEMS.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-200">
                    <span>{item.label}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
                      <polygon
                        points="12,3 21.5,19.5 2.5,19.5"
                        fill={item.color}
                        stroke={item.stroke}
                        strokeWidth="2"
                      />
                    </svg>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Controls Bar */}
        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 space-y-4">
          {/* Layer Toggles & Opacity */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={showRadarLayer}
                onClick={() => setShowRadarLayer((v) => !v)}
                className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                  showRadarLayer
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                Capa Radar
              </button>
              <button
                type="button"
                aria-pressed={showStationsLayer}
                onClick={() => setShowStationsLayer((v) => !v)}
                className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                  showStationsLayer
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                Estaciones ({isBogotaSite ? idigerBogotaStations.length : stations.length})
              </button>
              {isBogotaSite && (
                <button
                  type="button"
                  aria-pressed={showLocalitiesLayer}
                  onClick={() => setShowLocalitiesLayer((v) => !v)}
                  className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                    showLocalitiesLayer
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Localidades Bogotá
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-slate-400 shrink-0" />
              <label htmlFor="radar-opacity" className="text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                Opacidad radar
              </label>
              <input
                id="radar-opacity"
                type="range"
                min={0.2}
                max={0.95}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-24 accent-blue-600 cursor-pointer"
              />
            </div>
          </div>

          {/* Temporal Playback Controls (shown in RainViewer mode or regional radar) */}
          {!useIdigerLive && (
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Fotograma anterior"
                  disabled={frames.length === 0}
                  onClick={() => {
                    setPlaying(false);
                    setFrameIndex((prev) => (prev - 1 + frames.length) % Math.max(1, frames.length));
                  }}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label={playing ? 'Pausar animación del radar' : 'Reproducir animación del radar'}
                  disabled={frames.length <= 1}
                  onClick={() => setPlaying((p) => !p)}
                  className="min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                >
                  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  <span>{playing ? 'Pausar' : 'Animar'}</span>
                </button>
                <button
                  type="button"
                  aria-label="Fotograma siguiente"
                  disabled={frames.length === 0}
                  onClick={() => {
                    setPlaying(false);
                    setFrameIndex((prev) => (prev + 1) % Math.max(1, frames.length));
                  }}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 min-w-[180px]">
                <label htmlFor="radar-timeline" className="sr-only">
                  Línea de tiempo de fotogramas de radar
                </label>
                <input
                  id="radar-timeline"
                  type="range"
                  min={0}
                  max={Math.max(0, frames.length - 1)}
                  value={frameIndex}
                  disabled={frames.length === 0}
                  onChange={(e) => {
                    setPlaying(false);
                    setFrameIndex(Number(e.target.value));
                  }}
                  className="w-full accent-blue-600 cursor-pointer"
                />
                <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  <span>{frames[0]?.label ?? '--:--'}</span>
                  <span>
                    {frames.length > 0 ? `Paso ${frameIndex + 1} / ${frames.length}` : 'Sin datos'}
                  </span>
                  <span>{frames[frames.length - 1]?.label ?? '--:--'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Mobile SAB Legend + Reflectivity dBZ Scale */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
            {isBogotaSite && (
              <div className="md:hidden flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-white">
                  {idigerBogotaStations.length} estaciones IDIGER (△):
                </span>
                {SAB_LEGEND_ITEMS.map((item) => (
                  <span key={item.label} className="inline-flex items-center gap-1">
                    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                      <polygon points="12,3 21.5,19.5 2.5,19.5" fill={item.color} stroke={item.stroke} strokeWidth="2" />
                    </svg>
                    {item.label}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  Reflectividad (0–70 dBZ)
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-slate-500">Ligera</span>
                  <div
                    className="h-2.5 w-36 sm:w-44 rounded-full"
                    style={{
                      background:
                        'linear-gradient(90deg, #38bdf8 0%, #22c55e 30%, #facc15 55%, #f97316 78%, #dc2626 90%, #9333ea 100%)',
                    }}
                  />
                  <span className="text-[11px] font-mono text-slate-500">Muy fuerte</span>
                </div>
              </div>

              <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <span>
                  {radar?.traceability.note ??
                    'El radar estima precipitación en área (dBZ); los 69 pluviómetros IDIGER miden lluvia puntual acumulada desde las 0:00.'}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
