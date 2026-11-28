import test from 'node:test';
import assert from 'node:assert/strict';
import type { WeatherStation } from '../types/weather';
import {
  analyzeRouteTraffic,
  computeBearingDeg,
  computeDryBypassWaypoint,
  computeGpsSpeedKmh,
  computeRelativeArrowRotation,
  computeRemainingTripMetrics,
  computeTrafficDelayMin,
  evaluateRouteRainExposure,
  extractRainZones,
  findCurrentStepIndexForGps,
  findNearestPointIndex,
  formatArrivalTimeEs,
  formatDistanceEs,
  formatDurationEs,
  formatLastUpdatedEs,
  normalizeManeuver,
  offsetCenterAhead,
  parseStepBannerDisplay,
  rankRoutes,
  resolveLocalityLabelForGps,
  shouldRecalculateRouteOrigin,
} from './routeWeatherLogic';

function makeStation(overrides: Partial<WeatherStation> & { accDayMm?: number; isRainingNow?: boolean }): WeatherStation {
  return {
    id: overrides.id ?? 'st-1',
    name: overrides.name ?? 'Estación Demo',
    source: 'IDIGER',
    type: 'Pluviográfica',
    latitude: overrides.latitude ?? 4.65,
    longitude: overrides.longitude ?? -74.08,
    altitudeM: 2600,
    locality: overrides.locality ?? 'Engativá',
    city: 'Bogotá',
    status: overrides.status ?? 'online',
    latestReading: {
      rainfallMmH: overrides.isRainingNow ? 2.4 : 0,
      accDayMm: overrides.accDayMm ?? 0,
      acc1hMm: overrides.isRainingNow ? 2.4 : 0,
      acc6hMm: overrides.accDayMm ?? 0,
      acc24hMm: overrides.accDayMm ?? 0,
      temperatureC: null,
      humidityPct: null,
      windKmh: null,
      isRainingNow: overrides.isRainingNow ?? false,
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      qualityFlag: 'valid',
      dataCategory: 'observation',
    },
  };
}

test('extractRainZones ignores dry and maintenance stations and flags active/wet stations', () => {
  const stations = [
    makeStation({ id: 'dry', accDayMm: 0.2, isRainingNow: false }),
    makeStation({ id: 'maint', status: 'maintenance', accDayMm: 20, isRainingNow: true }),
    makeStation({ id: 'wet', locality: 'Fontibón', accDayMm: 14.5, isRainingNow: false }),
    makeStation({ id: 'active', locality: 'Engativá', accDayMm: 4.0, isRainingNow: true }),
  ];

  const zones = extractRainZones(stations);
  assert.equal(zones.length, 2);
  assert.equal(zones.find((z) => z.stationId === 'active')?.severity, 'active');
  assert.equal(zones.find((z) => z.stationId === 'wet')?.severity, 'active');
});

test('evaluateRouteRainExposure distinguishes a dry route from a route crossing active rain', () => {
  const rainZone = extractRainZones([
    makeStation({ id: 'r1', locality: 'Engativá', latitude: 4.68, longitude: -74.1, accDayMm: 12, isRainingNow: true }),
  ]);

  const wetPath = [
    { lat: 4.65, lng: -74.1 },
    { lat: 4.67, lng: -74.1 },
    { lat: 4.68, lng: -74.1 },
    { lat: 4.70, lng: -74.1 },
  ];
  const dryPath = [
    { lat: 4.65, lng: -74.05 },
    { lat: 4.67, lng: -74.05 },
    { lat: 4.68, lng: -74.05 },
    { lat: 4.70, lng: -74.05 },
  ];

  const wetEval = evaluateRouteRainExposure(wetPath, rainZone);
  const dryEval = evaluateRouteRainExposure(dryPath, rainZone);

  assert.equal(dryEval.isDry, true);
  assert.equal(dryEval.rainExposureScore, 0);
  assert.equal(wetEval.isDry, false);
  assert.ok(wetEval.rainExposureScore > 25);
  assert.equal(wetEval.affectedZones[0].locality, 'Engativá');
});

