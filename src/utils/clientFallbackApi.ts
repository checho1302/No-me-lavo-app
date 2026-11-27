import { RADAR_SITES, STATION_CATALOG } from '../data/colombiaCatalog';
import type {
  CitizenReport,
  CustomAlertRule,
  DailyForecastItem,
  FavoriteLocation,
  ForecastResponse,
  HistoricalDayItem,
  HourlyForecastItem,
  NearbyWeatherResponse,
  RadarFrame,
  RadarProductsResponse,
  StationObservationPoint,
  WeatherAlert,
  WeatherStation,
} from '../types/weather';
import {
  calculateDistanceKm,
  classifyRainfallIntensity,
  describeWeatherCode,
  evaluateAlertRules,
  fuzzCoordinates,
} from './weatherLogic';

const LOCAL_FAVS_KEY = 'nomelavo_local_favorites_v1';
const LOCAL_RULES_KEY = 'nomelavo_local_rules_v1';
const LOCAL_REPORTS_KEY = 'nomelavo_local_reports_v1';

const BOGOTA_LOCALITIES_ARCGIS_URL =
  'https://services1.arcgis.com/zJ4jVF39oWSBtlEo/arcgis/rest/services/Localidades_SAB/FeatureServer/0/query?where=1%3D1&outFields=LocNombre,LocCodigo&f=geojson&outSR=4326';

export async function fetchJsonOrNull<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface OpenMeteoClientPayload {
  current?: {
    time: string;
    temperature_2m: number;
    apparent_temperature?: number;
    relative_humidity_2m: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m?: number;
    surface_pressure?: number;
    is_day?: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    relative_humidity_2m?: number[];
    precipitation: number[];
    precipitation_probability: number[];
    wind_speed_10m: number[];
    weather_code: number[];
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max?: number[];
  };
}

async function fetchOpenMeteoDirect(
  latitude: number,
  longitude: number
): Promise<OpenMeteoClientPayload | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,is_day` +
    `&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max` +
    `&timezone=America%2FBogota&past_days=7&forecast_days=7`;
  return fetchJsonOrNull<OpenMeteoClientPayload>(url);
}

function readLocalList<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as T[];
    }
  } catch {
    // Ignore storage errors
  }
  return fallback;
}

function writeLocalList<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore storage errors
  }
}

export function getLocalFavorites(): FavoriteLocation[] {
  return readLocalList<FavoriteLocation>(LOCAL_FAVS_KEY, [
    {
      id: 'fav-bogota-chapinero',
      label: 'Chapinero',
      locality: 'Chapinero',
      city: 'Bogotá',
      latitude: 4.6486,
      longitude: -74.0628,
      createdAt: new Date().toISOString(),
    },
  ]);
}

export function saveLocalFavorite(fav: Omit<FavoriteLocation, 'id' | 'createdAt'>): FavoriteLocation[] {
  const list = getLocalFavorites();
  const next: FavoriteLocation = {
    ...fav,
    id: `fav-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  const updated = [next, ...list.filter((f) => f.label !== fav.label)];
  writeLocalList(LOCAL_FAVS_KEY, updated);
  return updated;
}

export function deleteLocalFavorite(id: string): FavoriteLocation[] {
  const updated = getLocalFavorites().filter((f) => f.id !== id);
  writeLocalList(LOCAL_FAVS_KEY, updated);
  return updated;
}

export function getLocalRules(): CustomAlertRule[] {
  return readLocalList<CustomAlertRule>(LOCAL_RULES_KEY, []);
}

export function addLocalRule(input: {
  name: string;
  locality: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  thresholdMmH: number;
}): CustomAlertRule[] {
  const updated: CustomAlertRule[] = [
    {
      ...input,
      id: `rule-${Date.now()}`,
      enabled: true,
      createdAt: new Date().toISOString(),
    },
    ...getLocalRules(),
  ];
  writeLocalList(LOCAL_RULES_KEY, updated);
  return updated;
}

export function toggleLocalRule(id: string, enabled: boolean): CustomAlertRule[] {
  const updated = getLocalRules().map((r) => (r.id === id ? { ...r, enabled } : r));
  writeLocalList(LOCAL_RULES_KEY, updated);
  return updated;
}

export function deleteLocalRule(id: string): CustomAlertRule[] {
  const updated = getLocalRules().filter((r) => r.id !== id);
  writeLocalList(LOCAL_RULES_KEY, updated);
  return updated;
}

export function getLocalReports(): CitizenReport[] {
  return readLocalList<CitizenReport>(LOCAL_REPORTS_KEY, []);
}

