import React from 'react';
import {
  Bookmark,
  LocateFixed,
  MapPin,
  Moon,
  Sun,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { FavoriteLocation, UserPreferences } from '../types/weather';
import { PWAInstallButton } from './PWAInstallButton';

interface ProfileSheetProps {
  open: boolean;
  onClose: () => void;
  preferences: UserPreferences;
  activeLocation: {
    label: string;
    locality: string;
    city: string;
    latitude: number;
    longitude: number;
  };
  favorites: FavoriteLocation[];
  gpsEnabled: boolean;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
  onRequestGps: () => void;
  onRevokeGps: () => void;
  onSaveCurrentFavorite: () => Promise<void>;
  onSelectFavorite: (fav: FavoriteLocation) => void;
  onDeleteFavorite: (id: string) => Promise<void>;
  onOpenLocations: () => void;
}

export const ProfileSheet: React.FC<ProfileSheetProps> = ({
  open,
  onClose,
  preferences,
  activeLocation,
  favorites,
  gpsEnabled,
  onUpdatePreferences,
  onRequestGps,
  onRevokeGps,
  onSaveCurrentFavorite,
  onSelectFavorite,
  onDeleteFavorite,
  onOpenLocations,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-sheet-title"
    >
      <div className="w-full max-w-md max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mt-3 sm:hidden" />

        {/* Header with circular profile badge */}
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full bg-[#0F213D] dark:bg-sky-500 text-white flex items-center justify-center shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="profile-sheet-title" className="text-base font-bold text-slate-900 dark:text-white font-display truncate">
                Mi perfil · No me lavo
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {activeLocation.locality}, {activeLocation.city}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar perfil"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Quick Appearance & Units */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Tema visual</span>
              <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
                <button
                  type="button"
                  onClick={() => onUpdatePreferences({ theme: 'light' })}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    preferences.theme === 'light'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" /> Claro
                </button>
                <button
                  type="button"
                  onClick={() => onUpdatePreferences({ theme: 'dark' })}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    preferences.theme === 'dark'
                      ? 'bg-slate-700 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" /> Oscuro
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Temperatura</span>
              <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
                {(['C', 'F'] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => onUpdatePreferences({ tempUnit: unit })}
                    className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold transition-colors ${
                      preferences.tempUnit === unit
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    °{unit}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Location & GPS */}
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Ubicación</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {gpsEnabled ? 'GPS activado' : 'Selección manual'}
                </p>
              </div>
              <button
                type="button"
                onClick={gpsEnabled ? onRevokeGps : onRequestGps}
                className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                  gpsEnabled
                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'
                    : 'bg-[#0F213D] dark:bg-sky-500 text-white'
                }`}
              >
                <LocateFixed className="w-3.5 h-3.5" />
                {gpsEnabled ? 'Desactivar GPS' : 'Usar mi GPS'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenLocations();
              }}
              className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-sky-400 inline-flex items-center justify-center gap-2"
            >
              <MapPin className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              Cambiar ciudad o localidad
            </button>
          </div>

          {/* Saved Favorites */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Lugares favoritos
              </h3>
              <button
                type="button"
                onClick={() => void onSaveCurrentFavorite()}
                className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 inline-flex items-center gap-1"
              >
                <Bookmark className="w-3.5 h-3.5" />
                Guardar actual
              </button>
            </div>

            {favorites.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Guarda tu casa o trabajo para ver si llueve con un toque.
              </p>
            ) : (
              <div className="space-y-1.5">
                {favorites.map((fav) => (
                  <div
                    key={fav.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectFavorite(fav);
                        onClose();
                      }}
                      className="flex-1 min-h-[36px] text-left min-w-0"
                    >
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{fav.label}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{fav.city}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteFavorite(fav.id)}
                      aria-label={`Eliminar ${fav.label}`}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Install PWA */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <PWAInstallButton />
          </div>
        </div>
      </div>
    </div>
  );
};