test('computeDryBypassWaypoint steers away from rain zones toward the drier side', () => {
  const rainZones = extractRainZones([
    makeStation({ id: 'center-rain', latitude: 4.68, longitude: -74.08, accDayMm: 15, isRainingNow: true }),
    makeStation({ id: 'west-rain', latitude: 4.68, longitude: -74.11, accDayMm: 12, isRainingNow: true }),
  ]);

  const bypass = computeDryBypassWaypoint(
    { lat: 4.63, lng: -74.08 },
    { lat: 4.73, lng: -74.08 },
    [rainZones[0]],
    rainZones
  );

  assert.ok(bypass !== null);
  // Rain is to the west (-74.11), so the drier bypass must steer east (lng > -74.08)
  assert.ok(bypass.lng > -74.08, `Expected bypass lng > -74.08, got ${bypass.lng}`);
});

test('rankRoutes prioritizes drier route when avoidRain is true and fastest when false', () => {
  const wetFast = {
    id: 'fast',
    durationMillis: 15 * 60_000,
    weather: {
      rainExposureScore: 60,
      wetSegmentsCount: 10,
      totalSamples: 20,
      wetPercentage: 50,
      affectedZones: [],
      isDry: false,
      verdictLabel: 'Cruza lluvia activa',
    },
  };
  const drySlightlySlower = {
    id: 'dry',
    durationMillis: 19 * 60_000,
    weather: {
      rainExposureScore: 0,
      wetSegmentsCount: 0,
      totalSamples: 20,
      wetPercentage: 0,
      affectedZones: [],
      isDry: true,
      verdictLabel: 'Ruta seca',
    },
  };

  assert.equal(rankRoutes([wetFast, drySlightlySlower], true)[0].id, 'dry');
  assert.equal(rankRoutes([wetFast, drySlightlySlower], false)[0].id, 'fast');
});

test('traffic delay and Spanish formatting helpers return clean readable values', () => {
  assert.equal(computeTrafficDelayMin(28 * 60_000, 20 * 60_000), 8);
  assert.equal(computeTrafficDelayMin(15 * 60_000, 16 * 60_000), 0);
  assert.equal(formatDurationEs(24 * 60_000), '24 min');
  assert.equal(formatDurationEs(75 * 60_000), '1 h 15 min');
  assert.equal(formatDistanceEs(840), '840 m');
  assert.equal(formatDistanceEs(8460), '8.5 km');
});

test('computeBearingDeg returns accurate compass headings for cardinal directions', () => {
  const north = computeBearingDeg({ lat: 4.6, lng: -74.08 }, { lat: 4.7, lng: -74.08 });
  const east = computeBearingDeg({ lat: 4.6, lng: -74.08 }, { lat: 4.6, lng: -73.98 });
  const south = computeBearingDeg({ lat: 4.7, lng: -74.08 }, { lat: 4.6, lng: -74.08 });
  const west = computeBearingDeg({ lat: 4.6, lng: -74.08 }, { lat: 4.6, lng: -74.18 });

  assert.ok(north < 1 || north > 359, `Expected ~0 deg north, got ${north}`);
  assert.ok(Math.abs(east - 90) < 1, `Expected ~90 deg east, got ${east}`);
  assert.ok(Math.abs(south - 180) < 1, `Expected ~180 deg south, got ${south}`);
  assert.ok(Math.abs(west - 270) < 1, `Expected ~270 deg west, got ${west}`);
});

test('findNearestPointIndex snaps live position to closest route point', () => {
  const path = [
    { lat: 4.64, lng: -74.06 },
    { lat: 4.65, lng: -74.07 },
    { lat: 4.66, lng: -74.08 },
  ];
  assert.equal(findNearestPointIndex({ lat: 4.651, lng: -74.069 }, path), 1);
  assert.equal(findNearestPointIndex({ lat: 4.662, lng: -74.081 }, path), 2);
});

test('shouldRecalculateRouteOrigin ignores minor GPS jitter and triggers on real movement', () => {
  const start = { lat: 4.6761, lng: -74.0483 };
  // First fix always triggers
  assert.equal(shouldRecalculateRouteOrigin(null, start), true);
  // 15m indoor drift should NOT spam Routes API
  assert.equal(shouldRecalculateRouteOrigin(start, { lat: 4.6762, lng: -74.04835 }, 120), false);
  // 350m movement MUST trigger route recalculation from new GPS location
  assert.equal(shouldRecalculateRouteOrigin(start, { lat: 4.6793, lng: -74.0483 }, 120), true);
});