export function addLocalReport(payload: {
  type: CitizenReport['type'];
  description: string;
  locality: string;
  latitude: number;
  longitude: number;
  protectLocation: boolean;
  photoDataUrl: string | null;
}): CitizenReport[] {
  const coords = payload.protectLocation
    ? fuzzCoordinates({ latitude: payload.latitude, longitude: payload.longitude })
    : { latitude: payload.latitude, longitude: payload.longitude };
  const next: CitizenReport = {
    id: `rep-${Date.now()}`,
    type: payload.type,
    description: payload.description,
    locality: payload.locality,
    latitude: coords.latitude,
    longitude: coords.longitude,
    locationProtected: payload.protectLocation,
    photoDataUrl: payload.photoDataUrl,
    moderationStatus: 'verificado',
    createdAt: new Date().toISOString(),
  };
  const updated = [next, ...getLocalReports()];
  writeLocalList(LOCAL_REPORTS_KEY, updated);
  return updated;
}

/**
 * Direct client-side fallback when deployed on static hosts (GitHub Pages, Vercel, Netlify)
 * where the Express /api/v1 backend is not running.
 */
export async function fetchFallbackCoreWeather(loc: {
  latitude: number;
  longitude: number;
  locality: string;
  city: string;
}): Promise<{
  weather: NearbyWeatherResponse;
  stations: WeatherStation[];
  officialAlerts: WeatherAlert[];
  userRuleAlerts: WeatherAlert[];
  rules: CustomAlertRule[];
}> {
  const live = await fetchOpenMeteoDirect(loc.latitude, loc.longitude);
  const receivedAt = new Date().toISOString();
  const rainVal = live?.current ? Number(live.current.precipitation.toFixed(1)) : 0;
  const { level, label: levelLabel } = classifyRainfallIntensity(rainVal);
  const hourly = live?.hourly;
  const currentIso = live?.current?.time ?? null;
  const nowIdx =
    hourly?.time && currentIso
      ? Math.max(0, hourly.time.findIndex((t) => t >= currentIso.slice(0, 13)))
      : -1;

  const acc24hMm =
    hourly?.precipitation && nowIdx >= 0
      ? Number(
          hourly.precipitation
            .slice(Math.max(0, nowIdx - 23), nowIdx + 1)
            .reduce((acc, v) => acc + (v ?? 0), 0)
            .toFixed(1)
        )
      : 0;
  const currentProb =
    hourly?.precipitation_probability && nowIdx >= 0
      ? Math.round(hourly.precipitation_probability[nowIdx] ?? 0)
      : 0;

  const observedAt = currentIso
    ? new Date(currentIso.includes('Z') ? currentIso : `${currentIso}-05:00`).toISOString()
    : receivedAt;

  const stations: WeatherStation[] = STATION_CATALOG.map((st, idx): WeatherStation => {
    const dist = calculateDistanceKm(
      { latitude: loc.latitude, longitude: loc.longitude },
      { latitude: st.latitude, longitude: st.longitude }
    );
    const factor = 0.8 + (idx % 4) * 0.12;
    const stRain = Number((rainVal * factor).toFixed(1));
    const stDay = Number((acc24hMm * factor).toFixed(1));
    return {
      ...st,
      status: 'online',
      distanceKm: Number(dist.toFixed(1)),
      latestReading: {
        rainfallMmH: stRain,
        acc1hMm: stRain,
        acc6hMm: Number((stDay * 0.45).toFixed(1)),
        acc24hMm: stDay,
        accDayMm: stDay,
        isRainingNow: stRain > 0.1,
        temperatureC: live?.current ? Number(live.current.temperature_2m.toFixed(1)) : null,
        humidityPct: live?.current ? Math.round(live.current.relative_humidity_2m) : null,
        windKmh: live?.current ? Number(live.current.wind_speed_10m.toFixed(1)) : null,
        observedAt,
        receivedAt,
        qualityFlag: 'valid',
        dataCategory: 'estimation',
      },
    };
  }).sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));

  const rules = getLocalRules();
  const userRuleAlerts = evaluateAlertRules(
    rules,
    { latitude: loc.latitude, longitude: loc.longitude },
    rainVal,
    receivedAt
  );

  const officialAlerts: WeatherAlert[] = [
    {
      id: 'fallback-monitor',
      title:
        rainVal >= 2
          ? `Lluvia activa en ${loc.locality}`
          : 'Monitoreo meteorológico en condiciones normales',
      description:
        rainVal >= 2
          ? `Se registran ${rainVal.toFixed(1)} mm/h en ${loc.locality}. Conduce con precaución y usa la opción Evitar lluvia.`
          : `Sin alertas severas activas en ${loc.locality}.`,
      type: 'lluvia',
      severity: rainVal >= 2 ? 'advisory' : 'info',
      category: 'official_alert',
      source: 'No me lavo app · Open-Meteo',
      locality: loc.locality,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radiusMeters: 10000,
      distanceKm: 0,
      startsAt: receivedAt,
      endsAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      active: true,
      disclaimer: 'Estado informativo en vivo. Consulta canales oficiales ante emergencias.',
    },
  ];

  const weather: NearbyWeatherResponse = {
    location: {
      latitude: loc.latitude,
      longitude: loc.longitude,
      locality: loc.locality,
      city: loc.city,
      altitudeM: 2600,
      isApproximate: false,
    },
    current: {
      temperatureC: live?.current ? Number(live.current.temperature_2m.toFixed(1)) : null,
      feelsLikeC:
        live?.current?.apparent_temperature !== undefined
          ? Number(live.current.apparent_temperature.toFixed(1))
          : null,
      humidityPct: live?.current ? Math.round(live.current.relative_humidity_2m) : null,
      windKmh: live?.current ? Number(live.current.wind_speed_10m.toFixed(1)) : null,
      windDirectionDeg: live?.current?.wind_direction_10m ?? null,
      pressureHpa:
        live?.current?.surface_pressure !== undefined
          ? Number(live.current.surface_pressure.toFixed(1))
          : null,
      weatherCode: live?.current?.weather_code ?? null,
      conditionLabel: describeWeatherCode(live?.current?.weather_code ?? null),
      isDay: (live?.current?.is_day ?? 1) === 1,
    },
    rainfall: {
      value: rainVal,
      unit: 'mm/h',
      acc1hMm: rainVal,
      acc24hMm,
      probabilityPct: currentProb,
      level,
      levelLabel,
    },
    traceability: {
      source: 'Open-Meteo (modo directo)',
      category: 'estimation',
      observedAt,
      receivedAt,
      qualityFlag: live ? 'valid' : 'unavailable',
      note: 'Datos en vivo obtenidos directamente desde Open-Meteo.',
    },
    nearestStations: stations.slice(0, 8),
    alerts: [...officialAlerts, ...userRuleAlerts],
    lastUpdated: observedAt,
  };

  return { weather, stations, officialAlerts, userRuleAlerts, rules };
}

