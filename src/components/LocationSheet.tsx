import React, { useMemo, useState } from 'react';
import { Bookmark, Check, Crosshair, MapPin, Search, ShieldCheck, X } from 'lucide-react';
import type { FavoriteLocation, LocalityOption } from '../types/weather';

interface LocationSheetProps {
  open: boolean;
  onClose: () => void;
  localities: LocalityOption[];
  favorites: FavoriteLocation[];
  activeLocalityName: string;
  gpsEnabled: boolean;
  gpsLoading: boolean;
  gpsError: string | null;
  onSelectLocality: (loc: { label: string; locality: string; city: string; latitude: number; longitude: number; isGps?: boolean }) => void;
  onRequestGps: () => void;
  onRevokeGps: () => void;
}

export const LocationSheet: React.FC<LocationSheetProps> = ({
  open,
  onClose,
  localities,
  favorites,
  activeLocalityName,
  gpsEnabled,
  gpsLoading,
  gpsError,
  onSelectLocality,
  onRequestGps,
  onRevokeGps,
}) => {
  const [query, setQuery] = useState('');
  const [regionTab, setRegionTab] = useState<'bogota' | 'colombia'>('bogota');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return localities.filter((loc) => {
      const matchesTab = regionTab === 'bogota' ? loc.city === 'Bogotá' : loc.city !== 'Bogotá';
      if (!q) return matchesTab;
      return (
        loc.name.toLowerCase().includes(q) ||
        loc.city.toLowerCase().includes(q) ||
        loc.region.toLowerCase().includes(q)
      );
    });
  }, [localities, query, regionTab]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-sheet-title"
    >
      <div className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-t-3xl lg:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mt-3 lg:hidden" />

        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 id="location-sheet-title" className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Ubicación y cobertura
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Bogotá con cobertura prioritaria · Expansión progresiva en Colombia
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar selector de ubicación"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Privacy-first GPS consent block */}
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  GPS opcional y transparente
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Usamos tu ubicación únicamente mientras consultas la app para encontrar estaciones y alertas cercanas. No almacenamos recorridos continuos.
                </p>
              </div>
            </div>

            {gpsError && (
              <p role="alert" className="text-xs font-medium text-amber-700 dark:text-amber-400">
                {gpsError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onRequestGps}
                disabled={gpsLoading}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Crosshair className="w-4 h-4" />
                <span>{gpsLoading ? 'Consultando GPS...' : 'Usar mi ubicación actual'}</span>
              </button>
              {gpsEnabled && (
                <button
                  type="button"
                  onClick={onRevokeGps}
                  className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  Revocar uso de GPS
                </button>
              )}
            </div>
          </div>

          {/* Search input */}
          <div className="relative">
            <label htmlFor="locality-search" className="sr-only">
              Buscar localidad o ciudad
            </label>
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="locality-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar localidad en Bogotá o ciudad..."
              className="w-full min-h-[44px] pl-10 pr-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
            />
          </div>

          {/* Favorites */}
          {favorites.length > 0 && !query.trim() && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Ubicaciones favoritas
              </p>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                {favorites.map((fav) => (
                  <button
                    key={fav.id}
                    type="button"
                    onClick={() => {
                      onSelectLocality({
                        label: fav.label,
                        locality: fav.locality,
                        city: fav.city,
                        latitude: fav.latitude,
                        longitude: fav.longitude,
                      });
                      onClose();
                    }}
                    className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Bookmark className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{fav.label}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {fav.city} · <span className="font-mono tabular-nums">{fav.latitude.toFixed(2)}, {fav.longitude.toFixed(2)}</span>
                        </p>
                      </div>
                    </div>
                    {activeLocalityName === fav.locality && (
                      <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Region segmented control */}
          {!query.trim() && (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setRegionTab('bogota')}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  regionTab === 'bogota'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Bogotá (Localidades)
              </button>
              <button
                type="button"
                onClick={() => setRegionTab('colombia')}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  regionTab === 'colombia'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Otras ciudades
              </button>
            </div>
          )}

          {/* Locality list */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
            {filtered.map((loc) => {
              const isSelected = activeLocalityName === loc.name;
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => {
                    onSelectLocality({
                      label: loc.name,
                      locality: loc.name,
                      city: loc.city,
                      latitude: loc.latitude,
                      longitude: loc.longitude,
                    });
                    onClose();
                  }}
                  className="w-full min-h-[56px] px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {loc.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {loc.city} · {loc.altitudeM} m s. n. m. · {loc.coverageNote}
                      </p>
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="p-4 text-sm text-slate-500 dark:text-slate-400 text-center">
                No se encontraron zonas con ese criterio.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
