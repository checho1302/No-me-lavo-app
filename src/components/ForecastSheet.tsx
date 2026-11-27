import React from 'react';
import { Cloud, CloudDrizzle, CloudLightning, CloudRain, Droplets, Sun, X } from 'lucide-react';
import type { ForecastResponse, UserPreferences } from '../types/weather';
import { formatTemperature } from '../utils/weatherLogic';

interface ForecastSheetProps {
  open: boolean;
  onClose: () => void;
  forecast: ForecastResponse | null;
  loading: boolean;
  preferences: UserPreferences;
  locationLabel: string;
}

function SmallWeatherIcon({ code }: { code: number }) {
  if (code >= 95) return <CloudLightning className="w-5 h-5 text-amber-500" />;
  if (code >= 61 || (code >= 80 && code <= 82)) return <CloudRain className="w-5 h-5 text-sky-600 dark:text-sky-400" />;
  if (code >= 51 && code <= 55) return <CloudDrizzle className="w-5 h-5 text-sky-500" />;
  if (code <= 1) return <Sun className="w-5 h-5 text-amber-500" />;
  return <Cloud className="w-5 h-5 text-slate-400" />;
}

export const ForecastSheet: React.FC<ForecastSheetProps> = ({
  open,
  onClose,
  forecast,
  loading,
  preferences,
  locationLabel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forecast-sheet-title"
    >
      <div className="w-full max-w-lg max-h-[86vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mt-3 sm:hidden" />

        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 id="forecast-sheet-title" className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Pronóstico de lluvia
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{locationLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar pronóstico"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
          {loading || !forecast ? (
            <div className="space-y-3">
              <div className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
              <div className="h-44 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
            </div>
          ) : (
            <>
              {/* Próximas horas */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Próximas horas
                </h3>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {forecast.hourly.slice(0, 12).map((h) => (
                    <div
                      key={h.time}
                      className="min-w-[68px] rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 p-2.5 flex flex-col items-center gap-1.5 shrink-0"
                    >
                      <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {h.time.slice(11, 16)}
                      </span>
                      <SmallWeatherIcon code={h.weatherCode} />
                      <span className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                        {formatTemperature(h.temperatureC, preferences.tempUnit)}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-sky-700 dark:text-sky-400 inline-flex items-center gap-0.5">
                        <Droplets className="w-3 h-3" />
                        {h.precipitationProbPct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Próximos 7 días */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Próximos 7 días
                </h3>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {forecast.daily.map((d) => {
                    const dayName = new Date(`${d.date}T12:00:00`).toLocaleDateString('es-CO', {
                      weekday: 'short',
                      day: 'numeric',
                    });
                    return (
                      <div key={d.date} className="py-2.5 flex items-center justify-between gap-3">
                        <span className="w-20 text-sm font-semibold capitalize text-slate-800 dark:text-slate-100">
                          {dayName}
                        </span>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <SmallWeatherIcon code={d.weatherCode} />
                          <span className="text-xs font-mono tabular-nums text-sky-700 dark:text-sky-400">
                            {d.precipitationProbMaxPct}% · {d.precipitationSumMm.toFixed(1)} mm
                          </span>
                        </div>
                        <span className="text-sm font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                          {formatTemperature(d.tempMaxC, preferences.tempUnit)} /{' '}
                          <span className="text-slate-400">
                            {formatTemperature(d.tempMinC, preferences.tempUnit)}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
