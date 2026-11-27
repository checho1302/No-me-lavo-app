import React, { useEffect, useState } from 'react';
import { AlertCircle, Clock, Cpu, Droplets, Gauge, Thermometer, Wind, X } from 'lucide-react';
import type { StationObservationPoint, TraceabilityMeta, UserPreferences, WeatherStation } from '../types/weather';
import {
  classifyRainfallIntensity,
  classifySabDailyAccumulation,
  evaluateFreshness,
  formatTemperature,
  formatWind,
} from '../utils/weatherLogic';

interface StationDetailSheetProps {
  station: WeatherStation | null;
  preferences: UserPreferences;
  onClose: () => void;
}

export const StationDetailSheet: React.FC<StationDetailSheetProps> = ({
  station,
  preferences,
  onClose,
}) => {
  const [observations, setObservations] = useState<StationObservationPoint[]>([]);
  const [traceability, setTraceability] = useState<TraceabilityMeta | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!station) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/stations/${encodeURIComponent(station.id)}/observations`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setObservations(Array.isArray(data.observations) ? data.observations : []);
        setTraceability(data.traceability ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setObservations([]);
          setTraceability(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [station]);

  if (!station) return null;

  const r = station.latestReading;
  const rainClass = classifyRainfallIntensity(r.rainfallMmH);
  const isSabStation = station.source === 'IDIGER' || r.accDayMm !== null;
  const sabScale = classifySabDailyAccumulation(r.accDayMm ?? r.acc24hMm);
  const freshness = evaluateFreshness(r.observedAt);
  const maxRain = Math.max(0.5, ...observations.map((o) => o.rainfallMm ?? 0));
  const hasClimateVars =
    r.temperatureC !== null || r.humidityPct !== null || r.windKmh !== null;

  const statusText =
    station.status === 'online'
      ? 'Operativa'
      : station.status === 'delayed'
        ? 'Con retraso'
        : 'En mantenimiento';

  const qualityText =
    r.qualityFlag === 'valid'
      ? 'Calidad validada'
      : r.qualityFlag === 'delayed'
        ? 'Lectura retrasada'
        : r.qualityFlag === 'unavailable'
          ? 'Sin lectura disponible'
          : 'Revisión pendiente';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="station-sheet-title"
    >
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-t-3xl lg:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mt-3 lg:hidden" />

        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {station.source} · {station.type} · {statusText}
            </p>
            <h2 id="station-sheet-title" className="text-lg font-bold text-slate-900 dark:text-white font-display mt-0.5">
              {station.name}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {station.locality}, {station.city} · {station.altitudeM} m s. n. m.
              {station.distanceKm !== undefined ? ` · A ${station.distanceKm.toFixed(1)} km` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ficha de estación"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
          {station.status === 'maintenance' || r.qualityFlag === 'unavailable' ? (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Sin observación válida disponible
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  Esta estación se encuentra en mantenimiento o sin transmisión reciente. En No me lavo los valores se muestran como nulos y no se interpolan artificialmente.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Rainfall Accumulations */}
              {isSabStation ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Acumulado hoy (0:00)</p>
                    <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {r.accDayMm !== null && r.accDayMm !== undefined
                        ? `${r.accDayMm.toFixed(1)} mm`
                        : '--'}
                    </p>
                    <p className="text-xs mt-0.5 flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      <svg viewBox="0 0 14 14" className="w-3 h-3 shrink-0" aria-hidden="true">
                        <polygon points="7,1 13,12 1,12" fill={sabScale.color} stroke={sabScale.stroke} strokeWidth="1.3" />
                      </svg>
                      <span className="truncate">{sabScale.label}</span>
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Lectura actual</p>
                    <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {r.rainfallMmH !== null ? `${r.rainfallMmH.toFixed(1)} mm` : '--'}
                    </p>
                    <p className={`text-xs mt-0.5 ${r.isRainingNow ? 'text-cyan-700 dark:text-cyan-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                      {r.isRainingNow ? 'Lloviendo ahora' : rainClass.label}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Acumulado 1 h</p>
                    <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {r.acc1hMm !== null ? `${r.acc1hMm.toFixed(1)} mm` : '--'}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Acumulado 24 h</p>
                    <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {r.acc24hMm !== null ? `${r.acc24hMm.toFixed(1)} mm` : '--'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Intensidad actual</p>
                    <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {r.rainfallMmH !== null ? `${r.rainfallMmH.toFixed(1)} mm/h` : '--'}
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">{rainClass.label}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Acumulado 1 h</p>
                    <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {r.acc1hMm !== null ? `${r.acc1hMm.toFixed(1)} mm` : '--'}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Acumulado 6 h</p>
                    <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {r.acc6hMm !== null ? `${r.acc6hMm.toFixed(1)} mm` : '--'}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Acumulado 24 h</p>
                    <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {r.acc24hMm !== null ? `${r.acc24hMm.toFixed(1)} mm` : '--'}
                    </p>
                  </div>
                </div>
              )}

              {/* Atmospheric secondary variables or SAB sensor hardware details */}
              {hasClimateVars ? (
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
                    <Thermometer className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Temp.</p>
                      <p className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                        {formatTemperature(r.temperatureC, preferences.tempUnit)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
                    <Droplets className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Humedad</p>
                      <p className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                        {r.humidityPct !== null ? `${r.humidityPct}%` : '--'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
                    <Wind className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Viento</p>
                      <p className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                        {formatWind(r.windKmh, preferences.windUnit)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
                    <Cpu className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 dark:text-slate-400">Tecnología del sensor</p>
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {station.technology ?? station.type}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
                    <Gauge className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 dark:text-slate-400">Presión atmosférica</p>
                      <p className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                        {r.pressureHpa !== null && r.pressureHpa !== undefined
                          ? `${r.pressureHpa.toFixed(1)} hPa`
                          : 'Sensor pluviométrico'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Historical 24h bar chart */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Histórico de lluvia · Últimas 24 horas
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Máx. escala {maxRain.toFixed(1)} mm/h
              </span>
            </div>

            {loading ? (
              <div className="h-36 rounded-2xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
            ) : observations.length > 0 ? (
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4">
                <div className="flex items-end gap-1 h-28" aria-label="Gráfica de lluvia por hora últimas 24 horas">
                  {observations.map((obs) => {
                    const val = obs.rainfallMm ?? 0;
                    const heightPct = Math.max(val > 0 ? 10 : 4, Math.round((val / maxRain) * 100));
                    const hourLabel = obs.timestamp.slice(11, 16);
                    return (
                      <div key={obs.timestamp} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                        <div
                          title={`${hourLabel}: ${val.toFixed(1)} mm`}
                          className={`w-full rounded-t-sm transition-all ${
                            val > 0
                              ? 'bg-blue-600 dark:bg-blue-500 group-hover:bg-blue-700'
                              : 'bg-slate-200 dark:bg-slate-700/70'
                          }`}
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  <span>{observations[0]?.timestamp.slice(11, 16)}</span>
                  <span>{observations[Math.floor(observations.length / 2)]?.timestamp.slice(11, 16)}</span>
                  <span>{observations[observations.length - 1]?.timestamp.slice(11, 16)}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 rounded-2xl border border-slate-200/70 dark:border-slate-800 p-4">
                No hay serie histórica disponible para esta estación en este momento.
              </p>
            )}
          </div>

          {/* Traceability metadata block */}
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 p-4 space-y-2 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
              <Gauge className="w-4 h-4 text-slate-500" />
              <span>Trazabilidad del dato</span>
            </div>
            <p>
              Fuente: <strong className="font-medium text-slate-800 dark:text-slate-100">{traceability?.source ?? station.source}</strong> · Tipo:{' '}
              {r.dataCategory === 'observation' ? 'Observación directa' : 'Estimación normalizada'}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Medición: {r.observedAt ? new Date(r.observedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : 'Sin lectura'} ({freshness.label})</span>
              <span aria-hidden="true">·</span>
              <span>Recepción: {new Date(r.receivedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
              <span aria-hidden="true">·</span>
              <span>{qualityText}</span>
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Coordenadas: <span className="font-mono tabular-nums">{station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}</span>
              {station.sensorId ? (
                <>
                  {' '}· Sensor SAB <span className="font-mono tabular-nums">#{station.sensorId}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