test('resolveLocalityLabelForGps matches nearby locality and falls back cleanly outside coverage', () => {
  const catalog = [
    { name: 'Chapinero', city: 'Bogotá', latitude: 4.6486, longitude: -74.0628 },
    { name: 'Usaquén', city: 'Bogotá', latitude: 4.7045, longitude: -74.0315 },
  ];
  const nearUsaquen = resolveLocalityLabelForGps(4.699, -74.033, catalog);
  assert.equal(nearUsaquen.locality, 'Usaquén');
  assert.equal(nearUsaquen.city, 'Bogotá');

  const outside = resolveLocalityLabelForGps(10.391, -75.479, catalog);
  assert.equal(outside.locality, 'Mi ubicación GPS');
  assert.equal(outside.city, 'En vivo');
});

test('analyzeRouteTraffic reports live jams even when duration <= staticDuration and flags heavy delays', () => {
  const jamNoDelay = analyzeRouteTraffic(42 * 60_000, 43 * 60_000, [
    { speed: 'NORMAL', path: [] },
    { speed: 'TRAFFIC_JAM', path: [] },
    { speed: 'TRAFFIC_JAM', path: [] },
  ]);
  assert.equal(jamNoDelay.severity, 'heavy');
  assert.equal(jamNoDelay.jamSegmentCount, 2);
  assert.match(jamNoDelay.label, /Trancón/);

  const heavyDelay = analyzeRouteTraffic(55 * 60_000, 42 * 60_000, [
    { speed: 'SLOW', path: [] },
    { speed: 'TRAFFIC_JAM', path: [] },
  ]);
  assert.equal(heavyDelay.severity, 'heavy');
  assert.equal(heavyDelay.delayMin, 13);
  assert.match(heavyDelay.label, /\+13 min/);

  const fluid = analyzeRouteTraffic(20 * 60_000, 21 * 60_000, [{ speed: 'NORMAL', path: [] }]);
  assert.equal(fluid.severity, 'fluid');
  assert.equal(fluid.label, 'Tráfico fluido');

  const walking = analyzeRouteTraffic(30 * 60_000, 30 * 60_000, [], false);
  assert.equal(walking.label, 'Sin tráfico vehicular');
});

test('computeRemainingTripMetrics scales remaining duration accurately across navigation steps', () => {
  const steps = [
    { distanceMeters: 2000, durationMillis: 300_000 },
    { distanceMeters: 4000, durationMillis: 600_000 },
    { distanceMeters: 4000, durationMillis: 600_000 },
  ];
  // Total live duration = 30 min (double static 15 min due to live traffic)
  const atStart = computeRemainingTripMetrics(30 * 60_000, 10_000, steps, 0);
  assert.equal(atStart.remainingDurationMillis, 30 * 60_000);
  assert.equal(atStart.remainingDistanceMeters, 10_000);

  // At step 1, 1200s of 1500s remain (80%) => 24 min remaining, 8 km remaining
  const atStep1 = computeRemainingTripMetrics(30 * 60_000, 10_000, steps, 1);
  assert.equal(atStep1.remainingDurationMillis, 24 * 60_000);
  assert.equal(atStep1.remainingDistanceMeters, 8000);
});

test('formatArrivalTimeEs and formatLastUpdatedEs produce valid Spanish strings', () => {
  const now = Date.UTC(2026, 10, 26, 20, 0, 0);
  const arrival = formatArrivalTimeEs(30 * 60_000, now);
  assert.ok(arrival.length > 0 && /\d/.test(arrival));
  assert.equal(formatLastUpdatedEs(now - 10_000, now), 'Ahora');
  assert.equal(formatLastUpdatedEs(now - 125_000, now), 'Hace 2 min');
});

