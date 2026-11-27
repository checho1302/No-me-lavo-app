import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  fetchBogotaLocalitiesGeoJson,
  fetchIdigerRadarKmz,
  fetchLiveSabBogotaStations,
} from './server/sabIngestion';
import { COLOMBIA_LOCALITIES, RADAR_SITES, STATION_CATALOG } from './src/data/colombiaCatalog';
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
} from './src/types/weather';
import {
  calculateDistanceKm,
  classifyRainfallIntensity,
  describeWeatherCode,
  evaluateAlertRules,
  fuzzCoordinates,
  validateAlertRuleInput,
  validateCitizenReportInput,
} from './src/utils/weatherLogic';

const PORT = 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Lightweight TTL cache to separate external ingestion from mobile API reads
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const weatherCache = new Map<string, CacheEntry<OpenMeteoPayload>>();
let radarCache: CacheEntry<RadarProductsResponse> | null = null;

// In-memory rate limiting for write endpoints
const writeHits = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string, limit = 40, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = writeHits.get(ip);
  if (!entry || now > entry.resetAt) {
    writeHits.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

// Persistent JSON store in local app data directory (safe path confined)
const DATA_DIR = path.resolve(process.cwd(), '.pluvia-data');
const STORE_PATH = path.resolve(DATA_DIR, 'store.json');

interface PersistedStore {
  reports: CitizenReport[];
  alertRules: CustomAlertRule[];
  favorites: FavoriteLocation[];
  pushTokens: Array<{ token: string; platform: string; updatedAt: string }>;
}

const DEFAULT_STORE: PersistedStore = {
  reports: [
    {
      id: 'rep-seed-1',
      type: 'lluvia_ligera',
      description: 'Llovizna constante bajando desde los Cerros Orientales cerca de la Carrera 7.',
      locality: 'Chapinero',
      latitude: 4.65,
      longitude: -74.06,
      locationProtected: true,
      photoDataUrl: null,
      moderationStatus: 'verificado',
      createdAt: new Date(Date.now() - 28 * 60_000).toISOString(),
    },
    {
      id: 'rep-seed-2',
      type: 'encharcamiento',
      description: 'Acumulación moderada de agua en el cruce de la Av. Boyacá con Calle 116.',
      locality: 'Suba',
      latitude: 4.71,
      longitude: -74.07,
      locationProtected: true,
      photoDataUrl: null,
      moderationStatus: 'verificado',
      createdAt: new Date(Date.now() - 75 * 60_000).toISOString(),
    },
  ],
  alertRules: [
    {
      id: 'rule-seed-1',
      name: 'Lluvia moderada en Chapinero',
      locality: 'Chapinero',
      latitude: 4.6486,
      longitude: -74.0628,
      radiusKm: 5,
      thresholdMmH: 2.5,
      enabled: true,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
  ],
  favorites: [
    {
      id: 'fav-bogota-chapinero',
      label: 'Chapinero',
      locality: 'Chapinero',
      city: 'Bogotá',
      latitude: 4.6486,
      longitude: -74.0628,
      createdAt: new Date(Date.now() - 172_800_000).toISOString(),
    },
    {
      id: 'fav-bogota-usaquen',
      label: 'Usaquén',
      locality: 'Usaquén',
      city: 'Bogotá',
      latitude: 4.7045,
      longitude: -74.0315,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
  ],
  pushTokens: [],
};

function loadStore(): PersistedStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedStore>;
      return {
        reports: Array.isArray(parsed.reports) ? parsed.reports : DEFAULT_STORE.reports,
        alertRules: Array.isArray(parsed.alertRules) ? parsed.alertRules : DEFAULT_STORE.alertRules,
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : DEFAULT_STORE.favorites,
        pushTokens: Array.isArray(parsed.pushTokens) ? parsed.pushTokens : [],
      };
    }
  } catch {
    // Fallback cleanly to default store
  }
  return structuredClone(DEFAULT_STORE);
}

function saveStore(store: PersistedStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    // Keep operating in memory if disk write is restricted
  }
}

const store = loadStore();

interface OpenMeteoPayload {
  fetchedAt: string;
  source: string;
  current?: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    is_day: number;
    precipitation: number;
    rain: number;
    weather_code: number;
    surface_pressure: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    relative_humidity_2m: number[];
    precipitation_probability: number[];
    precipitation: number[];
    weather_code: number[];
    wind_speed_10m: number[];
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
  };
}

function parseCoordinate(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return fallback;
  return num;
}

