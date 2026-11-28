import type {
  CustomAlertRule,
  GeoCoordinates,
  QualityFlag,
  RainfallLevel,
  SabAccumulationTier,
  WeatherAlert,
} from '../types/weather';

const EARTH_RADIUS_KM = 6371;

export function calculateDistanceKm(a: GeoCoordinates, b: GeoCoordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Number((EARTH_RADIUS_KM * c).toFixed(2));
}

export function classifySabDailyAccumulation(accDayMm: number | null): {
  tier: SabAccumulationTier;
  label: string;
  color: string;
  stroke: string;
} {
  if (accDayMm === null || Number.isNaN(accDayMm) || accDayMm <= 0) {
    return {
      tier: 'none',
      label: 'Sin lluvias (0.0 mm)',
      color: '#9CA3AF',
      stroke: '#374151',
    };
  }
  if (accDayMm <= 10) {
    return {
      tier: 'low',
      label: 'Acumulados bajos (0–10 mm)',
      color: '#22D3EE',
      stroke: '#0E7490',
    };
  }
  if (accDayMm <= 30) {
    return {
      tier: 'moderate',
      label: 'Acumulados moderados (10.1–30 mm)',
      color: '#84CC16',
      stroke: '#3F6212',
    };
  }
  if (accDayMm <= 50) {
    return {
      tier: 'high',
      label: 'Acumulados altos (30.1–50 mm)',
      color: '#F97316',
      stroke: '#9A3412',
    };
  }
  return {
    tier: 'very_high',
    label: 'Acumulados muy altos (>50.1 mm)',
    color: '#9333EA',
    stroke: '#581C87',
  };
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function classifyRainfallIntensity(mmPerHour: number | null): {
  level: RainfallLevel;
  label: string;
} {
  if (mmPerHour === null || Number.isNaN(mmPerHour) || mmPerHour < 0) {
    return { level: 'none', label: 'Sin lectura' };
  }
  if (mmPerHour < 0.1) {
    return { level: 'none', label: 'Sin lluvia' };
  }
  if (mmPerHour < 2.5) {
    return { level: 'light', label: 'Lluvia ligera' };
  }
  if (mmPerHour < 7.5) {
    return { level: 'moderate', label: 'Lluvia moderada' };
  }
  if (mmPerHour < 20) {
    return { level: 'heavy', label: 'Lluvia fuerte' };
  }
  return { level: 'intense', label: 'Lluvia muy intensa' };
}

export function describeWeatherCode(code: number | null): string {
  if (code === null || Number.isNaN(code)) return 'Condición no disponible';
  const mapping: Record<number, string> = {
    0: 'Despejado',
    1: 'Mayormente despejado',
    2: 'Parcialmente nublado',
    3: 'Nublado',
    45: 'Niebla',
    48: 'Niebla densa',
    51: 'Llovizna ligera',
    53: 'Llovizna moderada',
    55: 'Llovizna densa',
    61: 'Lluvia ligera',
    63: 'Lluvia moderada',
    65: 'Lluvia fuerte',
    66: 'Lluvia fría ligera',
    67: 'Lluvia fría intensa',
    80: 'Chubascos ligeros',
    81: 'Chubascos moderados',
    82: 'Chubascos fuertes',
    95: 'Tormenta eléctrica',
    96: 'Tormenta con granizo ligero',
    99: 'Tormenta con granizo fuerte',
  };
  return mapping[code] ?? 'Nubosidad variable';
}

export function evaluateFreshness(
  observedAtIso: string | null,
  nowMs: number = Date.now()
): { qualityFlag: QualityFlag; ageMinutes: number | null; label: string } {
  if (!observedAtIso) {
    return { qualityFlag: 'unavailable', ageMinutes: null, label: 'Sin dato reciente' };
  }
  const observedMs = Date.parse(observedAtIso);
  if (Number.isNaN(observedMs)) {
    return { qualityFlag: 'suspect', ageMinutes: null, label: 'Marca de tiempo inválida' };
  }
  const ageMinutes = Math.max(0, Math.round((nowMs - observedMs) / 60000));
  if (ageMinutes <= 20) {
    return { qualityFlag: 'valid', ageMinutes, label: ageMinutes <= 1 ? 'Hace menos de 1 min' : `Hace ${ageMinutes} min` };
  }
  if (ageMinutes <= 60) {
    return { qualityFlag: 'delayed', ageMinutes, label: `Retraso de ${ageMinutes} min` };
  }
  return { qualityFlag: 'delayed', ageMinutes, label: `Hace ${Math.round(ageMinutes / 60)} h` };
}

/**
 * Fuzz coordinates to ~1.1 km grid (2 decimal places) to protect citizen privacy.
 */
export function fuzzCoordinates(coords: GeoCoordinates): GeoCoordinates {
  return {
    latitude: Number(coords.latitude.toFixed(2)),
    longitude: Number(coords.longitude.toFixed(2)),
  };
}

export function formatTemperature(tempC: number | null, unit: 'C' | 'F'): string {
  if (tempC === null || Number.isNaN(tempC)) return '--';
  if (unit === 'F') {
    return `${Math.round((tempC * 9) / 5 + 32)}°F`;
  }
  return `${Math.round(tempC)}°C`;
}

export function formatWind(windKmh: number | null, unit: 'km/h' | 'm/s'): string {
  if (windKmh === null || Number.isNaN(windKmh)) return '--';
  if (unit === 'm/s') {
    return `${(windKmh / 3.6).toFixed(1)} m/s`;
  }
  return `${Math.round(windKmh)} km/h`;
}

export function evaluateAlertRules(
  rules: CustomAlertRule[],
  currentCoords: GeoCoordinates,
  currentRainfallMmH: number | null,
  nowIso: string = new Date().toISOString()
): WeatherAlert[] {
  const triggered: WeatherAlert[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const distanceKm = calculateDistanceKm(currentCoords, {
      latitude: rule.latitude,
      longitude: rule.longitude,
    });
    if (
      distanceKm <= rule.radiusKm &&
      currentRainfallMmH !== null &&
      currentRainfallMmH >= rule.thresholdMmH
    ) {
      const endsAt = new Date(Date.parse(nowIso) + 2 * 3600 * 1000).toISOString();
      triggered.push({
        id: `rule-event-${rule.id}`,
        title: `Regla propia: ${rule.name}`,
        description: `Se alcanzó ${currentRainfallMmH.toFixed(1)} mm/h en ${rule.locality} (umbral configurado: ${rule.thresholdMmH.toFixed(1)} mm/h en radio de ${rule.radiusKm} km).`,
        type: 'lluvia',
        severity: currentRainfallMmH >= 10 ? 'warning' : 'advisory',
        category: 'user_rule',
        source: 'Regla configurada por el usuario',
        locality: rule.locality,
        latitude: rule.latitude,
        longitude: rule.longitude,
        radiusMeters: rule.radiusKm * 1000,
        distanceKm,
        startsAt: nowIso,
        endsAt,
        active: true,
        disclaimer: 'Aviso generado por regla personal. No reemplaza alertas oficiales de IDEAM o IDIGER.',
      });
    }
  }
  return triggered;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const SAFE_REPORT_PHOTO_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;
const SAFE_ENTITY_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_RAINVIEWER_PATH_RE = /^\/[a-zA-Z0-9/_-]{1,120}$/;

export function isSafeReportPhotoDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1_800_000 &&
    SAFE_REPORT_PHOTO_RE.test(value)
  );
}

