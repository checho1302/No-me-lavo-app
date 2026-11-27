import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Bell, ChevronRight, Crosshair, Layers, Maximize2, Search } from 'lucide-react';
import type { RadarProductsResponse, WeatherAlert, WeatherStation } from '../types/weather';
import { buildStationTooltipHtml, createStationLeafletIcon } from '../utils/sabMapMarkers';
import { classifySabDailyAccumulation } from '../utils/weatherLogic';

interface MapViewProps {
  center: { latitude: number; longitude: number; locality: string; city: string };
  stations: WeatherStation[];
  alerts: WeatherAlert[];
  radar: RadarProductsResponse | null;
  bogotaGeoJson: unknown | null;
  radiusKm: number;
  theme: 'light' | 'dark';
  onChangeRadius: (km: number) => void;
  onSelectStation: (station: WeatherStation) => void;
  onOpenLocations: () => void;
  onOpenAlerts: () => void;
}

const SAB_LEGEND_ITEMS = [
  { label: 'Sin lluvias (0.0)', color: '#9CA3AF', stroke: '#374151' },
  { label: 'Bajos (0–10 mm)', color: '#22D3EE', stroke: '#0E7490' },
  { label: 'Moderados (10.1–30 mm)', color: '#84CC16', stroke: '#3F6212' },
  { label: 'Altos (30.1–50 mm)', color: '#F97316', stroke: '#9A3412' },
  { label: 'Muy altos (>50.1 mm)', color: '#9333EA', stroke: '#581C87' },
];