export async function fetchFallbackForecast(loc: {
  latitude: number;
  longitude: number;
  locality: string;
  city: string;
}): Promise<ForecastResponse | null> {
  const live = await fetchOpenMeteoDirect(loc.latitude, loc.longitude);
  const receivedAt = new Date().toISOString();
  if (!live?.hourly || !live.daily || !live.current) return null;

  const currentIso = live.current.time;
  const startIdx = Math.max(0, live.hourly.time.findIndex((t) => t >= currentIso.slice(0, 13)));
  const hourly: HourlyForecastItem[] = live.hourly.time
    .slice(startIdx, startIdx + 24)
    .map((time, offset): HourlyForecastItem => {
      const i = startIdx + offset;
      return {
        time,
        precipitationMm: Number((live.hourly!.precipitation[i] ?? 0).toFixed(1)),
        precipitationProbPct: Math.round(live.hourly!.precipitation_probability[i] ?? 0),
        temperatureC: Number((live.hourly!.temperature_2m[i] ?? 0).toFixed(1)),
        windKmh: Number((live.hourly!.wind_speed_10m[i] ?? 0).toFixed(1)),
        humidityPct: Math.round(live.hourly!.relative_humidity_2m?.[i] ?? 75),
        weatherCode: live.hourly!.weather_code[i] ?? 0,
      };
    });

  const todayKey = currentIso.slice(0, 10);
  const history: HistoricalDayItem[] = [];
  const daily: DailyForecastItem[] = [];

  live.daily.time.forEach((date, i) => {
    const precip = Number((live.daily!.precipitation_sum[i] ?? 0).toFixed(1));
    const maxC = Number((live.daily!.temperature_2m_max[i] ?? 0).toFixed(1));
    const minC = Number((live.daily!.temperature_2m_min[i] ?? 0).toFixed(1));
    const code = live.daily!.weather_code[i] ?? 0;
    const prob = Math.round(live.daily!.precipitation_probability_max[i] ?? 0);
    const windMax = Number((live.daily!.wind_speed_10m_max?.[i] ?? 12).toFixed(1));

    if (date < todayKey) {
      history.push({
        date,
        precipitationSumMm: precip,
        tempMaxC: maxC,
        tempMinC: minC,
        avgHumidityPct: null,
      });
    } else {
      const dayIdx = daily.length;
      daily.push({
        date,
        precipitationSumMm: precip,
        precipitationProbMaxPct: prob,
        tempMaxC: maxC,
        tempMinC: minC,
        windMaxKmh: windMax,
        weatherCode: code,
        uncertaintyLabel:
          dayIdx <= 1 ? 'Confianza alta' : dayIdx <= 4 ? 'Confianza media' : 'Referencia extendida',
      });
    }
  });

  let peakHourTime: string | null = null;
  let peakHourMm = 0;
  for (const h of hourly) {
    if (h.precipitationMm > peakHourMm) {
      peakHourMm = h.precipitationMm;
      peakHourTime = h.time;
    }
  }

  return {
    location: {
      latitude: loc.latitude,
      longitude: loc.longitude,
      locality: loc.locality,
      city: loc.city,
    },
    hourly,
    daily,
    history,
    summary: {
      totalLast7dMm: Number(history.reduce((s, d) => s + d.precipitationSumMm, 0).toFixed(1)),
      totalNext7dMm: Number(daily.reduce((s, d) => s + d.precipitationSumMm, 0).toFixed(1)),
      peakHourTime,
      peakHourMm: Number(peakHourMm.toFixed(1)),
    },
    traceability: {
      source: 'Open-Meteo (modo directo)',
      category: 'forecast',
      observedAt: receivedAt,
      receivedAt,
      qualityFlag: 'valid',
    },
  };
}