export function isValidEntityId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ENTITY_ID_RE.test(value);
}

export function sanitizeRainViewerHost(host: unknown): string {
  if (typeof host !== 'string') return 'https://tilecache.rainviewer.com';
  try {
    const parsed = new URL(host.trim());
    const hostname = parsed.hostname.toLowerCase();
    const isAllowedHost =
      hostname === 'tilecache.rainviewer.com' || hostname.endsWith('.rainviewer.com');
    if (
      parsed.protocol === 'https:' &&
      isAllowedHost &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port
    ) {
      return parsed.origin;
    }
  } catch {
    // Fall through to safe default
  }
  return 'https://tilecache.rainviewer.com';
}

export function sanitizeRainViewerTileUrl(
  host: unknown,
  framePath: unknown,
  colorScheme: 2 | 6 = 6
): string | null {
  if (typeof framePath !== 'string') return null;
  const trimmedPath = framePath.trim();
  if (!SAFE_RAINVIEWER_PATH_RE.test(trimmedPath) || trimmedPath.includes('..')) {
    return null;
  }
  const safeOrigin = sanitizeRainViewerHost(host);
  return `${safeOrigin}${trimmedPath}/256/{z}/{x}/{y}/${colorScheme}/1_1.png`;
}

export function validateCitizenReportInput(input: {
  type?: unknown;
  description?: unknown;
  locality?: unknown;
  photoDataUrl?: unknown;
}): ValidationResult {
  const allowedTypes = ['lluvia_ligera', 'lluvia_fuerte', 'granizo', 'encharcamiento', 'tormenta'];
  if (typeof input.type !== 'string' || !allowedTypes.includes(input.type)) {
    return { valid: false, error: 'Selecciona un tipo de fenómeno válido.' };
  }
  if (typeof input.description !== 'string') {
    return { valid: false, error: 'Describe brevemente lo que observas (mínimo 6 caracteres).' };
  }
  const desc = input.description.trim();
  if (desc.length < 6) {
    return { valid: false, error: 'Describe brevemente lo que observas (mínimo 6 caracteres).' };
  }
  if (desc.length > 280) {
    return { valid: false, error: 'La descripción no puede superar 280 caracteres.' };
  }
  if (typeof input.locality !== 'string') {
    return { valid: false, error: 'Indica la localidad o zona aproximada.' };
  }
  const locality = input.locality.trim();
  if (locality.length < 2 || locality.length > 80) {
    return { valid: false, error: 'Indica una localidad válida (entre 2 y 80 caracteres).' };
  }
  if (input.photoDataUrl !== undefined && input.photoDataUrl !== null && input.photoDataUrl !== '') {
    if (!isSafeReportPhotoDataUrl(input.photoDataUrl)) {
      return { valid: false, error: 'La fotografía debe ser PNG, JPG o WEBP y pesar menos de 1.3 MB.' };
    }
  }
  return { valid: true };
}

