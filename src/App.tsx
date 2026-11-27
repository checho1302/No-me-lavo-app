import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, CloudRain, User } from 'lucide-react';
import { COLOMBIA_LOCALITIES } from './data/colombiaCatalog';
import { AlertsSheet } from './components/AlertsSheet';
import { ForecastSheet } from './components/ForecastSheet';
import { FullScreenWeatherMap } from './components/FullScreenWeatherMap';
import { FunctionWheel, type WheelActionId } from './components/FunctionWheel';
import { LocationSheet } from './components/LocationSheet';
import { OfflineBanner } from './components/PWAInstallButton';
import { ProfileSheet } from './components/ProfileSheet';
import { ReportSheet } from './components/ReportSheet';
import { StationDetailSheet } from './components/StationDetailSheet';
import { StationsListSheet } from './components/StationsListSheet';
import { WazeGoogleMap } from './components/WazeGoogleMap';
import type {
  CitizenReport,
  CustomAlertRule,
  FavoriteLocation,
  ForecastResponse,
  NearbyWeatherResponse,
  RadarProductsResponse,
  UserPreferences,
  WeatherAlert,
  WeatherStation,
} from './types/weather';
import { formatTemperature } from './utils/weatherLogic';

const PREFS_STORAGE_KEY = 'nomelavo_prefs_v1';

const DEFAULT_PREFS: UserPreferences = {
  tempUnit: 'C',
  windUnit: 'km/h',
  defaultRadiusKm: 10,
  gpsEnabled: false,
  pushEnabled: false,
  theme: 'light',
};

function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<UserPreferences>) };
    }
  } catch {
    // Ignore storage access errors
  }
  return DEFAULT_PREFS;
}