function findNearestLocality(latitude: number, longitude: number) {
  let best = COLOMBIA_LOCALITIES[0];
  let bestDist = Infinity;
  for (const loc of COLOMBIA_LOCALITIES) {
    const d = calculateDistanceKm({ latitude, longitude }, { latitude: loc.latitude, longitude: loc.longitude });
    if (d < bestDist) {
      bestDist = d;
      best = loc;
    }
  }
  return { locality: best, distanceKm: bestDist };
}

async function fetchOpenMeteo(latitude: number, longitude: number): Promise<OpenMeteoPayload | null> {
  const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // Hardcoded allowlisted Open-Meteo API endpoint with validated numeric coordinates
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  url.searchParams.set('timezone', 'America/Bogota');
  url.searchParams.set('past_days', '7');
  url.searchParams.set('forecast_days', '7');
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m'
  );
  url.searchParams.set(
    'hourly',
    'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m'
  );
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max'
  );

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    const resp = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const json = (await resp.json()) as Omit<OpenMeteoPayload, 'fetchedAt' | 'source'>;
    const payload: OpenMeteoPayload = {
      ...json,
      fetchedAt: new Date().toISOString(),
      source: 'Open-Meteo · Modelo atmosférico en vivo',
    };
    weatherCache.set(cacheKey, { data: payload, expiresAt: Date.now() + 5 * 60_000 });
    return payload;
  } catch {
    return null;
  }
}

function buildStationWithLiveContext(
  station: (typeof STATION_CATALOG)[number],
  refCoords: { latitude: number; longitude: number },
  liveData: OpenMeteoPayload | null
): WeatherStation {
  const receivedAt = new Date().toISOString();
  const distanceKm = calculateDistanceKm(refCoords, {
    latitude: station.latitude,
    longitude: station.longitude,
  });

  // Never invent meteorological data when a station is in maintenance or upstream feed is unavailable
  if (station.status === 'maintenance' || !liveData?.current) {
    return {
      ...station,
      distanceKm,
      latestReading: {
        rainfallMmH: null,
        accDayMm: null,
        acc1hMm: null,
        acc6hMm: null,
        acc24hMm: null,
        temperatureC: null,
        humidityPct: null,
        windKmh: null,
        observedAt: null,
        receivedAt,
        qualityFlag: 'unavailable',
        dataCategory: 'observation',
      },
    };
  }

  // Deterministic micro-altitude lapse rate adjustment (-0.65°C per 100m relative to 2600m Bogotá baseline)
  const current = liveData.current;
  const hourly = liveData.hourly;
  const nowIdx = hourly?.time ? Math.max(0, hourly.time.findIndex((t) => t >= current.time.slice(0, 13))) : -1;

  const sumHours = (count: number): number | null => {
    if (!hourly?.precipitation || nowIdx < 0) return null;
    let total = 0;
    const start = Math.max(0, nowIdx - count + 1);
    for (let i = start; i <= nowIdx; i++) {
      total += hourly.precipitation[i] ?? 0;
    }
    return Number(total.toFixed(1));
  };

  const altDeltaC = ((2600 - station.altitudeM) / 100) * 0.45;
  const isDelayed = station.status === 'delayed';
  const observedDate = new Date(
    Date.parse(current.time.includes('Z') ? current.time : `${current.time}-05:00`) - (isDelayed ? 35 * 60_000 : 0)
  );

  const acc24 = sumHours(24);
  return {
    ...station,
    distanceKm,
    latestReading: {
      rainfallMmH: Number(Math.max(0, current.precipitation).toFixed(1)),
      accDayMm: acc24,
      acc1hMm: sumHours(1),
      acc6hMm: sumHours(6),
      acc24hMm: acc24,
      temperatureC: Number((current.temperature_2m + (station.city === 'Bogotá' ? altDeltaC : 0)).toFixed(1)),
      humidityPct: Math.round(current.relative_humidity_2m),
      windKmh: Number(current.wind_speed_10m.toFixed(1)),
      observedAt: Number.isNaN(observedDate.getTime()) ? receivedAt : observedDate.toISOString(),
      receivedAt,
      qualityFlag: isDelayed ? 'delayed' : 'valid',
      dataCategory: 'estimation',
    },
  };
}

