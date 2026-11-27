import React from 'react';
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  Cloud,
  CloudDrizzle,
  CloudLightning,
  CloudRain,
  Compass,
  Droplets,
  Gauge,
  MapPin,
  MessageSquarePlus,
  Radio,
  RefreshCw,
  Sun,
  Wind,
} from 'lucide-react';
import type {
  CitizenReport,
  NavTab,
  NearbyWeatherResponse,
  UserPreferences,
  WeatherStation,
} from '../types/weather';
import {
  classifySabDailyAccumulation,
  evaluateFreshness,
  formatTemperature,
  formatWind,
} from '../utils/weatherLogic';

interface HomeViewProps {
  weather: NearbyWeatherResponse | null;
  loading: boolean;
  error: string | null;
  preferences: UserPreferences;
  reports: CitizenReport[];
  isGpsActive: boolean;
  onRefresh: () => void;
  onOpenLocations: () => void;
  onOpenAlerts: () => void;
  onOpenReports: () => void;
  onSelectStation: (station: WeatherStation) => void;
  onNavigate: (tab: NavTab) => void;
}

function WeatherGlyph({ code }: { code: number | null }) {
  if (code === null) return <Cloud className="w-9 h-9 text-blue-200" />;
  if (code >= 95) return <CloudLightning className="w-9 h-9 text-amber-300" />;
  if (code >= 61 || (code >= 80 && code <= 82)) return <CloudRain className="w-9 h-9 text-sky-300" />;
  if (code >= 51 && code <= 55) return <CloudDrizzle className="w-9 h-9 text-sky-200" />;
  if (code <= 1) return <Sun className="w-9 h-9 text-amber-300" />;
  return <Cloud className="w-9 h-9 text-slate-200" />;
}

