import test from 'node:test';
import assert from 'node:assert/strict';
import type { WeatherStation } from '../types/weather';
import {
  computeBearingDeg,
  computeDryBypassWaypoint,
  computeTrafficDelayMin,
  evaluateRouteRainExposure,
  extractRainZones,
  findNearestPointIndex,
  formatDistanceEs,
  formatDurationEs,
  rankRoutes,
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