export default function App() {
  const [preferences, setPreferences] = useState<UserPreferences>(loadPreferences);

  const [selectedLoc, setSelectedLoc] = useState<{
    label: string;
    locality: string;
    city: string;
    latitude: number;
    longitude: number;
    isGps: boolean;
  }>({
    label: COLOMBIA_LOCALITIES[0].name,
    locality: COLOMBIA_LOCALITIES[0].name,
    city: COLOMBIA_LOCALITIES[0].city,
    latitude: COLOMBIA_LOCALITIES[0].latitude,
    longitude: COLOMBIA_LOCALITIES[0].longitude,
    isGps: false,
  });

  const [weather, setWeather] = useState<NearbyWeatherResponse | null>(null);
  const [stations, setStations] = useState<WeatherStation[]>([]);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  const [radar, setRadar] = useState<RadarProductsResponse | null>(null);
  const [bogotaGeoJson, setBogotaGeoJson] = useState<unknown | null>(null);

  const [officialAlerts, setOfficialAlerts] = useState<WeatherAlert[]>([]);
  const [userRuleAlerts, setUserRuleAlerts] = useState<WeatherAlert[]>([]);
  const [rules, setRules] = useState<CustomAlertRule[]>([]);
  const [reports, setReports] = useState<CitizenReport[]>([]);
  const [favorites, setFavorites] = useState<FavoriteLocation[]>([]);

  // Minimal floating HUD & modal states
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    () => (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? ''
  );
  const [mapsConfigResolved, setMapsConfigResolved] = useState<boolean>(
    () => Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
  );
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [routeActive, setRouteActive] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [radarBarOpen, setRadarBarOpen] = useState(false);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [stationsSheetOpen, setStationsSheetOpen] = useState(false);
  const [forecastSheetOpen, setForecastSheetOpen] = useState(false);
  const [alertsSheetOpen, setAlertsSheetOpen] = useState(false);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [selectedStation, setSelectedStation] = useState<WeatherStation | null>(null);

  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Sync Tailwind .dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (preferences.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Ignore storage errors
    }
  }, [preferences]);

  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
  }, []);

  const fetchCoreWeather = useCallback(async () => {
    const { latitude, longitude } = selectedLoc;
    const radiusM = preferences.defaultRadiusKm * 1000;

    try {
      const [nearbyRes, stationsRes, alertsRes] = await Promise.all([
        fetch(`/api/v1/weather/nearby?latitude=${latitude}&longitude=${longitude}&radius=${radiusM}`),
        fetch(`/api/v1/stations?latitude=${latitude}&longitude=${longitude}`),
        fetch(`/api/v1/alerts/nearby?latitude=${latitude}&longitude=${longitude}&radius=${radiusM}`),
      ]);

      if (nearbyRes.ok) {
        setWeather((await nearbyRes.json()) as NearbyWeatherResponse);
      }

      if (stationsRes.ok) {
        const stationsJson = (await stationsRes.json()) as { stations: WeatherStation[] };
        setStations(stationsJson.stations ?? []);
      }

      if (alertsRes.ok) {
        const alertsJson = (await alertsRes.json()) as {
          officialAlerts: WeatherAlert[];
          userRuleAlerts: WeatherAlert[];
          rules: CustomAlertRule[];
        };
        setOfficialAlerts(alertsJson.officialAlerts ?? []);
        setUserRuleAlerts(alertsJson.userRuleAlerts ?? []);
        setRules(alertsJson.rules ?? []);
      }
    } catch {
      // Keep last known data cleanly
    }
  }, [selectedLoc.latitude, selectedLoc.longitude, preferences.defaultRadiusKm]);

  const fetchForecast = useCallback(async () => {
    setForecastLoading(true);
    try {
      const res = await fetch(
        `/api/v1/forecasts?latitude=${selectedLoc.latitude}&longitude=${selectedLoc.longitude}`
      );
      if (res.ok) {
        setForecast((await res.json()) as ForecastResponse);
      }
    } finally {
      setForecastLoading(false);
    }
  }, [selectedLoc.latitude, selectedLoc.longitude]);

  const fetchRadar = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/radar/products');
      if (res.ok) {
        setRadar((await res.json()) as RadarProductsResponse);
      }
    } catch {
      // Keep previous radar state
    }
  }, []);

  const fetchUserCollections = useCallback(async () => {
    try {
      const [reportsRes, favsRes] = await Promise.all([
        fetch('/api/v1/reports'),
        fetch('/api/v1/locations/favorites'),
      ]);
      if (reportsRes.ok) {
        const data = (await reportsRes.json()) as { reports: CitizenReport[] };
        setReports(data.reports ?? []);
      }
      if (favsRes.ok) {
        const data = (await favsRes.json()) as { favorites: FavoriteLocation[] };
        setFavorites(data.favorites ?? []);
      }
    } catch {
      // Keep existing state
    }
  }, []);

  useEffect(() => {
    fetchCoreWeather();
    fetchForecast();
  }, [fetchCoreWeather, fetchForecast]);

  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  useEffect(() => {
    if (mapsApiKey) {
      setMapsConfigResolved(true);
      return;
    }
    fetch('/api/v1/maps-config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.apiKey === 'string' && data.apiKey.length > 0) {
          setMapsApiKey(data.apiKey);
        }
      })
      .catch(() => {
        // Fallback cleanly if maps config is unavailable
      })
      .finally(() => setMapsConfigResolved(true));
  }, [mapsApiKey]);

  useEffect(() => {
    fetchRadar();
    fetchUserCollections();
    fetch('/api/v1/bogota/localities-geojson')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.type === 'FeatureCollection') {
          setBogotaGeoJson(data);
        }
      })
      .catch(() => {
        // Ignore non-critical boundary overlay failure
      });
  }, [fetchRadar, fetchUserCollections]);

  const handleRequestGps = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsError('Tu navegador no admite geolocalización GPS. Selecciona una localidad manualmente.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        updatePreferences({ gpsEnabled: true });
        setSelectedLoc({
          label: 'Mi ubicación',
          locality: 'Ubicación GPS',
          city: 'Colombia',
          latitude: Number(pos.coords.latitude.toFixed(4)),
          longitude: Number(pos.coords.longitude.toFixed(4)),
          isGps: true,
        });
        setLocationSheetOpen(false);
      },
      () => {
        setGpsLoading(false);
        setGpsError('Permiso de ubicación no concedido. Puedes elegir cualquier localidad manualmente.');
      },
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 }
    );
  };

  const handleRevokeGps = () => {
    updatePreferences({ gpsEnabled: false });
    setSelectedLoc({
      label: COLOMBIA_LOCALITIES[0].name,
      locality: COLOMBIA_LOCALITIES[0].name,
      city: COLOMBIA_LOCALITIES[0].city,
      latitude: COLOMBIA_LOCALITIES[0].latitude,
      longitude: COLOMBIA_LOCALITIES[0].longitude,
      isGps: false,
    });
  };

  const handleCreateRule = async (input: {
    name: string;
    locality: string;
    latitude: number;
    longitude: number;
    radiusKm: number;
    thresholdMmH: number;
  }) => {
    const res = await fetch('/api/v1/alerts/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Error creando regla');
    await fetchCoreWeather();
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    await fetch(`/api/v1/alerts/rules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    await fetchCoreWeather();
  };

  const handleDeleteRule = async (id: string) => {
    await fetch(`/api/v1/alerts/rules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    await fetchCoreWeather();
  };

  const handleSubmitReport = async (payload: {
    type: CitizenReport['type'];
    description: string;
    locality: string;
    latitude: number;
    longitude: number;
    protectLocation: boolean;
    photoDataUrl: string | null;
  }) => {
    const res = await fetch('/api/v1/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Error enviando reporte');
    await fetchUserCollections();
  };

  const handleSaveCurrentFavorite = async () => {
    const res = await fetch('/api/v1/locations/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: weather?.location.locality ?? selectedLoc.locality,
        locality: weather?.location.locality ?? selectedLoc.locality,
        city: weather?.location.city ?? selectedLoc.city,
        latitude: selectedLoc.latitude,
        longitude: selectedLoc.longitude,
      }),
    });
    if (res.ok) {
      await fetchUserCollections();
    }
  };

  const handleDeleteFavorite = async (id: string) => {
    await fetch(`/api/v1/locations/favorites/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    await fetchUserCollections();
  };

  const handleWheelAction = (action: WheelActionId) => {
    if (action === 'radar') {
      setRadarBarOpen((prev) => !prev);
      return;
    }
    if (action === 'estaciones') {
      setStationsSheetOpen(true);
      return;
    }
    if (action === 'pronostico') {
      setForecastSheetOpen(true);
      return;
    }
    if (action === 'alertas') {
      setAlertsSheetOpen(true);
      return;
    }
    if (action === 'reportar') {
      setReportSheetOpen(true);
    }
  };

  const activeLocalityObj = useMemo(() => {
    const found = COLOMBIA_LOCALITIES.find(
      (l) => l.name === (weather?.location.locality ?? selectedLoc.locality)
    );
    return found ?? COLOMBIA_LOCALITIES[0];
  }, [weather?.location.locality, selectedLoc.locality]);

  const combinedAlerts = useMemo(
    () => [...officialAlerts, ...userRuleAlerts],
    [officialAlerts, userRuleAlerts]
  );

  const rainingStationsCount = useMemo(
    () =>
      stations.filter(
        (s) => (s.latestReading.accDayMm ?? 0) > 0 || Boolean(s.latestReading.isRainingNow)
      ).length,
    [stations]
  );

  const activeLocalityName = weather?.location.locality ?? selectedLoc.locality;
  const activeCityName = weather?.location.city ?? selectedLoc.city;

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden select-none bg-slate-200 dark:bg-[#0B1320]">
      {/* Mandatory Google Maps Platform Demo Quota Notice (only visible if quota is exceeded) */}
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* 1. Full-Screen Live Waze-Style Traffic, Rain-Avoidance & SAB Bogotá Map */}
      {mapsApiKey ? (
        <WazeGoogleMap
          apiKey={mapsApiKey}
          center={{
            latitude: selectedLoc.latitude,
            longitude: selectedLoc.longitude,
            locality: activeLocalityName,
            city: activeCityName,
          }}
          stations={stations}
          radar={radar}
          bogotaGeoJson={bogotaGeoJson}
          favorites={favorites}
          theme={preferences.theme}
          radarBarOpen={radarBarOpen}
          onCloseRadarBar={() => setRadarBarOpen(false)}
          onRefreshRadar={fetchRadar}
          onSelectStation={(st) => setSelectedStation(st)}
          onRouteActiveChange={setRouteActive}
          onNavigatingChange={setIsNavigating}
        />
      ) : mapsConfigResolved ? (
        <FullScreenWeatherMap
          center={{
            latitude: selectedLoc.latitude,
            longitude: selectedLoc.longitude,
            locality: activeLocalityName,
            city: activeCityName,
          }}
          stations={stations}
          radar={radar}
          bogotaGeoJson={bogotaGeoJson}
          theme={preferences.theme}
          radarBarOpen={radarBarOpen}
          onCloseRadarBar={() => setRadarBarOpen(false)}
          onRefreshRadar={fetchRadar}
          onSelectStation={(st) => setSelectedStation(st)}
        />
      ) : null}

      {/* 2. Top Floating Minimal Header: Brand + Weather Chip (Left) & Profile Circle (Right) */}
      {!isNavigating && (
        <header className="fixed top-0 left-0 right-0 z-20 px-3.5 pt-3.5 sm:px-5 sm:pt-4 flex items-start justify-between gap-3 pointer-events-none pt-safe">
          {/* Compact Brand + Active Location & Live Weather Card */}
          <button
            type="button"
            onClick={() => setLocationSheetOpen(true)}
            aria-label={`Cambiar ubicación: ${activeLocalityName}, ${activeCityName}`}
            className="pointer-events-auto min-h-[48px] max-w-[calc(100vw-88px)] sm:max-w-[235px] pl-2.5 pr-3 py-1.5 rounded-2xl bg-white/92 dark:bg-slate-900/92 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 shadow-lg hover:bg-white dark:hover:bg-slate-900 flex items-center gap-2.5 text-left transition-colors"
          >
            <div className="w-9 h-9 rounded-xl bg-[#0F213D] dark:bg-sky-500 text-white flex items-center justify-center shrink-0">
              <CloudRain className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-extrabold font-display tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
                  No me lavo app
                </span>
                {weather?.current.temperatureC !== null && weather?.current.temperatureC !== undefined && (
                  <span className="text-xs font-bold font-mono tabular-nums text-sky-700 dark:text-sky-400 whitespace-nowrap">
                    {formatTemperature(weather.current.temperatureC, preferences.tempUnit)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 truncate">
                <span className="truncate font-medium">{activeLocalityName}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate text-slate-500 dark:text-slate-400">
                  {weather?.rainfall.levelLabel ?? 'En vivo'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </div>
            </div>
          </button>

          {/* Top-Right Profile Circle ("un círculo para el perfil") */}
          <button
            type="button"
            onClick={() => {
              setWheelOpen(false);
              setProfileSheetOpen(true);
            }}
            aria-label="Abrir perfil"
            title="Perfil"
            className="pointer-events-auto relative w-12 h-12 sm:w-13 sm:h-13 rounded-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-2 border-[#0F213D]/15 dark:border-sky-400/35 shadow-lg hover:scale-105 active:scale-95 flex items-center justify-center text-[#0F213D] dark:text-sky-300 transition-transform shrink-0"
          >
            <User className="w-5 h-5" />
            {preferences.gpsEnabled && (
              <span
                aria-hidden="true"
                className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900"
              />
            )}
          </button>
        </header>
      )}

      {/* 3. Bottom-Center Radial Function Wheel ("una rueda para las funciones") */}
      {!routeActive && (
        <FunctionWheel
          open={wheelOpen}
          radarBarOpen={radarBarOpen}
          alertCount={combinedAlerts.length}
          rainingStationsCount={rainingStationsCount}
          onToggleOpen={() => setWheelOpen((o) => !o)}
          onClose={() => setWheelOpen(false)}
          onSelectAction={handleWheelAction}
        />
      )}

      {/* 4. Simple On-Demand Modals / Bottom Sheets */}
      <ProfileSheet
        open={profileSheetOpen}
        onClose={() => setProfileSheetOpen(false)}
        preferences={preferences}
        activeLocation={{
          label: activeLocalityName,
          locality: activeLocalityName,
          city: activeCityName,
          latitude: selectedLoc.latitude,
          longitude: selectedLoc.longitude,
        }}
        favorites={favorites}
        gpsEnabled={preferences.gpsEnabled}
        onUpdatePreferences={updatePreferences}
        onRequestGps={handleRequestGps}
        onRevokeGps={handleRevokeGps}
        onSaveCurrentFavorite={handleSaveCurrentFavorite}
        onSelectFavorite={(fav) => {
          setSelectedLoc({
            label: fav.label,
            locality: fav.locality,
            city: fav.city,
            latitude: fav.latitude,
            longitude: fav.longitude,
            isGps: false,
          });
        }}
        onDeleteFavorite={handleDeleteFavorite}
        onOpenLocations={() => setLocationSheetOpen(true)}
      />

      <LocationSheet
        open={locationSheetOpen}
        onClose={() => setLocationSheetOpen(false)}
        localities={COLOMBIA_LOCALITIES}
        favorites={favorites}
        activeLocalityName={activeLocalityName}
        gpsEnabled={preferences.gpsEnabled}
        gpsLoading={gpsLoading}
        gpsError={gpsError}
        onSelectLocality={(loc) => {
          setSelectedLoc({
            ...loc,
            isGps: Boolean(loc.isGps),
          });
        }}
        onRequestGps={handleRequestGps}
        onRevokeGps={handleRevokeGps}
      />

      <StationsListSheet
        open={stationsSheetOpen}
        onClose={() => setStationsSheetOpen(false)}
        stations={stations}
        onSelectStation={(st) => setSelectedStation(st)}
      />

      <ForecastSheet
        open={forecastSheetOpen}
        onClose={() => setForecastSheetOpen(false)}
        forecast={forecast}
        loading={forecastLoading}
        preferences={preferences}
        locationLabel={`${activeLocalityName}, ${activeCityName}`}
      />

      <StationDetailSheet
        station={selectedStation}
        preferences={preferences}
        onClose={() => setSelectedStation(null)}
      />

      <AlertsSheet
        open={alertsSheetOpen}
        onClose={() => setAlertsSheetOpen(false)}
        officialAlerts={officialAlerts}
        userRuleAlerts={userRuleAlerts}
        rules={rules}
        localities={COLOMBIA_LOCALITIES}
        defaultLocality={activeLocalityObj}
        onCreateRule={handleCreateRule}
        onToggleRule={handleToggleRule}
        onDeleteRule={handleDeleteRule}
      />

      <ReportSheet
        open={reportSheetOpen}
        onClose={() => setReportSheetOpen(false)}
        reports={reports}
        localities={COLOMBIA_LOCALITIES}
        activeLocality={activeLocalityObj}
        onSubmitReport={handleSubmitReport}
      />

      <OfflineBanner />
    </div>
  );
}
