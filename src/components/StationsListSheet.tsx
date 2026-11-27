import React, { useMemo, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import type { WeatherStation } from '../types/weather';
import { classifySabDailyAccumulation } from '../utils/weatherLogic';

interface StationsListSheetProps {
  open: boolean;
  onClose: () => void;
  stations: WeatherStation[];
  onSelectStation: (station: WeatherStation) => void;
}

export const StationsListSheet: React.FC<StationsListSheetProps> = ({
  open,
  onClose,
  stations,
  onSelectStation,
}) => {
  const [query, setQuery] = useState('');
  const [onlyRaining, setOnlyRaining] = useState(false);

  const bogotaCount = useMemo(
    () => stations.filter((s) => s.city.toLowerCase().includes('bogot')).length,
    [stations]
  );

  const rainingCount = useMemo(
    () =>
      stations.filter(
        (s) =>
          (s.latestReading.accDayMm ?? 0) > 0 ||
          s.latestReading.isRainingNow ||
          (s.latestReading.rainfallMmH ?? 0) > 0
      ).length,
    [stations]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stations
      .filter((s) => {
        if (onlyRaining) {
          const hasRain =
            (s.latestReading.accDayMm ?? 0) > 0 ||
            s.latestReading.isRainingNow ||
            (s.latestReading.rainfallMmH ?? 0) > 0;
          if (!hasRain) return false;
        }
        if (!q) return true;
        return (
          s.name.toLowerCase().includes(q) ||
          s.locality.toLowerCase().includes(q) ||
          s.city.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.latestReading.accDayMm ?? 0) - (a.latestReading.accDayMm ?? 0));
  }, [stations, query, onlyRaining]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stations-sheet-title"
    >
      <div className="w-full max-w-lg max-h-[86vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mt-3 sm:hidden" />

        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 id="stations-sheet-title" className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Estaciones de lluvia
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bogotaCount} estaciones SAB Bogotá · {rainingCount} con lluvia hoy
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar estaciones"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar barrio o estación..."
              className="w-full min-h-[42px] pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyRaining((v) => !v)}
            className={`min-h-[42px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
              onlyRaining
                ? 'bg-[#0F213D] dark:bg-sky-500 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            Con lluvia ({rainingCount})
          </button>
        </div>

        <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No se encontraron estaciones con ese filtro.
            </p>
          ) : (
            filtered.map((st) => {
              const r = st.latestReading;
              const isMaint = st.status === 'maintenance' || r.qualityFlag === 'unavailable';
              const sabScale = classifySabDailyAccumulation(r.accDayMm ?? r.acc24hMm);
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    onClose();
                    onSelectStation(st);
                  }}
                  className="w-full min-h-[60px] px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <svg viewBox="0 0 18 18" className="w-4 h-4 shrink-0" aria-hidden="true">
                      <polygon
                        points="9,2 16,15 2,15"
                        fill={isMaint ? '#94A3B8' : sabScale.color}
                        stroke={isMaint ? '#475569' : sabScale.stroke}
                        strokeWidth="1.5"
                      />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {st.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {st.locality} · {st.city}
                        {r.isRainingNow ? ' · Lloviendo ahora' : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                        {isMaint
                          ? 'Sin dato'
                          : r.accDayMm !== null && r.accDayMm !== undefined
                            ? `${r.accDayMm.toFixed(1)} mm`
                            : `${(r.rainfallMmH ?? 0).toFixed(1)} mm/h`}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isMaint ? 'Mantenimiento' : sabScale.label}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
