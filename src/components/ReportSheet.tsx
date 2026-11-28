import React, { useState } from 'react';
import { Camera, CheckCircle2, CloudRain, Shield, X } from 'lucide-react';
import type { CitizenReport, LocalityOption } from '../types/weather';
import { isSafeReportPhotoDataUrl, validateCitizenReportInput } from '../utils/weatherLogic';

interface ReportSheetProps {
  open: boolean;
  onClose: () => void;
  reports: CitizenReport[];
  localities: LocalityOption[];
  activeLocality: LocalityOption;
  onSubmitReport: (payload: {
    type: CitizenReport['type'];
    description: string;
    locality: string;
    latitude: number;
    longitude: number;
    protectLocation: boolean;
    photoDataUrl: string | null;
  }) => Promise<void>;
}

const REPORT_TYPES: Array<{ value: CitizenReport['type']; label: string }> = [
  { value: 'lluvia_ligera', label: 'Lluvia ligera' },
  { value: 'lluvia_fuerte', label: 'Lluvia fuerte' },
  { value: 'granizo', label: 'Granizo' },
  { value: 'encharcamiento', label: 'Encharcamiento' },
  { value: 'tormenta', label: 'Tormenta eléctrica' },
];

export const ReportSheet: React.FC<ReportSheetProps> = ({
  open,
  onClose,
  reports,
  localities,
  activeLocality,
  onSubmitReport,
}) => {
  const [type, setType] = useState<CitizenReport['type']>('lluvia_fuerte');
  const [localityId, setLocalityId] = useState(activeLocality.id);
  const [description, setDescription] = useState('');
  const [protectLocation, setProtectLocation] = useState(true);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setPhotoDataUrl(null);
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Solo se admiten imágenes PNG, JPG o WEBP.');
      return;
    }
    if (file.size > 1_200_000) {
      setError('La imagen no puede superar 1.2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (isSafeReportPhotoDataUrl(reader.result)) {
        setPhotoDataUrl(reader.result);
        setError(null);
      } else {
        setPhotoDataUrl(null);
        setError('Solo se admiten imágenes PNG, JPG o WEBP válidas.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const loc = localities.find((l) => l.id === localityId) ?? activeLocality;
    const validation = validateCitizenReportInput({
      type,
      description,
      locality: loc.name,
      photoDataUrl,
    });
    if (!validation.valid) {
      setError(validation.error ?? 'Revisa los datos del reporte.');
      setSuccessMsg(null);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmitReport({
        type,
        description: description.trim(),
        locality: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        protectLocation,
        photoDataUrl,
      });
      setDescription('');
      setPhotoDataUrl(null);
      setSuccessMsg('Reporte enviado a moderación con protección de ubicación.');
    } catch {
      setError('No se pudo enviar el reporte. Intenta nuevamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const labelForType = (t: CitizenReport['type']) =>
    REPORT_TYPES.find((r) => r.value === t)?.label ?? t;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="citizen-report-title"
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-t-3xl lg:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mt-3 lg:hidden" />

        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 id="citizen-report-title" className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Reportes ciudadanos
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Observaciones voluntarias con moderación y ubicación aproximada
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar reportes ciudadanos"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
          <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
            <div>
              <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                ¿Qué observas en este momento?
              </span>
              <div className="flex flex-wrap gap-2">
                {REPORT_TYPES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setType(item.value)}
                    className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                      type === item.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="report-locality" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Localidad o sector
                </label>
                <select
                  id="report-locality"
                  value={localityId}
                  onChange={(e) => setLocalityId(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white"
                >
                  {localities.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.city})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="report-photo" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Foto opcional (PNG/JPG)
                </label>
                <label
                  htmlFor="report-photo"
                  className="min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-700 flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer hover:border-blue-500"
                >
                  <Camera className="w-4 h-4 shrink-0" />
                  <span className="truncate">{photoDataUrl ? 'Imagen adjunta lista' : 'Adjuntar evidencia'}</span>
                  <input
                    id="report-photo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handlePhotoChange}
                    className="sr-only"
                  />
                </label>
              </div>
            </div>

            {isSafeReportPhotoDataUrl(photoDataUrl) && (
              <div className="relative w-32 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                <img src={photoDataUrl} alt="Vista previa de reporte ciudadano" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotoDataUrl(null)}
                  aria-label="Quitar fotografía"
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/80 text-white flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div>
              <label htmlFor="report-description" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Descripción breve
              </label>
              <textarea
                id="report-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ej. Lluvia fuerte con visibilidad reducida cerca de la Calle 72..."
                className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
              />
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={protectLocation}
                onChange={(e) => setProtectLocation(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <strong className="text-slate-900 dark:text-white">Proteger ubicación exacta:</strong> redondear coordenadas a una cuadrícula aproximada (~1 km) antes de publicar.
              </span>
            </label>

            {error && (
              <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            {successMsg && (
              <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0F213D] hover:bg-[#18335C] dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-sm font-semibold transition-colors whitespace-nowrap"
            >
              {submitting ? 'Enviando...' : 'Publicar reporte'}
            </button>
          </form>

          {/* Feed */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Reportes recientes de la comunidad ({reports.length})
            </h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {reports.map((rep) => (
                <article key={rep.id} className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <CloudRain className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span className="font-semibold text-slate-900 dark:text-white">{labelForType(rep.type)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{rep.locality}</span>
                    </div>
                    <span className="font-mono tabular-nums">
                      {rep.moderationStatus === 'verificado' ? 'Verificado' : 'En revisión'} ·{' '}
                      {new Date(rep.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{rep.description}</p>
                  {isSafeReportPhotoDataUrl(rep.photoDataUrl) && (
                    <img
                      src={rep.photoDataUrl}
                      alt={`Evidencia de ${labelForType(rep.type)} en ${rep.locality}`}
                      className="w-full max-h-48 object-cover rounded-xl border border-slate-200 dark:border-slate-700"
                    />
                  )}
                  <p className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    <Shield className="w-3 h-3 shrink-0" />
                    <span>
                      {rep.locationProtected ? 'Ubicación aproximada' : 'Ubicación reportada'}: {rep.latitude.toFixed(2)}, {rep.longitude.toFixed(2)}
                    </span>
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
