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
import {
  addLocalReport,
  addLocalRule,
  deleteLocalFavorite,
  deleteLocalRule,
  fetchFallbackBogotaGeoJson,
  fetchFallbackCoreWeather,
  fetchFallbackForecast,
  fetchFallbackRadar,
  fetchJsonOrNull,
  getLocalFavorites,
  getLocalReports,
  saveLocalFavorite,
  toggleLocalRule,
} from './utils/clientFallbackApi';
import {
  resolveLocalityLabelForGps,
  shouldRecalculateRouteOrigin,
} from './utils/routeWeatherLogic';
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
  const [mapsApiKey, setMapsApiKey] = useState<string>(() => {
    const raw = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? '';
    return raw && raw !== 'MY_GOOGLE_MAPS_API_KEY' ? raw : '';
  });
  const [mapsConfigResolved, setMapsConfigResolved] = useState<boolean>(() => {
    const raw = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? '';
    return Boolean(raw && raw !== 'MY_GOOGLE_MAPS_API_KEY');
  });
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
  const [gpsStatus, setGpsStatus] = useState<'locating' | 'active' | 'denied' | 'manual'>('locating');
  const [liveGps, setLiveGps] = useState<{
    lat: number;
    lng: number;
    heading: number | null;
    accuracyM: number | null;
  } | null>(null);
  const manualOverrideRef = React.useRef(false);
  const lastWeatherGpsRef = React.useRef<{ lat: number; lng: number } | null>(null);

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
    const { latitude, longitude, locality, city } = selectedLoc;
    const radiusM = preferences.defaultRadiusKm * 1000;

    try {
      const [nearbyJson, stationsJson, alertsJson] = await Promise.all([
        fetchJsonOrNull<NearbyWeatherResponse>(
          `/api/v1/weather/nearby?latitude=${latitude}&longitude=${longitude}&radius=${radiusM}`
        ),
        fetchJsonOrNull<{ stations: WeatherStation[] }>(
          `/api/v1/stations?latitude=${latitude}&longitude=${longitude}`
        ),
        fetchJsonOrNull<{
          officialAlerts: WeatherAlert[];
          userRuleAlerts: WeatherAlert[];
          rules: CustomAlertRule[];
        }>(`/api/v1/alerts/nearby?latitude=${latitude}&longitude=${longitude}&radius=${radiusM}`),
      ]);

      if (nearbyJson && stationsJson) {
        setWeather(nearbyJson);
        setStations(stationsJson.stations ?? []);
        if (alertsJson) {
          setOfficialAlerts(alertsJson.officialAlerts ?? []);
          setUserRuleAlerts(alertsJson.userRuleAlerts ?? []);
          setRules(alertsJson.rules ?? []);
        }
        return;
      }

      // Static hosting fallback (GitHub Pages / Vercel / Netlify without Express backend)
      const fallback = await fetchFallbackCoreWeather({ latitude, longitude, locality, city });
      setWeather(fallback.weather);
      setStations(fallback.stations);
      setOfficialAlerts(fallback.officialAlerts);
      setUserRuleAlerts(fallback.userRuleAlerts);
      setRules(fallback.rules);
    } catch {
      // Keep last known data cleanly
    }
  }, [selectedLoc.latitude, selectedLoc.longitude, selectedLoc.locality, selectedLoc.city, preferences.defaultRadiusKm]);

  const fetchForecast = useCallback(async () => {
    setForecastLoading(true);
    try {
      const data = await fetchJsonOrNull<ForecastResponse>(
        `/api/v1/forecasts?latitude=${selectedLoc.latitude}&longitude=${selectedLoc.longitude}`
      );
      if (data) {
        setForecast(data);
        return;
      }
      const fallback = await fetchFallbackForecast({
        latitude: selectedLoc.latitude,
        longitude: selectedLoc.longitude,
        locality: selectedLoc.locality,
        city: selectedLoc.city,
      });
      if (fallback) setForecast(fallback);
    } finally {
      setForecastLoading(false);
    }
  }, [selectedLoc.latitude, selectedLoc.longitude, selectedLoc.locality, selectedLoc.city]);

  const fetchRadar = useCallback(async () => {
    try {
      const data = await fetchJsonOrNull<RadarProductsResponse>('/api/v1/radar/products');
      if (data) {
        setRadar(data);
        return;
      }
      setRadar(await fetchFallbackRadar());
    } catch {
      // Keep previous radar state
    }
  }, []);

  const fetchUserCollections = useCallback(async () => {
    try {
      const [reportsData, favsData] = await Promise.all([
        fetchJsonOrNull<{ reports: CitizenReport[] }>('/api/v1/reports'),
        fetchJsonOrNull<{ favorites: FavoriteLocation[] }>('/api/v1/locations/favorites'),
      ]);
      if (reportsData) {
        setReports(reportsData.reports ?? []);
      } else {
        setReports(getLocalReports());
      }
      if (favsData) {
        setFavorites(favsData.favorites ?? []);
      } else {
        setFavorites(getLocalFavorites());
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
    fetchJsonOrNull<{ apiKey?: string }>('/api/v1/maps-config')
      .then((data) => {
        const key = data?.apiKey?.trim() ?? '';
        if (key && key !== 'MY_GOOGLE_MAPS_API_KEY') {
          setMapsApiKey(key);
        }
      })
      .finally(() => setMapsConfigResolved(true));
  }, [mapsApiKey]);

  useEffect(() => {
    fetchRadar();
    fetchUserCollections();
    fetchJsonOrNull<{ type?: string }>('/api/v1/bogota/localities-geojson')
      .then(async (data) => {
        if (data && data.type === 'FeatureCollection') {
          setBogotaGeoJson(data);
          return;
        }
        const direct = (await fetchFallbackBogotaGeoJson()) as { type?: string } | null;
        if (direct && direct.type === 'FeatureCollection') {
          setBogotaGeoJson(direct);
        }
      })
      .catch(() => {
        // Ignore non-critical boundary overlay failure
      });
  }, [fetchRadar, fetchUserCollections]);

  const applyGpsCoordinates = useCallback(
    (pos: GeolocationPosition, forceUpdateLocation = false) => {
      const lat = Number(pos.coords.latitude.toFixed(5));
      const lng = Number(pos.coords.longitude.toFixed(5));
      const heading =
        typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading)
          ? pos.coords.heading
          : null;
      const accuracyM =
        typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy)
          ? Math.round(pos.coords.accuracy)
          : null;

      setLiveGps({ lat, lng, heading, accuracyM });
      setGpsStatus('active');
      setGpsLoading(false);
      setGpsError(null);
      updatePreferences({ gpsEnabled: true });

      if (manualOverrideRef.current && !forceUpdateLocation) return;

      // Sync weather/locality query only on first fix, manual request, or real movement (>250m)
      if (
        forceUpdateLocation ||
        shouldRecalculateRouteOrigin(lastWeatherGpsRef.current, { lat, lng }, 250)
      ) {
        lastWeatherGpsRef.current = { lat, lng };
        const resolved = resolveLocalityLabelForGps(lat, lng, COLOMBIA_LOCALITIES);
        setSelectedLoc({
          label: 'Mi ubicación',
          locality: resolved.locality,
          city: resolved.city,
          latitude: lat,
          longitude: lng,
          isGps: true,
        });
      }
    },
    [updatePreferences]
  );

  // Automatically request & track each user's mobile device GPS on app startup
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatus('denied');
      return;
    }

    setGpsStatus('locating');
    let watchId: number | null = null;

    navigator.geolocation.getCurrentPosition(
      (pos) => applyGpsCoordinates(pos, false),
      () => {
        setGpsStatus((prev) => (prev === 'active' ? prev : 'denied'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );

    watchId = navigator.geolocation.watchPosition(
      (pos) => applyGpsCoordinates(pos, false),
      () => {
        setGpsStatus((prev) => (prev === 'active' ? prev : 'denied'));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [applyGpsCoordinates]);

  const handleRequestGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatus('denied');
      setGpsError('Tu navegador no admite geolocalización GPS. Selecciona una localidad manualmente.');
      return;
    }
    manualOverrideRef.current = false;
    setGpsLoading(true);
    setGpsStatus('locating');
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyGpsCoordinates(pos, true);
        setLocationSheetOpen(false);
      },
      () => {
        setGpsLoading(false);
        setGpsStatus('denied');
        setGpsError('Activa el permiso de ubicación en tu navegador/teléfono para iniciar la ruta desde donde estás.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [applyGpsCoordinates]);

  const handleRevokeGps = () => {
    manualOverrideRef.current = true;
    setLiveGps(null);
    setGpsStatus('manual');
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
    const saved = await fetchJsonOrNull('/api/v1/alerts/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!saved) {
      setRules(addLocalRule(input));
    }
    await fetchCoreWeather();
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    const saved = await fetchJsonOrNull(`/api/v1/alerts/rules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!saved) {
      setRules(toggleLocalRule(id, enabled));
    }
    await fetchCoreWeather();
  };

  const handleDeleteRule = async (id: string) => {
    const saved = await fetchJsonOrNull(`/api/v1/alerts/rules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!saved) {
      setRules(deleteLocalRule(id));
    }
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
    const saved = await fetchJsonOrNull('/api/v1/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!saved) {
      setReports(addLocalReport(payload));
      return;
    }
    await fetchUserCollections();
  };

  const handleSaveCurrentFavorite = async () => {
    const favPayload = {
      label: weather?.location.locality ?? selectedLoc.locality,
      locality: weather?.location.locality ?? selectedLoc.locality,
      city: weather?.location.city ?? selectedLoc.city,
      latitude: selectedLoc.latitude,
      longitude: selectedLoc.longitude,
    };
    const saved = await fetchJsonOrNull('/api/v1/locations/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(favPayload),
    });
    if (!saved) {
      setFavorites(saveLocalFavorite(favPayload));
      return;
    }
    await fetchUserCollections();
  };

  const handleDeleteFavorite = async (id: string) => {
    const saved = await fetchJsonOrNull(`/api/v1/locations/favorites/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!saved) {
      setFavorites(deleteLocalFavorite(id));
      return;
    }
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
            isGps: selectedLoc.isGps,
          }}
          liveGps={liveGps}
          gpsStatus={gpsStatus}
          onRequestGps={handleRequestGps}
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
          manualOverrideRef.current = true;
          setGpsStatus('manual');
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
          manualOverrideRef.current = !loc.isGps;
          setGpsStatus(loc.isGps ? 'active' : 'manual');
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
