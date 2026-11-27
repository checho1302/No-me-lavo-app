import React, { useState } from 'react';
import { Calendar, Clock, CloudRain, Droplets, Info, TrendingUp, Wind } from 'lucide-react';
import type { ForecastResponse, UserPreferences } from '../types/weather';
import { describeWeatherCode, formatTemperature, formatWind } from '../utils/weatherLogic';

interface ForecastViewProps {
  forecast: ForecastResponse | null;
  loading: boolean;
  preferences: UserPreferences;
}

export const ForecastView: React.FC<ForecastViewProps> = ({ forecast, loading, preferences }) => {
  const [tab, setTab] = useState<'hourly' | 'daily' | 'history'>('hourly');

  if (loading && !forecast) {
    return (
      <div className="space-y-4">
        <div className="h-12 w-72 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        <div className="h-72 rounded-3xl bg-slate-200/80 dark:bg-slate-800/60 animate-pulse" />
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No hay datos de pronóstico disponibles para esta ubicación en este momento.
        </p>
      </div>
    );
  }

  const next24h = forecast.hourly.slice(0, 24);
  const maxHourlyMm = Math.max(2, ...next24h.map((h) => h.precipitationMm));
  const maxHistoryMm = Math.max(4, ...forecast.history.map((d) => d.precipitationSumMm));

  const formatDayName = (isoDate: string) => {
    const d = new Date(`${isoDate}T12:00:00-05:00`);
    return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  return (
    <div className="space-y-6">
      {/* Header + Segmented View Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Pronóstico e historial
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {forecast.location.locality}, {forecast.location.city} · {forecast.traceability.source}
          </p>
        </div>

        <div
          className="inline-grid grid-cols-3 gap-1 p-1 rounded-2xl bg-slate-200/70 dark:bg-slate-800 self-start sm:self-auto"
          role="tablist"
          aria-label="Vistas de pronóstico e historial"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'hourly'}
            onClick={() => setTab('hourly')}
            className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'hourly'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Por horas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'daily'}
            onClick={() => setTab('daily')}
            className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'daily'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            7 días
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            onClick={() => setTab('history')}
            className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'history'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Historial
          </button>
        </div>
      </div>

      {/* Tab 1: Hourly Forecast */}
      {tab === 'hourly' && (
        <div className="space-y-5">
          {/* Interactive Hourly Rain Bar & Probability Summary */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
                  Precipitación estimada · Próximas 24 horas
                </h2>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Pico previsto:{' '}
                {forecast.summary.peakHourTime
                  ? `${forecast.summary.peakHourMm.toFixed(1)} mm (${forecast.summary.peakHourTime.slice(11, 16)})`
                  : '0.0 mm'}
              </span>
            </div>

            {/* 24-bar precipitation chart */}
            <div className="pt-2">
              <div className="flex items-end gap-1.5 h-36" aria-label="Gráfica de lluvia por hora próximas 24 horas">
                {next24h.map((item) => {
                  const pct = Math.max(
                    item.precipitationMm > 0 ? 12 : 4,
                    Math.round((item.precipitationMm / maxHourlyMm) * 100)
                  );
                  return (
                    <div key={item.time} className="flex-1 flex flex-col items-center justify-end h-full group">
                      <span className="text-[10px] font-mono tabular-nums text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity mb-1">
                        {item.precipitationMm.toFixed(1)}
                      </span>
                      <div
                        title={`${item.time.slice(11, 16)} · ${item.precipitationMm.toFixed(1)} mm · Prob. ${item.precipitationProbPct}%`}
                        className={`w-full rounded-t-md transition-colors ${
                          item.precipitationMm >= 3
                            ? 'bg-blue-700 dark:bg-blue-400'
                            : item.precipitationMm > 0
                              ? 'bg-sky-500 dark:bg-sky-400'
                              : 'bg-slate-200 dark:bg-slate-800'
                        }`}
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span>{next24h[0]?.time.slice(11, 16)}</span>
                <span>{next24h[6]?.time.slice(11, 16)}</span>
                <span>{next24h[12]?.time.slice(11, 16)}</span>
                <span>{next24h[18]?.time.slice(11, 16)}</span>
                <span>{next24h[next24h.length - 1]?.time.slice(11, 16)}</span>
              </div>
            </div>
          </section>

          {/* Detailed Hourly Table / Cards */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
                Detalle por hora
              </h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {next24h.slice(0, 16).map((item) => (
                <div
                  key={item.time}
                  className="px-5 py-3.5 grid grid-cols-12 items-center gap-2 text-xs sm:text-sm"
                >
                  <span className="col-span-3 sm:col-span-2 font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                    {item.time.slice(11, 16)}
                  </span>
                  <span className="col-span-4 sm:col-span-3 text-slate-600 dark:text-slate-300 truncate">
                    {describeWeatherCode(item.weatherCode)}
                  </span>
                  <span className="col-span-2 sm:col-span-2 font-mono font-semibold tabular-nums text-slate-900 dark:text-white text-right">
                    {formatTemperature(item.temperatureC, preferences.tempUnit)}
                  </span>
                  <span className="col-span-3 sm:col-span-2 font-mono tabular-nums text-blue-700 dark:text-blue-400 text-right">
                    {item.precipitationProbPct}% · {item.precipitationMm.toFixed(1)} mm
                  </span>
                  <span className="hidden sm:block sm:col-span-3 font-mono tabular-nums text-slate-500 dark:text-slate-400 text-right">
                    {formatWind(item.windKmh, preferences.windUnit)} · Hum. {item.humidityPct}%
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Tab 2: 7-Day Daily Forecast */}
      {tab === 'daily' && (
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
                Pronóstico extendido · 7 días
              </h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Total previsto: {forecast.summary.totalNext7dMm.toFixed(1)} mm
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {forecast.daily.map((day, index) => (
              <div key={day.date} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white capitalize">
                    {index === 0 ? `Hoy · ${formatDayName(day.date)}` : formatDayName(day.date)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {describeWeatherCode(day.weatherCode)} · {day.uncertaintyLabel}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm font-mono tabular-nums">
                  <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 font-semibold">
                    <CloudRain className="w-4 h-4" />
                    {day.precipitationProbMaxPct}% ({day.precipitationSumMm.toFixed(1)} mm)
                  </span>
                  <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                    <Wind className="w-3.5 h-3.5" />
                    {formatWind(day.windMaxKmh, preferences.windUnit)}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {formatTemperature(day.tempMinC, preferences.tempUnit)} /{' '}
                    {formatTemperature(day.tempMaxC, preferences.tempUnit)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tab 3: Historical & Statistics */}
      {tab === 'history' && (
        <div className="space-y-5">
          {/* Temporal Comparison KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Acumulado últimos 7 días</p>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {forecast.summary.totalLast7dMm.toFixed(1)} mm
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Serie histórica observada/estimada</p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Proyección próximos 7 días</p>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400">
                {forecast.summary.totalNext7dMm.toFixed(1)} mm
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Acumulado del modelo de pronóstico</p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Tendencia semanal</p>
              <p className="mt-2 text-2xl font-bold font-display text-slate-900 dark:text-white">
                {forecast.summary.totalNext7dMm > forecast.summary.totalLast7dMm + 5
                  ? 'Más lluviosa'
                  : forecast.summary.totalNext7dMm < forecast.summary.totalLast7dMm - 5
                    ? 'Más seca'
                    : 'Estable'}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Variación{' '}
                <span className="font-mono tabular-nums">
                  {(forecast.summary.totalNext7dMm - forecast.summary.totalLast7dMm >= 0 ? '+' : '') +
                    (forecast.summary.totalNext7dMm - forecast.summary.totalLast7dMm).toFixed(1)}{' '}
                  mm
                </span>
              </p>
            </div>
          </div>

          {/* 7-Day Historical Rainfall Bar Chart */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
                Lluvia diaria acumulada · Últimos 7 días
              </h2>
            </div>

            <div className="grid grid-cols-7 gap-2 sm:gap-3 items-end h-44 pt-4">
              {forecast.history.map((day) => {
                const pct = Math.max(
                  day.precipitationSumMm > 0 ? 12 : 5,
                  Math.round((day.precipitationSumMm / maxHistoryMm) * 100)
                );
                return (
                  <div key={day.date} className="flex flex-col items-center justify-end h-full gap-1.5">
                    <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {day.precipitationSumMm.toFixed(1)}
                    </span>
                    <div
                      className={`w-full max-w-[44px] rounded-t-xl transition-all ${
                        day.precipitationSumMm > 0
                          ? 'bg-[#0F213D] dark:bg-blue-500'
                          : 'bg-slate-200 dark:bg-slate-800'
                      }`}
                      style={{ height: `${pct}%` }}
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 capitalize truncate max-w-full">
                      {formatDayName(day.date).split(',')[0]}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* Traceability & Uncertainty Note */}
      <div className="rounded-2xl bg-slate-100/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 p-4 flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
        <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-slate-900 dark:text-white">Diferencia entre observación, radar y pronóstico:</strong>{' '}
          {forecast.traceability.note ??
            'Los pronósticos comunican probabilidad e incertidumbre y no equivalen a mediciones en tiempo real ni a alertas oficiales.'}{' '}
          <span className="inline-flex items-center gap-1 ml-1 font-mono tabular-nums text-slate-500">
            <Droplets className="w-3 h-3" /> Recibido:{' '}
            {new Date(forecast.traceability.receivedAt).toLocaleTimeString('es-CO', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </p>
      </div>
    </div>
  );
};