test('extractRoadInfoFromInstruction and parseStepBannerDisplay parse real Bogotá Spanish instructions', () => {
  const depart = parseStepBannerDisplay(
    {
      maneuver: normalizeManeuver('DEPART', 'Dirígete hacia el sureste en Cl. 93a hacia Cra. 11a'),
      instruction: 'Dirígete hacia el sureste en Cl. 93a hacia Cra. 11a',
    },
    'Av. El Dorado'
  );
  assert.equal(depart.currentRoad, 'Cl. 93a');
  assert.equal(depart.primaryRoad, 'Cra. 11a');
  assert.equal(depart.prefix, 'hacia');

  const turnRight = parseStepBannerDisplay(
    {
      maneuver: normalizeManeuver('TURN_RIGHT', 'Gira a la derecha hacia Cra. 11'),
      instruction: 'Gira a la derecha hacia Cra. 11',
    },
    'Av. El Dorado'
  );
  assert.equal(turnRight.currentRoad, 'Cra. 11');
  assert.equal(turnRight.primaryRoad, 'Cra. 11');
  assert.match(turnRight.prefix, /derecha/i);

  const rampMerge = parseStepBannerDisplay(
    {
      maneuver: normalizeManeuver(
        'RAMP_RIGHT',
        'Gira ligeramente a la derecha para incorporarte a Av. Cdad. de Quito/Ave Cra 30'
      ),
      instruction: 'Gira ligeramente a la derecha para incorporarte a Av. Cdad. de Quito/Ave Cra 30',
    },
    'Av. El Dorado'
  );
  assert.equal(rampMerge.currentRoad, 'Av. Cdad. de Quito');
  assert.equal(rampMerge.primaryRoad, 'Av. Cdad. de Quito');
});

test('findCurrentStepIndexForGps identifies the closest step along a route', () => {
  const steps = [
    { startLocation: { lat: 4.676, lng: -74.048 }, path: [{ lat: 4.676, lng: -74.048 }] },
    { startLocation: { lat: 4.674, lng: -74.052 }, path: [{ lat: 4.674, lng: -74.052 }] },
    { startLocation: { lat: 4.668, lng: -74.065 }, path: [{ lat: 4.668, lng: -74.065 }] },
  ];
  assert.equal(findCurrentStepIndexForGps({ lat: 4.6742, lng: -74.0518 }, steps), 1);
  assert.equal(findCurrentStepIndexForGps({ lat: 4.6675, lng: -74.0655 }, steps), 2);
});

test('offsetCenterAhead shifts camera center forward along heading for lower-third cursor framing', () => {
  const origin = { lat: 4.6761, lng: -74.0483 };
  const northAhead = offsetCenterAhead(origin, 0, 100);
  assert.ok(northAhead.lat > origin.lat);
  assert.ok(Math.abs(northAhead.lng - origin.lng) < 0.0001);

  const eastAhead = offsetCenterAhead(origin, 90, 100);
  assert.ok(eastAhead.lng > origin.lng);
  assert.ok(Math.abs(eastAhead.lat - origin.lat) < 0.0001);
});

test('computeRelativeArrowRotation keeps chevron pointing up in heading-up mode', () => {
  assert.equal(computeRelativeArrowRotation(135, 135), 0);
  assert.equal(computeRelativeArrowRotation(135, 0), 135);
  assert.equal(computeRelativeArrowRotation(10, 350), 20);
});

test('computeGpsSpeedKmh uses native GPS speed or computes fallback velocity while filtering jitter', () => {
  // Native GPS speed (10 m/s = 36 km/h)
  assert.equal(
    computeGpsSpeedKmh(10, null, { lat: 4.6761, lng: -74.0483, timestampMs: 10000 }),
    36
  );
  // Stationary jitter (< 1.8 km/h) clamps cleanly to 0
  assert.equal(
    computeGpsSpeedKmh(0.2, null, { lat: 4.6761, lng: -74.0483, timestampMs: 10000 }),
    0
  );
  // Fallback calculation: ~111m North in 10 seconds ≈ 40 km/h
  const fallbackKmh = computeGpsSpeedKmh(
    null,
    { lat: 4.6760, lng: -74.0483, timestampMs: 10000 },
    { lat: 4.6770, lng: -74.0483, timestampMs: 20000 }
  );
  assert.ok(fallbackKmh >= 38 && fallbackKmh <= 42, `expected ~40 km/h, got ${fallbackKmh}`);
  // Tiny 2-meter GPS drift returns 0 km/h
  assert.equal(
    computeGpsSpeedKmh(
      null,
      { lat: 4.6760, lng: -74.0483, timestampMs: 10000 },
      { lat: 4.676015, lng: -74.0483, timestampMs: 15000 }
    ),
    0
  );
});