export const HomeView: React.FC<HomeViewProps> = ({
  weather,
  loading,
  error,
  preferences,
  reports,
  isGpsActive,
  onRefresh,
  onOpenLocations,
  onOpenAlerts,
  onOpenReports,
  onSelectStation,
  onNavigate,
}) => {
  if (loading && !weather) {
    return (
      <div className="space-y-5">
        <div className="h-64 rounded-3xl bg-slate-200/80 dark:bg-slate-800/60 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="h-44 rounded-3xl bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
          <div className="h-44 rounded-3xl bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error && !weather) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
          No fue posible consultar el clima cercano
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">{error}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!weather) return null;

  const freshness = evaluateFreshness(weather.lastUpdated);
  const activeAlerts = weather.alerts.filter((a) => a.active);
  const officialCount = activeAlerts.filter((a) => a.category === 'official_alert').length;
  const userRuleCount = activeAlerts.filter((a) => a.category === 'user_rule').length;

  return (
    <div className="space-y-6">
      {/* Primary Meteorological Hero Anchor */}
      <section
        aria-label="Condiciones meteorológicas actuales"
        className="rounded-3xl bg-gradient-to-br from-[#0F213D] via-[#15315B] to-[#1D4E89] text-white p-6 sm:p-7 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onOpenLocations}
              className="group inline-flex items-center gap-1.5 min-h-[44px] -ml-2 px-2 rounded-xl hover:bg-white/10 transition-colors text-left max-w-full"
            >
              <MapPin className="w-4 h-4 text-sky-300 shrink-0" />
              <span className="text-lg sm:text-xl font-bold font-display tracking-tight truncate">
                {weather.location.locality}, {weather.location.city}
              </span>
              <ChevronRight className="w-4 h-4 text-sky-200/80 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>
            <p className="text-xs text-sky-100/80 mt-0.5">
              {isGpsActive ? 'GPS activo' : 'Selección manual'} ·{' '}
              <span className="font-mono tabular-nums whitespace-nowrap">{weather.location.altitudeM} msnm</span> ·{' '}
              <span className="whitespace-nowrap">{freshness.label}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            aria-label="Actualizar condiciones meteorológicas"
            className="min-h-[44px] min-w-[44px] px-2.5 sm:px-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>

        {/* Main temperature + precipitation readout */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
          <div className="md:col-span-6 flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
              <WeatherGlyph code={weather.current.weatherCode} />
            </div>
            <div>
              <p className="text-5xl sm:text-6xl font-bold font-display tracking-tight tabular-nums leading-none">
                {formatTemperature(weather.current.temperatureC, preferences.tempUnit)}
              </p>
              <p className="mt-2 text-sm sm:text-base font-medium text-sky-100">
                {weather.current.conditionLabel} · Sensación{' '}
                <span className="font-mono tabular-nums">
                  {formatTemperature(weather.current.feelsLikeC, preferences.tempUnit)}
                </span>
              </p>
            </div>
          </div>

          <div className="md:col-span-6 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 md:pt-0 border-t border-white/15 md:border-t-0">
            <div>
              <p className="text-xs text-sky-200/80">Lluvia actual</p>
              <p className="mt-1 text-lg font-bold font-mono tabular-nums">
                {weather.rainfall.value !== null ? `${weather.rainfall.value.toFixed(1)} mm/h` : 'Sin lectura'}
              </p>
              <p className="text-[11px] text-sky-200/90">{weather.rainfall.levelLabel}</p>
            </div>
            <div>
              <p className="text-xs text-sky-200/80">Acum. 24 h</p>
              <p className="mt-1 text-lg font-bold font-mono tabular-nums">
                {weather.rainfall.acc24hMm !== null ? `${weather.rainfall.acc24hMm.toFixed(1)} mm` : '--'}
              </p>
              <p className="text-[11px] text-sky-200/90">
                Prob. {weather.rainfall.probabilityPct !== null ? `${weather.rainfall.probabilityPct}%` : '--'}
              </p>
            </div>
            <div>
              <p className="text-xs text-sky-200/80">Humedad</p>
              <p className="mt-1 text-lg font-bold font-mono tabular-nums">
                {weather.current.humidityPct !== null ? `${weather.current.humidityPct}%` : '--'}
              </p>
              <p className="text-[11px] text-sky-200/90">
                {weather.current.pressureHpa !== null ? `${weather.current.pressureHpa} hPa` : '--'}
              </p>
            </div>
            <div>
              <p className="text-xs text-sky-200/80">Viento</p>
              <p className="mt-1 text-lg font-bold font-mono tabular-nums">
                {formatWind(weather.current.windKmh, preferences.windUnit)}
              </p>
              <p className="text-[11px] text-sky-200/90">
                {weather.current.windDirectionDeg !== null ? `Dir. ${weather.current.windDirectionDeg}°` : '--'}
              </p>
            </div>
          </div>
        </div>

        {/* Traceability Footer Line (Zero-Pill Clean Metadata) */}
        <div className="mt-6 pt-4 border-t border-white/15 flex flex-wrap items-center justify-between gap-2 text-[11px] text-sky-100/80">
          <span>
            Fuente: {weather.traceability.source} · Tipo: Estimación atmosférica
          </span>
          <span className="font-mono tabular-nums">
            Actualizado:{' '}
            {weather.lastUpdated
              ? new Date(weather.lastUpdated).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
              : 'Sin dato'}
          </span>
        </div>
      </section>

      {/* Primary Quick Actions Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => onNavigate('radar')}
          className="min-h-[56px] px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 flex items-center justify-between gap-3 text-left transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Radio className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">Radar en vivo</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Reflectividad y animación</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={onOpenAlerts}
          className="min-h-[56px] px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 flex items-center justify-between gap-3 text-left transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">Centro de alertas</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {officialCount} oficial · {userRuleCount} regla propia
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={onOpenReports}
          className="min-h-[56px] px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 flex items-center justify-between gap-3 text-left transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <MessageSquarePlus className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">Reportar lluvia</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{reports.length} reportes recientes</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      </div>

      {/* Main Two-Column Desktop Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Nearby Stations List */}
        <section
          aria-labelledby="nearby-stations-heading"
          className="lg:col-span-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h2 id="nearby-stations-heading" className="text-base font-bold text-slate-900 dark:text-white font-display">
                Estaciones cercanas
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Toca una estación para revisar acumulados, histórico 24 h y calidad
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('mapa')}
              className="min-h-[40px] px-3 rounded-xl text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 whitespace-nowrap"
            >
              Ver en mapa
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {weather.nearestStations.map((st) => {
              const r = st.latestReading;
              const isMaint = st.status === 'maintenance' || r.qualityFlag === 'unavailable';
              const isSab = st.source.includes('SAB') || r.accDayMm !== undefined;
              const sabScale = classifySabDailyAccumulation(r.accDayMm ?? r.acc24hMm);
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onSelectStation(st)}
                  className="w-full min-h-[68px] px-5 py-3.5 flex items-center justify-between gap-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isSab && (
                      <svg
                        viewBox="0 0 18 18"
                        className="w-4 h-4 shrink-0"
                        aria-hidden="true"
                      >
                        <polygon
                          points="9,2 16,15 2,15"
                          fill={isMaint ? '#94A3B8' : sabScale.color}
                          stroke={isMaint ? '#475569' : sabScale.stroke}
                          strokeWidth="1.5"
                        />
                      </svg>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{st.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {st.source} · {st.locality}
                        {st.distanceKm !== undefined ? ` · ${st.distanceKm.toFixed(1)} km` : ''}
                        {r.isRainingNow ? ' · Lloviendo ahora' : ''}
                        {st.status === 'delayed' ? ' · Retraso' : st.status === 'maintenance' ? ' · Mantenimiento' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      {isSab ? (
                        <>
                          <p className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                            {isMaint || r.accDayMm === null || r.accDayMm === undefined
                              ? 'Sin lectura'
                              : `Hoy: ${r.accDayMm.toFixed(1)} mm`}
                          </p>
                          <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {isMaint
                              ? 'Nulo'
                              : `Actual: ${r.rainfallMmH !== null ? `${r.rainfallMmH.toFixed(1)} mm` : '--'}`}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                            {isMaint || r.rainfallMmH === null ? 'Sin lectura' : `${r.rainfallMmH.toFixed(1)} mm/h`}
                          </p>
                          <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {isMaint ? 'Nulo' : `24h: ${r.acc24hMm !== null ? `${r.acc24hMm.toFixed(1)} mm` : '--'}`}
                          </p>
                        </>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Active Alerts & Citizen Reports Column */}
        <div className="lg:col-span-5 space-y-6">
          <section
            aria-labelledby="home-alerts-heading"
            className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="home-alerts-heading" className="text-base font-bold text-slate-900 dark:text-white font-display">
                Alertas activas en tu zona
              </h2>
              <button
                type="button"
                onClick={onOpenAlerts}
                className="min-h-[40px] px-3 rounded-xl text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 whitespace-nowrap"
              >
                Gestionar reglas
              </button>
            </div>

            <div className="space-y-3">
              {activeAlerts.map((alert) => (
                <article
                  key={alert.id}
                  className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800 p-4 space-y-1.5"
                >
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <AlertTriangle
                      className={`w-3.5 h-3.5 shrink-0 ${
                        alert.category === 'user_rule'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-blue-600 dark:text-blue-400'
                      }`}
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {alert.category === 'official_alert' ? 'Aviso oficial / preventivo' : 'Regla propia'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{alert.locality}</span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{alert.title}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{alert.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="home-community-heading"
            className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="home-community-heading" className="text-base font-bold text-slate-900 dark:text-white font-display">
                Reportes ciudadanos recientes
              </h2>
              <button
                type="button"
                onClick={onOpenReports}
                className="min-h-[40px] px-3 rounded-xl text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 whitespace-nowrap"
              >
                Nuevo reporte
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {reports.slice(0, 3).map((rep) => (
                <div key={rep.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <strong className="font-semibold text-slate-800 dark:text-slate-200">{rep.locality}</strong> ·{' '}
                    {rep.moderationStatus === 'verificado' ? 'Verificado' : 'En revisión'} ·{' '}
                    <span className="font-mono tabular-nums">
                      {new Date(rep.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{rep.description}</p>
                </div>
              ))}
            </div>

            {/* Atmospheric Context Bar */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Droplets className="w-3.5 h-3.5" /> Pluviómetros miden en punto
              </span>
              <span className="inline-flex items-center gap-1">
                <Compass className="w-3.5 h-3.5" /> Radar estima en área
              </span>
              <span className="inline-flex items-center gap-1">
                <Gauge className="w-3.5 h-3.5" /> Trazabilidad activa
              </span>
              <span className="inline-flex items-center gap-1">
                <Wind className="w-3.5 h-3.5" /> Bogotá y Colombia
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
