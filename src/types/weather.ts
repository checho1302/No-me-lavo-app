export type DataCategory = 'observation' | 'estimation' | 'forecast' | 'official_alert' | 'user_rule';

export type QualityFlag = 'valid' | 'delayed' | 'suspect' | 'unavailable';

export type RainfallLevel = 'none' | 'light' | 'moderate' | 'heavy' | 'intense';

export type SabAccumulationTier = 'none' | 'low' | 'moderate' | 'high' | 'very_high';

export type AlertSeverity = 'info' | 'advisory' | 'watch' | 'warning';

export type NavTab = 'inicio' | 'radar' | 'mapa' | 'pronostico' | 'perfil';

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface LocalityOption {
  id: string;
  name: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  altitudeM: number;
  coverageNote: string;
}

export interface TraceabilityMeta {
  source: string;
  category: DataCategory;
  observedAt: string | null;
  receivedAt: string;
  qualityFlag: QualityFlag;
  note?: string;
}

export interface WeatherStation {
  id: string;
  sensorId?: number;
  name: string;
  source: 'IDIGER' | 'IDEAM' | 'SIATA' | 'Aerocivil' | 'Open-Meteo';
  type: 'Pluviográfica' | 'Pluviómetro' | 'Meteorológica automática' | 'Aeronáutica' | 'Hidrometeorológica';
  technology?: string | null;
  latitude: number;
  longitude: number;
  altitudeM: number;
  locality: string;
  city: string;
  status: 'online' | 'delayed' | 'maintenance';
  distanceKm?: number;
  latestReading: {
    rainfallMmH: number | null;
    accDayMm: number | null;
    acc1hMm: number | null;
    acc6hMm: number | null;
    acc24hMm: number | null;
    temperatureC: number | null;
    humidityPct: number | null;
    windKmh: number | null;
    pressureHpa?: number | null;
    isRainingNow?: boolean;
    sabTier?: SabAccumulationTier;
    observedAt: string | null;
    receivedAt: string;
    qualityFlag: QualityFlag;
    dataCategory: DataCategory;
  };
}

export interface StationObservationPoint {
  timestamp: string;
  rainfallMm: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  qualityFlag: QualityFlag;
}

export interface WeatherAlert {
  id: string;
  title: string;
  description: string;
  type: 'lluvia' | 'tormenta' | 'granizo' | 'viento' | 'inundacion';
  severity: AlertSeverity;
  category: 'official_alert' | 'user_rule';
  source: string;
  locality: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  distanceKm?: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  disclaimer: string;
}

export interface CustomAlertRule {
  id: string;
  name: string;
  locality: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  thresholdMmH: number;
  enabled: boolean;
  createdAt: string;
  triggered?: boolean;
  currentValueMmH?: number | null;
}

export interface NearbyWeatherResponse {
  location: {
    latitude: number;
    longitude: number;
    locality: string;
    city: string;
    altitudeM: number;
    isApproximate: boolean;
  };
  current: {
    temperatureC: number | null;
    feelsLikeC: number | null;
    humidityPct: number | null;
    windKmh: number | null;
    windDirectionDeg: number | null;
    pressureHpa: number | null;
    weatherCode: number | null;
    conditionLabel: string;
    isDay: boolean;
  };
  rainfall: {
    value: number | null;
    unit: 'mm/h';
    acc1hMm: number | null;
    acc24hMm: number | null;
    probabilityPct: number | null;
    level: RainfallLevel;
    levelLabel: string;
  };
  traceability: TraceabilityMeta;
  nearestStations: WeatherStation[];
  alerts: WeatherAlert[];
  lastUpdated: string | null;
}

export interface HourlyForecastItem {
  time: string;
  temperatureC: number;
  precipitationProbPct: number;
  precipitationMm: number;
  windKmh: number;
  humidityPct: number;
  weatherCode: number;
}

export interface DailyForecastItem {
  date: string;
  tempMinC: number;
  tempMaxC: number;
  precipitationProbMaxPct: number;
  precipitationSumMm: number;
  windMaxKmh: number;
  weatherCode: number;
  uncertaintyLabel: string;
}

export interface HistoricalDayItem {
  date: string;
  precipitationSumMm: number;
  tempMaxC: number;
  tempMinC: number;
  avgHumidityPct: number | null;
}

export interface ForecastResponse {
  location: {
    latitude: number;
    longitude: number;
    locality: string;
    city: string;
  };
  hourly: HourlyForecastItem[];
  daily: DailyForecastItem[];
  history: HistoricalDayItem[];
  summary: {
    totalLast7dMm: number;
    totalNext7dMm: number;
    peakHourTime: string | null;
    peakHourMm: number;
  };
  traceability: TraceabilityMeta;
}

export interface RadarFrame {
  time: number;
  path: string;
  tileUrlTemplate: string;
  isForecast: boolean;
  label: string;
}

export interface RadarSite {
  id: string;
  name: string;
  region: string;
  provider: string;
  latitude: number;
  longitude: number;
  rangeKm: number;
  zoom: number;
  status: 'active' | 'mosaic';
  description: string;
}

export interface IdigerRadarOverlay {
  available: boolean;
  name: string;
  observedAt: string | null;
  imageUrl: string;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  source: string;
}

export interface RadarProductsResponse {
  host: string;
  generatedAt: string;
  sites: RadarSite[];
  frames: RadarFrame[];
  idigerRadar: IdigerRadarOverlay | null;
  traceability: TraceabilityMeta;
}

export interface CitizenReport {
  id: string;
  type: 'lluvia_ligera' | 'lluvia_fuerte' | 'granizo' | 'encharcamiento' | 'tormenta';
  description: string;
  locality: string;
  latitude: number;
  longitude: number;
  locationProtected: boolean;
  photoDataUrl: string | null;
  moderationStatus: 'en_revision' | 'verificado';
  createdAt: string;
}

export interface FavoriteLocation {
  id: string;
  label: string;
  locality: string;
  city: string;
  latitude: number;
  longitude: number;
  createdAt: string;
}

export interface UserPreferences {
  tempUnit: 'C' | 'F';
  windUnit: 'km/h' | 'm/s';
  defaultRadiusKm: number;
  gpsEnabled: boolean;
  pushEnabled: boolean;
  theme: 'light' | 'dark';
}