export const MapView: React.FC<MapViewProps> = ({
  center,
  stations,
  alerts,
  radar,
  bogotaGeoJson,
  radiusKm,
  theme,
  onChangeRadius,
  onSelectStation,
  onOpenLocations,
  onOpenAlerts,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const radarTileLayerRef = useRef<L.TileLayer | null>(null);
  const idigerOverlayRef = useRef<L.ImageOverlay | null>(null);
  const localitiesLayerRef = useRef<L.GeoJSON | null>(null);
  const overlayGroupRef = useRef<L.LayerGroup | null>(null);

  const [baseStyle, setBaseStyle] = useState<'auto' | 'topo' | 'light' | 'dark'>('auto');
  const [showStations, setShowStations] = useState(true);
  const [showPrecip, setShowPrecip] = useState(true);
  const [showLocalities, setShowLocalities] = useState(true);
  const [showAlertsLayer, setShowAlertsLayer] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [onlyRainingToday, setOnlyRainingToday] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isBogota = center.city === 'Bogotá';
  const idigerCount = useMemo(
    () => stations.filter((s) => s.source === 'IDIGER' && s.city === 'Bogotá').length,
    [stations]
  );
  const rainingTodayCount = useMemo(
    () => stations.filter((s) => s.city === 'Bogotá' && (s.latestReading.accDayMm ?? 0) > 0).length,
    [stations]
  );

  const filteredStations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return stations.filter((s) => {
      const matchSource = sourceFilter === 'all' || s.source === sourceFilter;
      const matchRain = !onlyRainingToday || (s.latestReading.accDayMm ?? 0) > 0;
      const matchQ =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.locality.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q);
      return matchSource && matchRain && matchQ;
    });
  }, [stations, sourceFilter, onlyRainingToday, searchQuery]);

  // Initialize Leaflet map framed to show all of Bogotá when in Bogotá
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: isBogota ? [4.625, -74.095] : [center.latitude, center.longitude],
      zoom: isBogota ? 11 : 12,
      zoomControl: true,
    });
    overlayGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      radarTileLayerRef.current = null;
      idigerOverlayRef.current = null;
      localitiesLayerRef.current = null;
      overlayGroupRef.current = null;
    };
  }, []);

  // Re-center map when selected location changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (center.city === 'Bogotá') {
      map.setView([4.625, -74.095], 11, { animate: true });
    } else {
      map.setView([center.latitude, center.longitude], 12, { animate: true });
    }
  }, [center.latitude, center.longitude, center.city]);

  // Switch base tiles (Esri World Topo in light mode matches SAB Bogotá terrain & Cerros Orientales!)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
    }

    const effectiveStyle = baseStyle === 'auto' ? (theme === 'dark' ? 'dark' : 'topo') : baseStyle;
    let url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
    let attribution = 'Tiles &copy; Esri &mdash; World Topo Map';
    if (effectiveStyle === 'dark') {
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
      attribution = 'Tiles &copy; Esri';
    } else if (effectiveStyle === 'light') {
      url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      attribution = '&copy; OpenStreetMap contributors';
    }

    baseLayerRef.current = L.tileLayer(url, { attribution, maxZoom: 18 }).addTo(map);
  }, [baseStyle, theme]);

  // Render real Bogotá Localidades_SAB polygon outlines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (localitiesLayerRef.current) {
      map.removeLayer(localitiesLayerRef.current);
      localitiesLayerRef.current = null;
    }
    if (!showLocalities || !bogotaGeoJson) return;

    localitiesLayerRef.current = L.geoJSON(bogotaGeoJson as GeoJSON.GeoJsonObject, {
      style: {
        color: theme === 'dark' ? '#94A3B8' : '#111827',
        weight: 1.4,
        opacity: 0.88,
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
  }, [bogotaGeoJson, showLocalities, theme]);

  // Render live IDIGER Bogotá Radar 1399BOG (or RainViewer outside Bogotá)
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
    if (!showPrecip) return;

    const idigerRadar = radar?.idigerRadar;
    if (isBogota && idigerRadar?.available) {
      const { south, west, north, east } = idigerRadar.bounds;
      idigerOverlayRef.current = L.imageOverlay(
        idigerRadar.imageUrl,
        [
          [south, west],
          [north, east],
        ],
        {
          opacity: 0.78,
          zIndex: 15,
          interactive: false,
        }
      ).addTo(map);
    } else {
      const latestObserved = radar?.frames?.filter((f) => !f.isForecast).slice(-1)[0];
      if (latestObserved) {
        radarTileLayerRef.current = L.tileLayer(latestObserved.tileUrlTemplate, {
          opacity: 0.6,
          zIndex: 15,
          maxNativeZoom: 7,
          maxZoom: 16,
        }).addTo(map);
      }
    }
  }, [showPrecip, radar, isBogota]);

  // Render stations (ALL 69 IDIGER triangles △), alert zones, and user center marker
  useEffect(() => {
    const group = overlayGroupRef.current;
    if (!group) return;
    group.clearLayers();

    // Alert zones & radius ring (when enabled)
    if (showAlertsLayer) {
      L.circle([center.latitude, center.longitude], {
        radius: radiusKm * 1000,
        color: '#2563EB',
        weight: 1.5,
        fillColor: '#3B82F6',
        fillOpacity: 0.05,
      }).addTo(group);

      alerts.forEach((alert) => {
        const strokeColor = alert.category === 'user_rule' ? '#D97706' : '#0284C7';
        L.circle([alert.latitude, alert.longitude], {
          radius: Math.min(alert.radiusMeters, 12000),
          color: strokeColor,
          weight: 1.5,
          dashArray: '4 4',
          fillColor: strokeColor,
          fillOpacity: 0.07,
        })
          .bindTooltip(`${alert.title} · ${alert.locality}`, { sticky: true })
          .addTo(group);
      });
    }

    // Reference pin for user selected locality
    L.circleMarker([center.latitude, center.longitude], {
      radius: 6,
      color: '#FFFFFF',
      weight: 2,
      fillColor: '#1D4ED8',
      fillOpacity: 0.95,
    })
      .bindTooltip(`${center.locality} (Ubicación seleccionada)`, { direction: 'top' })
      .addTo(group);

    // Render ALL filtered stations with SAB triangle markers (△)
    if (showStations) {
      filteredStations.forEach((st) => {
        const marker = L.marker([st.latitude, st.longitude], {
          icon: createStationLeafletIcon(st),
          zIndexOffset: st.latestReading.isRainingNow
            ? 600
            : (st.latestReading.accDayMm ?? 0) > 0
              ? 400
              : 100,
        });
        marker.bindTooltip(buildStationTooltipHtml(st), { direction: 'top' });
        marker.on('click', () => onSelectStation(st));
        marker.addTo(group);
      });
    }
  }, [center, radiusKm, alerts, filteredStations, showStations, showAlertsLayer, onSelectStation]);

  const handleFitBogota = () => {
    mapRef.current?.setView([4.625, -74.095], 11, { animate: true });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Mapa de lluvias en tiempo real
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {isBogota
              ? `${idigerCount} estaciones IDIGER (SAB) · ${rainingTodayCount} con lluvias acumuladas hoy · Radar 1399BOG`
              : `Radio de consulta de ${radiusKm} km alrededor de ${center.locality}, ${center.city}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isBogota && (
            <button
              type="button"
              onClick={handleFitBogota}
              className="min-h-[44px] px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 whitespace-nowrap"
            >
              <Maximize2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Ver toda Bogotá</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenLocations}
            className="min-h-[44px] px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Crosshair className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>Ubicación</span>
          </button>
          <button
            type="button"
            onClick={onOpenAlerts}
            className="min-h-[44px] px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>Alertas ({alerts.length})</span>
          </button>
        </div>
      </div>

      {/* Layer Controls Toolbar */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
            <Layers className="w-4 h-4" /> Capas:
          </span>
          <button
            type="button"
            aria-pressed={showStations}
            onClick={() => setShowStations((v) => !v)}
            className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              showStations
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Estaciones ({filteredStations.length})
          </button>
          <button
            type="button"
            aria-pressed={showPrecip}
            onClick={() => setShowPrecip((v) => !v)}
            className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              showPrecip
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Radar IDIGER
          </button>
          <button
            type="button"
            aria-pressed={showLocalities}
            onClick={() => setShowLocalities((v) => !v)}
            className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              showLocalities
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Localidades
          </button>
          <button
            type="button"
            aria-pressed={showAlertsLayer}
            onClick={() => setShowAlertsLayer((v) => !v)}
            className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              showAlertsLayer
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Radio y alertas
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
            {[5, 10, 25].map((km) => (
              <button
                key={km}
                type="button"
                onClick={() => onChangeRadius(km)}
                className={`min-h-[34px] px-2.5 rounded-lg text-xs font-mono font-semibold transition-colors whitespace-nowrap ${
                  radiusKm === km
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {km} km
              </button>
            ))}
          </div>

          <label htmlFor="map-base-select" className="sr-only">
            Estilo de mapa base
          </label>
          <select
            id="map-base-select"
            value={baseStyle}
            onChange={(e) => setBaseStyle(e.target.value as 'auto' | 'topo' | 'light' | 'dark')}
            className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 border-0 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
          >
            <option value="auto">Mapa topográfico (SAB)</option>
            <option value="topo">Mapa relieve</option>
            <option value="light">Mapa calles (OSM)</option>
            <option value="dark">Mapa oscuro</option>
          </select>
        </div>
      </div>

      {/* Desktop 2-column split: Full Bogotá SAB Map + Complete 69+ Station Directory */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="relative h-[430px] lg:h-[580px] w-full flex-1">
            <div
              ref={mapContainerRef}
              data-testid="interactive-stations-map"
              className="h-full w-full"
              aria-label="Mapa geoespacial de estaciones IDIGER Bogotá y radar de lluvia"
            />

            {/* SAB Official Accumulation Legend Overlay */}
            <div className="hidden sm:block absolute bottom-7 right-3 z-[400] w-56 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-md overflow-hidden">
              <div className="bg-[#0F213D] dark:bg-blue-950 text-white px-3 py-2">
                <p className="text-xs font-bold font-display">
                  {idigerCount} Estaciones IDIGER (△)
                </p>
                <p className="text-[10px] text-sky-200">Acumulado desde las 0:00 (mm)</p>
              </div>
              <div className="p-2.5 space-y-1.5">
                {SAB_LEGEND_ITEMS.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-200">
                    <span>{item.label}</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
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
          </div>

          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Escala SAB hoy:</span>
            {SAB_LEGEND_ITEMS.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
                  <polygon points="12,3 21.5,19.5 2.5,19.5" fill={item.color} stroke={item.stroke} strokeWidth="2" />
                </svg>
                {item.label}
              </span>
            ))}
          </div>
        </div>

        {/* Station Directory Panel (ALL 69+ live stations searchable) */}
        <section
          aria-labelledby="station-catalog-heading"
          className="lg:col-span-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden"
        >
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="station-catalog-heading" className="text-base font-bold text-slate-900 dark:text-white font-display">
                Estaciones ({filteredStations.length})
              </h2>
              <button
                type="button"
                aria-pressed={onlyRainingToday}
                onClick={() => setOnlyRainingToday((v) => !v)}
                className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  onlyRainingToday
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                Con lluvia hoy ({rainingTodayCount})
              </button>
            </div>

            <div className="relative">
              <label htmlFor="station-filter-search" className="sr-only">
                Buscar estación por nombre o localidad
              </label>
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="station-filter-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar entre las 69+ estaciones o localidades..."
                className="w-full min-h-[42px] pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {['all', 'IDIGER', 'IDEAM', 'Aerocivil', 'SIATA'].map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSourceFilter(src)}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    sourceFilter === src
                      ? 'bg-[#0F213D] text-white dark:bg-blue-600'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {src === 'all' ? 'Todas' : src}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-[470px]">
            {filteredStations.map((st) => {
              const r = st.latestReading;
              const isUnavailable = st.status === 'maintenance' || r.qualityFlag === 'unavailable';
              const accDay = r.accDayMm ?? r.acc24hMm;
              const sab = classifySabDailyAccumulation(accDay);
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onSelectStation(st)}
                  className="w-full min-h-[64px] px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
                      <polygon
                        points="12,3 21.5,19.5 2.5,19.5"
                        fill={isUnavailable ? '#CBD5E1' : sab.color}
                        stroke={isUnavailable ? '#64748B' : sab.stroke}
                        strokeWidth="2"
                      />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{st.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {st.source} · {st.locality}
                        {st.distanceKm !== undefined ? ` · ${st.distanceKm.toFixed(1)} km` : ''}
                        {r.isRainingNow ? ' · Lloviendo' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <p className="text-xs font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                        {isUnavailable || accDay === null ? 'Sin lectura' : `${accDay.toFixed(1)} mm hoy`}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {st.status === 'online'
                          ? r.isRainingNow
                            ? 'Lluvia activa'
                            : 'Operativa'
                          : st.status === 'delayed'
                            ? 'Retraso'
                            : 'Mantenimiento'}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </button>
              );
            })}
            {filteredStations.length === 0 && (
              <p className="p-5 text-xs text-center text-slate-500 dark:text-slate-400">
                Ninguna estación coincide con el filtro actual.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
