import React, { useState } from 'react';
import { AlertTriangle, Bell, Plus, ShieldAlert, Trash2, X } from 'lucide-react';
import type { CustomAlertRule, LocalityOption, WeatherAlert } from '../types/weather';
import { validateAlertRuleInput } from '../utils/weatherLogic';

interface AlertsSheetProps {
  open: boolean;
  onClose: () => void;
  officialAlerts: WeatherAlert[];
  userRuleAlerts: WeatherAlert[];
  rules: CustomAlertRule[];
  localities: LocalityOption[];
  defaultLocality: LocalityOption;
  onCreateRule: (input: {
    name: string;
    locality: string;
    latitude: number;
    longitude: number;
    radiusKm: number;
    thresholdMmH: number;
  }) => Promise<void>;
  onToggleRule: (id: string, enabled: boolean) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
}

export const AlertsSheet: React.FC<AlertsSheetProps> = ({
  open,
  onClose,
  officialAlerts,
  userRuleAlerts,
  rules,
  localities,
  defaultLocality,
  onCreateRule,
  onToggleRule,
  onDeleteRule,
}) => {
  const [name, setName] = useState('');
  const [selectedLocId, setSelectedLocId] = useState(defaultLocality.id);
  const [radiusKm, setRadiusKm] = useState('5');
  const [thresholdMmH, setThresholdMmH] = useState('3.0');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const loc = localities.find((l) => l.id === selectedLocId) ?? defaultLocality;
    const check = validateAlertRuleInput({
      name,
      locality: loc.name,
      radiusKm: Number(radiusKm),
      thresholdMmH: Number(thresholdMmH),
    });
    if (!check.valid) {
      setFormError(check.error ?? 'Revisa los campos de la regla.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await onCreateRule({
        name: name.trim(),
        locality: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        radiusKm: Number(radiusKm),
        thresholdMmH: Number(thresholdMmH),
      });
      setName('');
    } catch {
      setFormError('No se pudo guardar la regla en este momento.');
    } finally {
      setSubmitting(false);
    }
  };

  const severityLabel = (sev: WeatherAlert['severity']) => {
    switch (sev) {
      case 'warning':
        return 'Advertencia alta';
      case 'watch':
        return 'Vigilancia activa';
      case 'advisory':
        return 'Aviso preventivo';
      default:
        return 'Informativo';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alerts-center-title"
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-t-3xl lg:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mt-3 lg:hidden" />

        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 id="alerts-center-title" className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Centro de alertas
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Separación clara entre avisos oficiales y reglas personales por zona
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar centro de alertas"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
          {/* Official / Preventative Alerts Section */}
          <section className="space-y-3" aria-labelledby="official-alerts-heading">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 id="official-alerts-heading" className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Avisos oficiales y preventivos
              </h3>
            </div>
            <div className="space-y-3">
              {officialAlerts.map((alert) => (
                <article
                  key={alert.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-blue-700 dark:text-blue-400">{severityLabel(alert.severity)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{alert.locality}</span>
                    <span aria-hidden="true">·</span>
                    <span>{alert.source}</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">{alert.title}</h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{alert.description}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                    {alert.disclaimer}
                  </p>
                </article>
              ))}
            </div>
          </section>

          {/* Triggered User Rules */}
          {userRuleAlerts.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                  Reglas propias activadas ahora
                </h3>
              </div>
              {userRuleAlerts.map((ev) => (
                <article
                  key={ev.id}
                  className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-1.5"
                >
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Regla personal · No es una alerta oficial
                  </p>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">{ev.title}</h4>
                  <p className="text-xs text-slate-700 dark:text-slate-300">{ev.description}</p>
                </article>
              ))}
            </section>
          )}

          {/* Custom Alert Rules Manager */}
          <section className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800" aria-labelledby="custom-rules-heading">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              <h3 id="custom-rules-heading" className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Mis reglas por zona y radio ({rules.length})
              </h3>
            </div>

            <form onSubmit={handleSubmit} noValidate className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Crea una regla personalizada. Las reglas propias son avisos informativos y no garantizan seguridad ni sustituyen a IDEAM o IDIGER.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rule-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nombre de la regla
                  </label>
                  <input
                    id="rule-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. Lluvia fuerte camino a casa"
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                  />
                </div>
                <div>
                  <label htmlFor="rule-locality" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Localidad / Zona
                  </label>
                  <select
                    id="rule-locality"
                    value={selectedLocId}
                    onChange={(e) => setSelectedLocId(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                  >
                    {localities.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.city})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rule-radius" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Radio de vigilancia (km)
                  </label>
                  <input
                    id="rule-radius"
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    value={radiusKm}
                    onChange={(e) => setRadiusKm(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono tabular-nums text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                  />
                </div>
                <div>
                  <label htmlFor="rule-threshold" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Umbral de lluvia (mm/h)
                  </label>
                  <input
                    id="rule-threshold"
                    type="number"
                    min="0.2"
                    max="100"
                    step="0.1"
                    value={thresholdMmH}
                    onChange={(e) => setThresholdMmH(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono tabular-nums text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                  />
                </div>
              </div>

              {formError && (
                <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-[#0F213D] hover:bg-[#18335C] dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>{submitting ? 'Guardando...' : 'Agregar regla de alerta'}</span>
              </button>
            </form>

            {/* Saved Rules List */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {rules.map((rule) => (
                <div key={rule.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{rule.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {rule.locality} · Radio {rule.radiusKm} km · &ge; {rule.thresholdMmH.toFixed(1)} mm/h
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleRule(rule.id, !rule.enabled)}
                      aria-label={rule.enabled ? `Desactivar regla ${rule.name}` : `Activar regla ${rule.name}`}
                      className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                        rule.enabled
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {rule.enabled ? 'Activa' : 'Pausada'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteRule(rule.id)}
                      aria-label={`Eliminar regla ${rule.name}`}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {rules.length === 0 && (
                <p className="p-4 text-xs text-slate-500 dark:text-slate-400 text-center">
                  Aún no has creado reglas personalizadas.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