function buildOfficialAlerts(
  coords: { latitude: number; longitude: number },
  localityName: string,
  liveData: OpenMeteoPayload | null
): WeatherAlert[] {
  const now = new Date();
  const in3h = new Date(now.getTime() + 3 * 3600_000);
  const alerts: WeatherAlert[] = [];

  const rainMm = liveData?.current?.precipitation ?? null;
  const maxNext6hProb = (() => {
    if (!liveData?.hourly || !liveData.current) return 0;
    const startIdx = Math.max(0, liveData.hourly.time.findIndex((t) => t >= liveData.current!.time.slice(0, 13)));
    const slice = liveData.hourly.precipitation_probability.slice(startIdx, startIdx + 6);
    return slice.length ? Math.max(...slice) : 0;
  })();

  if (rainMm !== null && rainMm >= 3) {
    alerts.push({
      id: 'official-rain-active',
      title: 'Aviso preventivo por precipitación activa',
      description: `Se registra precipitación estimada de ${rainMm.toFixed(1)} mm/h en el sector de ${localityName}. Precaución por encharcamientos y visibilidad reducida.`,
      type: 'lluvia',
      severity: rainMm >= 10 ? 'warning' : 'watch',
      category: 'official_alert',
      source: 'Boletín hidrometeorológico (Ref. IDEAM / IDIGER)',
      locality: localityName,
      latitude: coords.latitude,
      longitude: coords.longitude,
      radiusMeters: 6000,
      distanceKm: 0.4,
      startsAt: now.toISOString(),
      endsAt: in3h.toISOString(),
      active: true,
      disclaimer: 'Referencia informativa basada en umbrales hidrometeorológicos. Verifica siempre comunicados oficiales vigentes de IDEAM e IDIGER.',
    });
  } else if (maxNext6hProb >= 55) {
    alerts.push({
      id: 'official-rain-forecast',
      title: 'Vigilancia por probabilidad de lluvias en las próximas 6 horas',
      description: `El pronóstico indica hasta ${maxNext6hProb}% de probabilidad de precipitación en ${localityName} y zonas aledañas.`,
      type: 'lluvia',
      severity: 'advisory',
      category: 'official_alert',
      source: 'Pronóstico atmosférico (Open-Meteo · Umbral preventivo)',
      locality: localityName,
      latitude: coords.latitude,
      longitude: coords.longitude,
      radiusMeters: 8000,
      distanceKm: 0.8,
      startsAt: now.toISOString(),
      endsAt: in3h.toISOString(),
      active: true,
      disclaimer: 'Aviso preventivo derivado del pronóstico. No constituye una alerta oficial de emergencia.',
    });
  } else {
    alerts.push({
      id: 'official-normal-monitor',
      title: 'Monitoreo hidrometeorológico en condiciones normales',
      description: `Sin alertas severas activas en ${localityName}. Se mantiene seguimiento continuo de lluvia y nubosidad sobre los cerros y cuencas.`,
      type: 'lluvia',
      severity: 'info',
      category: 'official_alert',
      source: 'Centro de monitoreo Pluvia · Ref. IDEAM / IDIGER',
      locality: localityName,
      latitude: coords.latitude,
      longitude: coords.longitude,
      radiusMeters: 10000,
      distanceKm: 0,
      startsAt: now.toISOString(),
      endsAt: in3h.toISOString(),
      active: true,
      disclaimer: 'Estado informativo de seguimiento. Consulta canales oficiales de emergencia ante cambios súbitos.',
    });
  }

  return alerts;
}

async function fetchRadarProducts(): Promise<RadarProductsResponse> {
  if (radarCache && Date.now() < radarCache.expiresAt) {
    return radarCache.data;
  }

  const receivedAt = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error('RainViewer unavailable');
    const json = (await resp.json()) as {
      host: string;
      generated: number;
      radar?: {
        past?: Array<{ time: number; path: string }>;
        nowcast?: Array<{ time: number; path: string }>;
      };
    };

    const host = json.host || 'https://tilecache.rainviewer.com';
    const past = (json.radar?.past ?? []).slice(-8);
    const nowcast = (json.radar?.nowcast ?? []).slice(0, 3);

    const formatTimeLabel = (unixSec: number, isForecast: boolean) => {
      const d = new Date(unixSec * 1000);
      const hm = d.toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Bogota',
      });
      return isForecast ? `${hm} (est.)` : hm;
    };

    const frames: RadarFrame[] = [
      ...past.map((f) => ({
        time: f.time,
        path: f.path,
        tileUrlTemplate: `${host}${f.path}/256/{z}/{x}/{y}/6/1_1.png`,
        isForecast: false,
        label: formatTimeLabel(f.time, false),
      })),
      ...nowcast.map((f) => ({
        time: f.time,
        path: f.path,
        tileUrlTemplate: `${host}${f.path}/256/{z}/{x}/{y}/6/1_1.png`,
        isForecast: true,
        label: formatTimeLabel(f.time, true),
      })),
    ];

    const idigerKmz = await fetchIdigerRadarKmz();

    const data: RadarProductsResponse = {
      host,
      generatedAt: json.generated ? new Date(json.generated * 1000).toISOString() : receivedAt,
      sites: RADAR_SITES,
      frames,
      idigerRadar: idigerKmz?.meta ?? null,
      traceability: {
        source: idigerKmz
          ? 'Radar Meteorológico IDIGER Bogotá (SAB) + Mosaico RainViewer'
          : 'RainViewer Global Radar Composite',
        category: 'estimation',
        observedAt:
          idigerKmz?.meta.observedAt ??
          (frames.length ? new Date(frames[Math.max(0, past.length - 1)].time * 1000).toISOString() : null),
        receivedAt,
        qualityFlag: idigerKmz || frames.length ? 'valid' : 'unavailable',
        note: 'El radar estima precipitación en área mediante reflectividad (dBZ); complementa las mediciones puntuales de los 69 pluviómetros IDIGER.',
      },
    };
    radarCache = { data, expiresAt: Date.now() + 90_000 };
    return data;
  } catch {
    const idigerKmz = await fetchIdigerRadarKmz();
    return {
      host: 'https://tilecache.rainviewer.com',
      generatedAt: receivedAt,
      sites: RADAR_SITES,
      frames: [],
      idigerRadar: idigerKmz?.meta ?? null,
      traceability: {
        source: idigerKmz ? 'Radar Meteorológico IDIGER Bogotá (SAB)' : 'Sin conexión de radar',
        category: 'estimation',
        observedAt: idigerKmz?.meta.observedAt ?? null,
        receivedAt,
        qualityFlag: idigerKmz ? 'valid' : 'unavailable',
        note: idigerKmz
          ? 'Mostrando reflectividad oficial del Radar Meteorológico IDIGER Bogotá.'
          : 'No fue posible obtener los fotogramas de radar en este momento. Intenta actualizar nuevamente.',
      },
    };
  }
}