export function validateAlertRuleInput(input: {
  name?: unknown;
  locality?: unknown;
  radiusKm?: unknown;
  thresholdMmH?: unknown;
}): ValidationResult {
  if (typeof input.name !== 'string') {
    return { valid: false, error: 'Escribe un nombre de regla entre 3 y 60 caracteres.' };
  }
  const name = input.name.trim();
  if (name.length < 3 || name.length > 60) {
    return { valid: false, error: 'Escribe un nombre de regla entre 3 y 60 caracteres.' };
  }
  if (typeof input.locality !== 'string') {
    return { valid: false, error: 'Selecciona una localidad para vigilar.' };
  }
  const locality = input.locality.trim();
  if (locality.length < 2 || locality.length > 80) {
    return { valid: false, error: 'Selecciona una localidad válida (entre 2 y 80 caracteres).' };
  }
  const radius = Number(input.radiusKm);
  if (!Number.isFinite(radius) || radius < 1 || radius > 50) {
    return { valid: false, error: 'El radio debe estar entre 1 km y 50 km.' };
  }
  const threshold = Number(input.thresholdMmH);
  if (!Number.isFinite(threshold) || threshold < 0.2 || threshold > 100) {
    return { valid: false, error: 'El umbral de lluvia debe estar entre 0.2 y 100 mm/h.' };
  }
  return { valid: true };
}
