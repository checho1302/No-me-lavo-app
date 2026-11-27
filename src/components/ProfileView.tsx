import React, { useState } from 'react';
import {
  Bell,
  Bookmark,
  CheckCircle2,
  Crosshair,
  MessageSquarePlus,
  Moon,
  Plus,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react';
import type {
  CitizenReport,
  CustomAlertRule,
  FavoriteLocation,
  UserPreferences,
} from '../types/weather';
import { PWAInstallButton } from './PWAInstallButton';

interface ProfileViewProps {
  preferences: UserPreferences;
  activeLocation: { label: string; locality: string; city: string; latitude: number; longitude: number };
  favorites: FavoriteLocation[];
  rules: CustomAlertRule[];
  reports: CitizenReport[];
  gpsEnabled: boolean;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
  onRequestGps: () => void;
  onRevokeGps: () => void;
  onSaveCurrentFavorite: () => Promise<void>;
  onSelectFavorite: (fav: FavoriteLocation) => void;
  onDeleteFavorite: (id: string) => Promise<void>;
  onOpenAlerts: () => void;
  onOpenReports: () => void;
  onRegisterPush: () => Promise<void>;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  preferences,
  activeLocation,
  favorites,
  rules,
  reports,
  gpsEnabled,
  onUpdatePreferences,
  onRequestGps,
  onRevokeGps,
  onSaveCurrentFavorite,
  onSelectFavorite,
  onDeleteFavorite,
  onOpenAlerts,
  onOpenReports,
  onRegisterPush,
}) => {
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [favSavedMsg, setFavSavedMsg] = useState<string | null>(null);

  const handleEnablePush = async () => {
    await onRegisterPush();
    setPushMessage('Preferencia de notificaciones push registrada en este dispositivo.');
  };

  const handleSaveFav = async () => {
    await onSaveCurrentFavorite();
    setFavSavedMsg(`"${activeLocation.locality}" guardada en favoritos.`);
    setTimeout(() => setFavSavedMsg(null), 3500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
          Perfil, privacidad y preferencias
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          Controla permisos de ubicación, favoritos, alertas personales y visualización
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Column 1: Privacy, GPS, Preferences */}
        <div className="lg:col-span-6 space-y-6">
          {/* Privacy & GPS Control */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
                  Privacidad y permisos GPS
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  Pluvia no guarda historial continuo de desplazamientos por defecto. El GPS es opcional y puedes revocarlo en cualquier momento.
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Estado actual del permiso</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                  {gpsEnabled ? 'GPS activo mientras usas la app' : 'Solo selección manual de localidad'}
                </p>
              </div>
              {gpsEnabled ? (
                <button
                  type="button"
                  onClick={onRevokeGps}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  Revocar GPS
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onRequestGps}
                  className="min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                >
                  <Crosshair className="w-4 h-4" />
                  <span>Activar GPS</span>
                </button>
              )}
            </div>
          </section>

          {/* Units & Appearance Preferences */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
              Unidades y apariencia
            </h2>

            {/* Theme Switch */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Tema visual</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Optimizado para lectura diurna y nocturna</p>
              </div>
              <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  aria-pressed={preferences.theme === 'light'}
                  onClick={() => onUpdatePreferences({ theme: 'light' })}
                  className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    preferences.theme === 'light'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" /> Claro
                </button>
                <button
                  type="button"
                  aria-pressed={preferences.theme === 'dark'}
                  onClick={() => onUpdatePreferences({ theme: 'dark' })}
                  className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    preferences.theme === 'dark'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" /> Oscuro
                </button>
              </div>
            </div>

            {/* Temperature Unit */}
            <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Temperatura</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Unidad para condiciones y pronóstico</p>
              </div>
              <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                {(['C', 'F'] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    aria-pressed={preferences.tempUnit === unit}
                    onClick={() => onUpdatePreferences({ tempUnit: unit })}
                    className={`min-h-[38px] px-3.5 rounded-lg text-xs font-mono font-semibold transition-colors ${
                      preferences.tempUnit === unit
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    °{unit}
                  </button>
                ))}
              </div>
            </div>

            {/* Wind Unit */}
            <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Velocidad del viento</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Lecturas de estaciones y pronóstico</p>
              </div>
              <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                {(['km/h', 'm/s'] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    aria-pressed={preferences.windUnit === unit}
                    onClick={() => onUpdatePreferences({ windUnit: unit })}
                    className={`min-h-[38px] px-3 rounded-lg text-xs font-mono font-semibold transition-colors whitespace-nowrap ${
                      preferences.windUnit === unit
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Install Mobile App PWA Card */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
              Aplicación móvil instalable
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Agrega Pluvia Intelligence a tu pantalla de inicio en iOS o Android para abrirla sin barras del navegador y conservar los últimos datos en caché.
            </p>
            <PWAInstallButton />
          </section>
        </div>

        {/* Column 2: Favorites, Alerts, Citizen Reports, Push */}
        <div className="lg:col-span-6 space-y-6">
          {/* Favorite Locations */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
                  Ubicaciones favoritas ({favorites.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={handleSaveFav}
                className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Guardar {activeLocation.locality}</span>
              </button>
            </div>

            {favSavedMsg && (
              <p role="status" className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {favSavedMsg}
              </p>
            )}

            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
              {favorites.map((fav) => (
                <div key={fav.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectFavorite(fav)}
                    className="flex-1 min-w-0 text-left min-h-[44px] flex flex-col justify-center"
                  >
                    <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">{fav.label}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {fav.city} · {fav.latitude.toFixed(2)}, {fav.longitude.toFixed(2)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteFavorite(fav.id)}
                    aria-label={`Eliminar favorito ${fav.label}`}
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {favorites.length === 0 && (
                <p className="p-4 text-xs text-slate-500 dark:text-slate-400 text-center">
                  No tienes favoritos guardados. Solo se guardan por decisión explícita tuya.
                </p>
              )}
            </div>
          </section>

          {/* Push Notifications & Quick Links */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
              Alertas push y reportes ciudadanos
            </h2>

            <div className="space-y-3">
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    Notificaciones en este dispositivo
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {preferences.pushEnabled
                      ? 'Token registrado para reglas de lluvia cercanas'
                      : 'Activa avisos para tus reglas configuradas'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleEnablePush}
                  className="min-h-[44px] px-4 rounded-xl bg-[#0F213D] hover:bg-[#18335C] dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold whitespace-nowrap"
                >
                  {preferences.pushEnabled ? 'Actualizar registro' : 'Activar avisos'}
                </button>
              </div>

              {pushMessage && (
                <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{pushMessage}</span>
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={onOpenAlerts}
                  className="min-h-[52px] px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 flex items-center gap-3 text-left transition-colors"
                >
                  <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">Mis reglas de alerta</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{rules.length} configuradas</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={onOpenReports}
                  className="min-h-[52px] px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 flex items-center gap-3 text-left transition-colors"
                >
                  <MessageSquarePlus className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">Reportes ciudadanos</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{reports.length} registrados</p>
                  </div>
                </button>
              </div>
            </div>
          </section>

          {/* Roadmap / Coverage Transparency */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Cobertura y plan de suscripción
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Plan actual: <strong className="text-slate-900 dark:text-white">Acceso abierto Bogotá y Colombia</strong>. Incluye consulta de lluvia, radar animado, estaciones cercanas, pronóstico de 7 días y reglas personales sin costo mientras se valida la cobertura regional.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
