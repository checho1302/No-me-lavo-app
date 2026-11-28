import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
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
  isSafeReportPhotoDataUrl,
  isValidEntityId,
  sanitizeRainViewerHost,
  sanitizeRainViewerTileUrl,
  validateAlertRuleInput,
  validateCitizenReportInput,
} from './weatherLogic';
import { extractZipEntries } from '../../server/sabIngestion';

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

test('security: escapeHtml neutralizes tooltip HTML/script injection payloads', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const escaped = escapeHtml(payload);
  assert.equal(escaped.includes('<'), false);
  assert.equal(escaped.includes('>'), false);
  assert.equal(escaped, '&lt;img src=x onerror=alert(1)&gt;');
});

test('security: validators reject non-string object payloads and oversized localities without throwing', () => {
  assert.equal(
    validateAlertRuleInput({
      name: { $gt: '' },
      locality: 'Chapinero',
      radiusKm: 5,
      thresholdMmH: 2,
    }).valid,
    false
  );
  assert.equal(
    validateAlertRuleInput({
      name: 'Regla válida',
      locality: 'A'.repeat(120),
      radiusKm: 5,
      thresholdMmH: 2,
    }).valid,
    false
  );
  assert.equal(
    validateCitizenReportInput({
      type: 'lluvia_fuerte',
      description: { $ne: null },
      locality: ['Suba'],
    }).valid,
    false
  );
  assert.equal(
    validateCitizenReportInput({
      type: 'lluvia_fuerte',
      description: 'Lluvia muy fuerte en la zona norte',
      locality: 'B'.repeat(100),
    }).valid,
    false
  );
});

test('security: isSafeReportPhotoDataUrl allows only raster base64 images and blocks SVG/external URLs', () => {
  assert.equal(isSafeReportPhotoDataUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isSafeReportPhotoDataUrl('data:image/jpeg;base64,/9j/4AAQ='), true);
  assert.equal(isSafeReportPhotoDataUrl('data:image/webp;base64,UklGRh4='), true);
  assert.equal(isSafeReportPhotoDataUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(isSafeReportPhotoDataUrl('https://evil.example/tracker.png'), false);
  assert.equal(isSafeReportPhotoDataUrl('javascript:alert(1)'), false);
  assert.equal(isSafeReportPhotoDataUrl(null), false);
});

test('security: sanitizeRainViewerTileUrl restricts host to HTTPS rainviewer.com and blocks path traversal', () => {
  assert.equal(
    sanitizeRainViewerHost('https://evil.example'),
    'https://tilecache.rainviewer.com'
  );
  assert.equal(
    sanitizeRainViewerHost('http://169.254.169.254'),
    'https://tilecache.rainviewer.com'
  );
  assert.equal(
    sanitizeRainViewerTileUrl('https://tilecache.rainviewer.com', '/v2/radar/1700000000', 6),
    'https://tilecache.rainviewer.com/v2/radar/1700000000/256/{z}/{x}/{y}/6/1_1.png'
  );
  assert.equal(
    sanitizeRainViewerTileUrl('https://evil.example', '/v2/radar/1700000000', 6),
    'https://tilecache.rainviewer.com/v2/radar/1700000000/256/{z}/{x}/{y}/6/1_1.png'
  );
  assert.equal(
    sanitizeRainViewerTileUrl('https://tilecache.rainviewer.com', '/../../etc/passwd', 6),
    null
  );
  assert.equal(
    sanitizeRainViewerTileUrl('https://tilecache.rainviewer.com', 'https://evil.example/x', 6),
    null
  );
});

test('security: isValidEntityId blocks path traversal and malformed IDs', () => {
  assert.equal(isValidEntityId('sab-idiger-102'), true);
  assert.equal(isValidEntityId('rule-1a2b3c4d'), true);
  assert.equal(isValidEntityId('../../etc/passwd'), false);
  assert.equal(isValidEntityId('<script>alert(1)</script>'), false);
  assert.equal(isValidEntityId('a'.repeat(80)), false);
});

function buildSyntheticZip(
  fileName: string,
  payload: Buffer,
  options: { method: 0 | 8; forgedUncompSize?: number }
): Buffer {
  const nameBuf = Buffer.from(fileName, 'utf8');
  const data = options.method === 8 ? zlib.deflateRawSync(payload) : payload;
  const declaredUncomp = options.forgedUncompSize ?? payload.length;

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(options.method, 8);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(declaredUncomp, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(localHeader, 30);

  const cdOffset = localHeader.length + data.length;
  const cdHeader = Buffer.alloc(46 + nameBuf.length);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(options.method, 10);
  cdHeader.writeUInt32LE(data.length, 20);
  cdHeader.writeUInt32LE(declaredUncomp, 24);
  cdHeader.writeUInt16LE(nameBuf.length, 28);
  cdHeader.writeUInt32LE(0, 42);
  nameBuf.copy(cdHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdHeader.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([localHeader, data, cdHeader, eocd]);
}

test('security: extractZipEntries blocks path traversal names and forged-header deflate zip bombs', () => {
  const traversalZip = buildSyntheticZip('../evil.kml', Buffer.from('<kml/>'), { method: 0 });
  assert.equal(extractZipEntries(traversalZip).size, 0);

  // 6 MB zero-filled buffer compresses to ~6 KB, while forging uncompSize = 100 in ZIP header
  const bombPayload = Buffer.alloc(6 * 1024 * 1024, 0x41);
  const forgedBombZip = buildSyntheticZip('doc.kml', bombPayload, {
    method: 8,
    forgedUncompSize: 100,
  });
  assert.equal(extractZipEntries(forgedBombZip).size, 0);

  // Legitimate small KMZ entry still extracts cleanly
  const validZip = buildSyntheticZip('doc.kml', Buffer.from('<kml><name>OK</name></kml>'), {
    method: 8,
  });
  const extracted = extractZipEntries(validZip);
  assert.equal(extracted.get('doc.kml')?.toString('utf8'), '<kml><name>OK</name></kml>');
});