async function getCombinedStations(
  refCoords: { latitude: number; longitude: number },
  liveData: OpenMeteoPayload | null
): Promise<WeatherStation[]> {
  const sabStations = await fetchLiveSabBogotaStations(refCoords);
  // Keep regional Colombia stations + non-IDIGER reference stations (IDEAM, Aerocivil, SIATA) alongside ALL live SAB IDIGER Bogotá stations
  const fallbackCatalog =
    sabStations.length > 0
      ? STATION_CATALOG.filter((s) => !(s.city === 'Bogotá' && s.source === 'IDIGER'))
      : STATION_CATALOG;
  const regionalStations = fallbackCatalog.map((st) =>
    buildStationWithLiveContext(st, refCoords, liveData)
  );
  return [...sabStations, ...regionalStations].sort(
    (a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999)
  );
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // --- API v1 Routes (aligned with Pluvia Intelligence PDF Architecture) ---

  app.get('/api/v1/localities', (_req, res) => {
    res.json({ localities: COLOMBIA_LOCALITIES });
  });

  app.get('/api/v1/bogota/localities-geojson', async (_req, res) => {
    const geojson = await fetchBogotaLocalitiesGeoJson();
    if (!geojson) {
      res.status(503).json({ error: 'Polígonos de localidades no disponibles temporalmente.' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(geojson);
  });

  app.get('/api/v1/radar/idiger/image', async (_req, res) => {
    const radarKmz = await fetchIdigerRadarKmz();
    if (!radarKmz) {
      res.status(503).send('Radar IDIGER no disponible temporalmente.');
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(radarKmz.pngBuffer);
  });

  app.get('/api/v1/weather/nearby', async (req, res) => {
    const latitude = parseCoordinate(req.query.latitude, -90, 90, 4.6486);
    const longitude = parseCoordinate(req.query.longitude, -180, 180, -74.0628);
    const radius = parseCoordinate(req.query.radius, 500, 100_000, 10_000);

    const { locality } = findNearestLocality(latitude, longitude);
    const liveData = await fetchOpenMeteo(latitude, longitude);
    const receivedAt = new Date().toISOString();

    const allStations = await getCombinedStations({ latitude, longitude }, liveData);

    const radiusKm = radius / 1000;
    const withinRadius = allStations.filter((s) => (s.distanceKm ?? 999) <= radiusKm);
    const nearestStations = (withinRadius.length ? withinRadius : allStations).slice(0, 8);

    const rainVal = liveData?.current ? Number(liveData.current.precipitation.toFixed(1)) : null;
    const { level, label: levelLabel } = classifyRainfallIntensity(rainVal);

    const hourly = liveData?.hourly;
    const currentIso = liveData?.current?.time ?? null;
    const nowIdx = hourly?.time && currentIso ? Math.max(0, hourly.time.findIndex((t) => t >= currentIso.slice(0, 13))) : -1;

    const acc24hMm =
      hourly?.precipitation && nowIdx >= 0
        ? Number(
            hourly.precipitation
              .slice(Math.max(0, nowIdx - 23), nowIdx + 1)
              .reduce((acc, v) => acc + (v ?? 0), 0)
              .toFixed(1)
          )
        : null;

    const currentProb =
      hourly?.precipitation_probability && nowIdx >= 0
        ? Math.round(hourly.precipitation_probability[nowIdx] ?? 0)
        : null;

    const observedIso = currentIso
      ? new Date(currentIso.includes('Z') ? currentIso : `${currentIso}-05:00`).toISOString()
      : null;

    const officialAlerts = buildOfficialAlerts({ latitude, longitude }, locality.name, liveData);
    const userRuleAlerts = evaluateAlertRules(store.alertRules, { latitude, longitude }, rainVal, receivedAt);

    const response: NearbyWeatherResponse = {
      location: {
        latitude,
        longitude,
        locality: locality.name,
        city: locality.city,
        altitudeM: locality.altitudeM,
        isApproximate: true,
      },
      current: {
        temperatureC: liveData?.current ? Number(liveData.current.temperature_2m.toFixed(1)) : null,
        feelsLikeC: liveData?.current ? Number(liveData.current.apparent_temperature.toFixed(1)) : null,
        humidityPct: liveData?.current ? Math.round(liveData.current.relative_humidity_2m) : null,
        windKmh: liveData?.current ? Number(liveData.current.wind_speed_10m.toFixed(1)) : null,
        windDirectionDeg: liveData?.current ? Math.round(liveData.current.wind_direction_10m) : null,
        pressureHpa: liveData?.current ? Math.round(liveData.current.surface_pressure) : null,
        weatherCode: liveData?.current ? liveData.current.weather_code : null,
        conditionLabel: describeWeatherCode(liveData?.current?.weather_code ?? null),
        isDay: liveData?.current ? liveData.current.is_day === 1 : true,
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
        source: liveData ? liveData.source : 'Sin conexión con proveedor meteorológico',
        category: 'estimation',
        observedAt: observedIso,
        receivedAt,
        qualityFlag: liveData ? 'valid' : 'unavailable',
        note: liveData
          ? 'Condiciones actuales estimadas por modelo atmosférico en vivo; las lecturas puntuales de estación pueden variar por microclima.'
          : 'No se pudo obtener una observación válida; se devuelve estado explícito sin datos inventados.',
      },
      nearestStations,
      alerts: [...officialAlerts, ...userRuleAlerts],
      lastUpdated: observedIso,
    };

    res.json(response);
  });

  app.get('/api/v1/stations', async (req, res) => {
    const latitude = parseCoordinate(req.query.latitude, -90, 90, 4.6486);
    const longitude = parseCoordinate(req.query.longitude, -180, 180, -74.0628);
    const sourceFilter = typeof req.query.source === 'string' ? req.query.source : '';
    const cityFilter = typeof req.query.city === 'string' ? req.query.city : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const liveData = await fetchOpenMeteo(latitude, longitude);
    let stations = await getCombinedStations({ latitude, longitude }, liveData);

    if (sourceFilter && sourceFilter !== 'all') {
      stations = stations.filter((s) => s.source === sourceFilter);
    }
    if (cityFilter && cityFilter !== 'all') {
      stations = stations.filter((s) => s.city === cityFilter);
    }
    if (statusFilter && statusFilter !== 'all') {
      stations = stations.filter((s) => s.status === statusFilter);
    }
    if (q) {
      stations = stations.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.locality.toLowerCase().includes(q) ||
          s.city.toLowerCase().includes(q)
      );
    }

    const idigerCount = stations.filter((s) => s.source === 'IDIGER' && s.city === 'Bogotá').length;
    res.json({
      stations,
      total: stations.length,
      idigerBogotaCount: idigerCount,
      receivedAt: new Date().toISOString(),
    });
  });

  app.get('/api/v1/stations/:id/observations', async (req, res) => {
    const reqId = req.params.id;
    const allSab = await fetchLiveSabBogotaStations({ latitude: 4.6486, longitude: -74.0628 });
    const sabMatch = allSab.find((s) => s.id === reqId);
    const catalogMatch = STATION_CATALOG.find((s) => s.id === reqId);

    if (!sabMatch && !catalogMatch) {
      res.status(404).json({ error: 'Estación no encontrada.' });
      return;
    }

    const lat = sabMatch ? sabMatch.latitude : catalogMatch!.latitude;
    const lon = sabMatch ? sabMatch.longitude : catalogMatch!.longitude;
    const liveData = await fetchOpenMeteo(lat, lon);

    const stationSummary = sabMatch
      ? sabMatch
      : buildStationWithLiveContext(catalogMatch!, { latitude: lat, longitude: lon }, liveData);

    if (stationSummary.status === 'maintenance' || !liveData?.hourly || !liveData.current) {
      res.json({
        station: stationSummary,
        observations: [] as StationObservationPoint[],
        traceability: {
          source: `${stationSummary.source} · Sin lectura disponible`,
          category: 'observation',
          observedAt: stationSummary.latestReading.observedAt,
          receivedAt: new Date().toISOString(),
          qualityFlag: 'unavailable',
          note:
            stationSummary.status === 'maintenance'
              ? 'Estación en mantenimiento preventivo. No se fabrican datos faltantes.'
              : 'Proveedor temporalmente sin respuesta.',
        },
      });
      return;
    }

    const nowIdx = Math.max(
      0,
      liveData.hourly.time.findIndex((t) => t >= liveData.current!.time.slice(0, 13))
    );
    const startIdx = Math.max(0, nowIdx - 23);
    const observations: StationObservationPoint[] = [];

    for (let i = startIdx; i <= nowIdx; i++) {
      observations.push({
        timestamp: liveData.hourly.time[i],
        rainfallMm: Number((liveData.hourly.precipitation[i] ?? 0).toFixed(1)),
        temperatureC: Number((liveData.hourly.temperature_2m[i] ?? 0).toFixed(1)),
        humidityPct: Math.round(liveData.hourly.relative_humidity_2m[i] ?? 0),
        qualityFlag: stationSummary.status === 'delayed' && i === nowIdx ? 'delayed' : 'valid',
      });
    }

    res.json({
      station: stationSummary,
      observations,
      traceability: {
        source: sabMatch
          ? 'Red Hidrometeorológica IDIGER · SAB Bogotá (acumulado diario real) + serie horaria Open-Meteo'
          : `Serie normalizada Open-Meteo (Referencia geográfica ${stationSummary.source})`,
        category: sabMatch ? 'observation' : 'estimation',
        observedAt: stationSummary.latestReading.observedAt,
        receivedAt: new Date().toISOString(),
        qualityFlag: stationSummary.latestReading.qualityFlag,
      },
    });
  });

  app.get('/api/v1/maps-config', (_req, res) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '';
    res.setHeader('Cache-Control', 'no-store');
    res.json({ apiKey });
  });

  app.get('/api/v1/radar/products', async (_req, res) => {
    const radar = await fetchRadarProducts();
    res.json(radar);
  });

  app.get('/api/v1/forecasts', async (req, res) => {
    const latitude = parseCoordinate(req.query.latitude, -90, 90, 4.6486);
    const longitude = parseCoordinate(req.query.longitude, -180, 180, -74.0628);
    const { locality } = findNearestLocality(latitude, longitude);
    const liveData = await fetchOpenMeteo(latitude, longitude);
    const receivedAt = new Date().toISOString();

    if (!liveData?.hourly || !liveData.daily || !liveData.current) {
      const emptyResp: ForecastResponse = {
        location: { latitude, longitude, locality: locality.name, city: locality.city },
        hourly: [],
        daily: [],
        history: [],
        summary: { totalLast7dMm: 0, totalNext7dMm: 0, peakHourTime: null, peakHourMm: 0 },
        traceability: {
          source: 'Open-Meteo',
          category: 'forecast',
          observedAt: null,
          receivedAt,
          qualityFlag: 'unavailable',
          note: 'No fue posible consultar el pronóstico en este momento.',
        },
      };
      res.json(emptyResp);
      return;
    }

    const currentHourPrefix = liveData.current.time.slice(0, 13);
    const nowIdx = Math.max(0, liveData.hourly.time.findIndex((t) => t >= currentHourPrefix));

    const hourly: HourlyForecastItem[] = [];
    let peakHourTime: string | null = null;
    let peakHourMm = 0;

    for (let i = nowIdx; i < Math.min(liveData.hourly.time.length, nowIdx + 36); i++) {
      const precip = Number((liveData.hourly.precipitation[i] ?? 0).toFixed(1));
      if (precip > peakHourMm) {
        peakHourMm = precip;
        peakHourTime = liveData.hourly.time[i];
      }
      hourly.push({
        time: liveData.hourly.time[i],
        temperatureC: Number((liveData.hourly.temperature_2m[i] ?? 0).toFixed(1)),
        precipitationProbPct: Math.round(liveData.hourly.precipitation_probability[i] ?? 0),
        precipitationMm: precip,
        windKmh: Number((liveData.hourly.wind_speed_10m[i] ?? 0).toFixed(1)),
        humidityPct: Math.round(liveData.hourly.relative_humidity_2m[i] ?? 0),
        weatherCode: liveData.hourly.weather_code[i] ?? 0,
      });
    }

    const todayStr = liveData.current.time.slice(0, 10);
    const daily: DailyForecastItem[] = [];
    const history: HistoricalDayItem[] = [];

    for (let i = 0; i < liveData.daily.time.length; i++) {
      const dateStr = liveData.daily.time[i];
      const precipSum = Number((liveData.daily.precipitation_sum[i] ?? 0).toFixed(1));
      const tMax = Number((liveData.daily.temperature_2m_max[i] ?? 0).toFixed(1));
      const tMin = Number((liveData.daily.temperature_2m_min[i] ?? 0).toFixed(1));

      if (dateStr < todayStr) {
        history.push({
          date: dateStr,
          precipitationSumMm: precipSum,
          tempMaxC: tMax,
          tempMinC: tMin,
          avgHumidityPct: null,
        });
      } else {
        const dayIndex = daily.length;
        const uncertaintyLabel =
          dayIndex <= 1
            ? 'Confianza alta'
            : dayIndex <= 3
              ? 'Confianza media'
              : 'Incertidumbre moderada-alta';
        daily.push({
          date: dateStr,
          tempMinC: tMin,
          tempMaxC: tMax,
          precipitationProbMaxPct: Math.round(liveData.daily.precipitation_probability_max[i] ?? 0),
          precipitationSumMm: precipSum,
          windMaxKmh: Number((liveData.daily.wind_speed_10m_max[i] ?? 0).toFixed(1)),
          weatherCode: liveData.daily.weather_code[i] ?? 0,
          uncertaintyLabel,
        });
      }
    }

    const totalLast7dMm = Number(history.reduce((s, d) => s + d.precipitationSumMm, 0).toFixed(1));
    const totalNext7dMm = Number(daily.reduce((s, d) => s + d.precipitationSumMm, 0).toFixed(1));

    const response: ForecastResponse = {
      location: { latitude, longitude, locality: locality.name, city: locality.city },
      hourly,
      daily: daily.slice(0, 7),
      history: history.slice(-7),
      summary: {
        totalLast7dMm,
        totalNext7dMm,
        peakHourTime,
        peakHourMm,
      },
      traceability: {
        source: liveData.source,
        category: 'forecast',
        observedAt: new Date(`${liveData.current.time}-05:00`).toISOString(),
        receivedAt,
        qualityFlag: 'valid',
        note: 'Los pronósticos expresan probabilidad e incertidumbre atmosférica; el radar actual no equivale a pronóstico.',
      },
    };

    res.json(response);
  });

  app.get('/api/v1/alerts/nearby', async (req, res) => {
    const latitude = parseCoordinate(req.query.latitude, -90, 90, 4.6486);
    const longitude = parseCoordinate(req.query.longitude, -180, 180, -74.0628);
    const { locality } = findNearestLocality(latitude, longitude);
    const liveData = await fetchOpenMeteo(latitude, longitude);
    const rainMm = liveData?.current ? Number(liveData.current.precipitation.toFixed(1)) : null;

    const officialAlerts = buildOfficialAlerts({ latitude, longitude }, locality.name, liveData);
    const userRuleAlerts = evaluateAlertRules(store.alertRules, { latitude, longitude }, rainMm);

    const rulesWithState = store.alertRules.map((r) => ({
      ...r,
      currentValueMmH: rainMm,
      triggered: userRuleAlerts.some((ev) => ev.id === `rule-event-${r.id}`),
    }));

    res.json({
      officialAlerts,
      userRuleAlerts,
      rules: rulesWithState,
      receivedAt: new Date().toISOString(),
    });
  });

  app.post('/api/v1/alerts/rules', (req, res) => {
    if (!checkRateLimit(req.ip ?? 'local')) {
      res.status(429).json({ error: 'Demasiadas solicitudes. Intenta en un minuto.' });
      return;
    }
    const { name, locality, latitude, longitude, radiusKm, thresholdMmH } = req.body ?? {};
    const check = validateAlertRuleInput({ name, locality, radiusKm, thresholdMmH });
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }

    const lat = parseCoordinate(latitude, -90, 90, 4.6486);
    const lon = parseCoordinate(longitude, -180, 180, -74.0628);

    const newRule: CustomAlertRule = {
      id: `rule-${crypto.randomUUID().slice(0, 8)}`,
      name: String(name).trim(),
      locality: String(locality).trim(),
      latitude: lat,
      longitude: lon,
      radiusKm: Number(radiusKm),
      thresholdMmH: Number(Number(thresholdMmH).toFixed(1)),
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    store.alertRules = [newRule, ...store.alertRules].slice(0, 25);
    saveStore(store);
    res.status(201).json({ rule: newRule });
  });

  app.patch('/api/v1/alerts/rules/:id', (req, res) => {
    const idx = store.alertRules.findIndex((r) => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Regla no encontrada.' });
      return;
    }
    const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !store.alertRules[idx].enabled;
    store.alertRules[idx] = { ...store.alertRules[idx], enabled };
    saveStore(store);
    res.json({ rule: store.alertRules[idx] });
  });

  app.delete('/api/v1/alerts/rules/:id', (req, res) => {
    const before = store.alertRules.length;
    store.alertRules = store.alertRules.filter((r) => r.id !== req.params.id);
    if (store.alertRules.length === before) {
      res.status(404).json({ error: 'Regla no encontrada.' });
      return;
    }
    saveStore(store);
    res.json({ deleted: true });
  });

  app.get('/api/v1/reports', (_req, res) => {
    res.json({
      reports: store.reports,
      total: store.reports.length,
    });
  });

  app.post('/api/v1/reports', (req, res) => {
    if (!checkRateLimit(req.ip ?? 'local')) {
      res.status(429).json({ error: 'Demasiadas solicitudes. Intenta en un minuto.' });
      return;
    }
    const { type, description, locality, latitude, longitude, protectLocation = true, photoDataUrl = null } =
      req.body ?? {};
    const check = validateCitizenReportInput({ type, description, locality, photoDataUrl });
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }

    const rawCoords = {
      latitude: parseCoordinate(latitude, -90, 90, 4.6486),
      longitude: parseCoordinate(longitude, -180, 180, -74.0628),
    };
    const finalCoords = protectLocation ? fuzzCoordinates(rawCoords) : rawCoords;

    const newReport: CitizenReport = {
      id: `rep-${crypto.randomUUID().slice(0, 8)}`,
      type,
      description: String(description).trim(),
      locality: String(locality).trim(),
      latitude: finalCoords.latitude,
      longitude: finalCoords.longitude,
      locationProtected: Boolean(protectLocation),
      photoDataUrl: typeof photoDataUrl === 'string' && photoDataUrl.length > 0 ? photoDataUrl : null,
      moderationStatus: 'en_revision',
      createdAt: new Date().toISOString(),
    };

    store.reports = [newReport, ...store.reports].slice(0, 40);
    saveStore(store);
    res.status(201).json({ report: newReport });
  });

  app.post('/api/v1/push-tokens', (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const platform = typeof req.body?.platform === 'string' ? req.body.platform.trim() : 'web-pwa';
    if (token.length < 8 || token.length > 256) {
      res.status(400).json({ error: 'Token de notificación inválido.' });
      return;
    }
    const updatedAt = new Date().toISOString();
    store.pushTokens = [
      { token, platform, updatedAt },
      ...store.pushTokens.filter((t) => t.token !== token),
    ].slice(0, 20);
    saveStore(store);
    res.status(201).json({ registered: true, updatedAt });
  });

  app.get('/api/v1/locations/favorites', (_req, res) => {
    res.json({ favorites: store.favorites });
  });

  app.post('/api/v1/locations/favorites', (req, res) => {
    const { label, locality, city, latitude, longitude } = req.body ?? {};
    if (typeof label !== 'string' || label.trim().length < 2 || label.trim().length > 50) {
      res.status(400).json({ error: 'Etiqueta de ubicación inválida.' });
      return;
    }
    const lat = parseCoordinate(latitude, -90, 90, 4.6486);
    const lon = parseCoordinate(longitude, -180, 180, -74.0628);

    const existing = store.favorites.find(
      (f) => Math.abs(f.latitude - lat) < 0.005 && Math.abs(f.longitude - lon) < 0.005
    );
    if (existing) {
      res.json({ favorite: existing, alreadySaved: true });
      return;
    }

    const fav: FavoriteLocation = {
      id: `fav-${crypto.randomUUID().slice(0, 8)}`,
      label: label.trim(),
      locality: typeof locality === 'string' && locality.trim() ? locality.trim() : label.trim(),
      city: typeof city === 'string' && city.trim() ? city.trim() : 'Bogotá',
      latitude: lat,
      longitude: lon,
      createdAt: new Date().toISOString(),
    };

    store.favorites = [fav, ...store.favorites].slice(0, 12);
    saveStore(store);
    res.status(201).json({ favorite: fav });
  });

  app.delete('/api/v1/locations/favorites/:id', (req, res) => {
    store.favorites = store.favorites.filter((f) => f.id !== req.params.id);
    saveStore(store);
    res.json({ deleted: true });
  });

  // --- Vite / Static Frontend Serving ---
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pluvia Intelligence server listening on http://localhost:${PORT}`);
  });
}

startServer();
