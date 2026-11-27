import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDistanceKm,
  classifyRainfallIntensity,
  classifySabDailyAccumulation,
  describeWeatherCode,
  escapeHtml,
  evaluateAlertRules,
  evaluateFreshness,
  formatTemperature,
  formatWind,
  fuzzCoordinates,
  validateAlertRuleInput,
  validateCitizenReportInput,
} from './weatherLogic';

test('classifySabDailyAccumulation matches official SAB IDIGER Bogotá daily thresholds', () => {
  assert.equal(classifySabDailyAccumulation(null).tier, 'none');
  assert.equal(classifySabDailyAccumulation(0).tier, 'none');
  assert.equal(classifySabDailyAccumulation(0.4).tier, 'low');
  assert.equal(classifySabDailyAccumulation(10).tier, 'low');
  assert.equal(classifySabDailyAccumulation(15.2).tier, 'moderate');
  assert.equal(classifySabDailyAccumulation(38).tier, 'high');
  assert.equal(classifySabDailyAccumulation(55.5).tier, 'very_high');
});

test('escapeHtml neutralizes angle brackets and quotes safely', () => {
  assert.equal(escapeHtml('<script>"test"</script>'), '&lt;script&gt;&quot;test&quot;&lt;/script&gt;');
});

test('calculateDistanceKm computes accurate Bogotá distance between Centro and Usaquén', () => {
  const centro = { latitude: 4.6097, longitude: -74.0817 };
  const usaquen = { latitude: 4.7045, longitude: -74.0315 };
  const dist = calculateDistanceKm(centro, usaquen);
  assert.ok(dist > 11 && dist < 13, `Expected ~11.9 km, got ${dist}`);
});

test('classifyRainfallIntensity distinguishes null, dry, light, moderate, heavy, intense', () => {
  assert.equal(classifyRainfallIntensity(null).label, 'Sin lectura');
  assert.equal(classifyRainfallIntensity(0).level, 'none');
  assert.equal(classifyRainfallIntensity(1.2).level, 'light');
  assert.equal(classifyRainfallIntensity(5.0).level, 'moderate');
  assert.equal(classifyRainfallIntensity(14.5).level, 'heavy');
  assert.equal(classifyRainfallIntensity(28.0).level, 'intense');
});

test('describeWeatherCode returns Spanish meteorological labels and safe fallback', () => {
  assert.equal(describeWeatherCode(63), 'Lluvia moderada');
  assert.equal(describeWeatherCode(95), 'Tormenta eléctrica');
  assert.equal(describeWeatherCode(null), 'Condición no disponible');
});

test('evaluateFreshness flags fresh, delayed, and unavailable observations', () => {
  const now = Date.parse('2026-11-26T15:00:00Z');
  assert.equal(evaluateFreshness('2026-11-26T14:52:00Z', now).qualityFlag, 'valid');
  assert.equal(evaluateFreshness('2026-11-26T14:25:00Z', now).qualityFlag, 'delayed');
  assert.equal(evaluateFreshness(null, now).qualityFlag, 'unavailable');
});

test('fuzzCoordinates protects user privacy by rounding to 2 decimal places', () => {
  const fuzzed = fuzzCoordinates({ latitude: 4.6486259, longitude: -74.0628311 });
  assert.deepEqual(fuzzed, { latitude: 4.65, longitude: -74.06 });
});

test('unit formatting converts temperature and wind cleanly with null safety', () => {
  assert.equal(formatTemperature(15, 'C'), '15°C');
  assert.equal(formatTemperature(15, 'F'), '59°F');
  assert.equal(formatTemperature(null, 'C'), '--');
  assert.equal(formatWind(18, 'km/h'), '18 km/h');
  assert.equal(formatWind(18, 'm/s'), '5.0 m/s');
});

test('evaluateAlertRules triggers only enabled rules within radius exceeding threshold', () => {
  const rules = [
    {
      id: 'r1',
      name: 'Lluvia fuerte Chapinero',
      locality: 'Chapinero',
      latitude: 4.6486,
      longitude: -74.0628,
      radiusKm: 5,
      thresholdMmH: 3,
      enabled: true,
      createdAt: '2026-11-26T12:00:00Z',
    },
    {
      id: 'r2',
      name: 'Regla desactivada',
      locality: 'Chapinero',
      latitude: 4.6486,
      longitude: -74.0628,
      radiusKm: 5,
      thresholdMmH: 1,
      enabled: false,
      createdAt: '2026-11-26T12:00:00Z',
    },
  ];
  const events = evaluateAlertRules(rules, { latitude: 4.65, longitude: -74.06 }, 4.8);
  assert.equal(events.length, 1);
  assert.equal(events[0].category, 'user_rule');
  assert.ok(events[0].disclaimer.includes('No reemplaza alertas oficiales'));
});

test('validateCitizenReportInput rejects empty descriptions and unsafe photo payloads', () => {
  assert.equal(
    validateCitizenReportInput({ type: 'lluvia_fuerte', description: 'abc', locality: 'Suba' }).valid,
    false
  );
  assert.equal(
    validateCitizenReportInput({
      type: 'granizo',
      description: 'Granizada fuerte sobre la Autopista Norte',
      locality: 'Usaquén',
      photoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
    }).valid,
    false
  );
  assert.equal(
    validateCitizenReportInput({
      type: 'lluvia_fuerte',
      description: 'Lluvia persistente cerca del parque Virrey',
      locality: 'Chapinero',
    }).valid,
    true
  );
});

test('validateAlertRuleInput enforces bounds on name, radius, and rainfall threshold', () => {
  assert.equal(
    validateAlertRuleInput({ name: 'ab', locality: 'Suba', radiusKm: 5, thresholdMmH: 3 }).valid,
    false
  );
  assert.equal(
    validateAlertRuleInput({ name: 'Lluvia casa', locality: 'Suba', radiusKm: 90, thresholdMmH: 3 }).valid,
    false
  );
  assert.equal(
    validateAlertRuleInput({ name: 'Lluvia casa', locality: 'Suba', radiusKm: 8, thresholdMmH: 2.5 }).valid,
    true
  );
});