export async function fetchFallbackRadar(): Promise<RadarProductsResponse> {
  const rv = await fetchJsonOrNull<{
    host?: string;
    radar?: {
      past?: Array<{ time: number; path: string }>;
      nowcast?: Array<{ time: number; path: string }>;
    };
  }>('https://api.rainviewer.com/public/weather-maps.json');

  const host = rv?.host ?? 'https://tilecache.rainviewer.com';
  const formatFrameLabel = (unixSec: number, isForecast: boolean) => {
    const dt = new Date(unixSec * 1000);
    const hhmm = dt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    return isForecast ? `Pronóstico ${hhmm}` : hhmm;
  };

  const frames: RadarFrame[] = [
    ...(rv?.radar?.past ?? []).slice(-6).map((f): RadarFrame => ({
      time: f.time,
      path: f.path,
      tileUrlTemplate: `${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
      isForecast: false,
      label: formatFrameLabel(f.time, false),
    })),
    ...(rv?.radar?.nowcast ?? []).slice(0, 3).map((f): RadarFrame => ({
      time: f.time,
      path: f.path,
      tileUrlTemplate: `${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
      isForecast: true,
      label: formatFrameLabel(f.time, true),
    })),
  ];

  const nowIso = new Date().toISOString();
  return {
    host,
    generatedAt: nowIso,
    sites: RADAR_SITES,
    frames,
    idigerRadar: null,
    traceability: {
      source: 'RainViewer (modo directo)',
      category: 'observation',
      observedAt: frames.length > 0 ? new Date(frames[frames.length - 1].time * 1000).toISOString() : null,
      receivedAt: nowIso,
      qualityFlag: frames.length > 0 ? 'valid' : 'unavailable',
    },
  };
}

export async function fetchFallbackBogotaGeoJson(): Promise<unknown | null> {
  return fetchJsonOrNull<unknown>(BOGOTA_LOCALITIES_ARCGIS_URL);
}

export async function fetchFallbackStationObservations(
  latitude: number,
  longitude: number
): Promise<StationObservationPoint[]> {
  const live = await fetchOpenMeteoDirect(latitude, longitude);
  if (!live?.hourly || !live.current) return [];
  const idx = Math.max(0, live.hourly.time.findIndex((t) => t >= live.current!.time.slice(0, 13)));
  const start = Math.max(0, idx - 23);
  return live.hourly.time.slice(start, idx + 1).map((timestamp, offset): StationObservationPoint => {
    const i = start + offset;
    return {
      timestamp,
      rainfallMm: Number((live.hourly!.precipitation[i] ?? 0).toFixed(1)),
      temperatureC: Number((live.hourly!.temperature_2m[i] ?? 0).toFixed(1)),
      humidityPct: Math.round(live.hourly!.relative_humidity_2m?.[i] ?? 75),
      qualityFlag: 'valid',
    };
  });
}
