import zlib from 'node:zlib';
import type { IdigerRadarOverlay, WeatherStation } from '../src/types/weather.ts';
import {
  calculateDistanceKm,
  classifySabDailyAccumulation,
  evaluateFreshness,
} from '../src/utils/weatherLogic.ts';

const SAB_STATIONS_URL = 'https://app.sab.gov.co/sab/ServletTipoSensores?idtiposensor=5';
const IDIGER_RADAR_KMZ_URL = 'https://evp.sire.gov.co/radar_animate/datos/kml/reflectividad.kmz';
const BOGOTA_LOCALITIES_GEOJSON_URL =
  'https://services1.arcgis.com/zJ4jVF39oWSBtlEo/arcgis/rest/services/Localidades_SAB/FeatureServer/0/query?where=1%3D1&outFields=LocNombre,LocCodigo&f=geojson&outSR=4326';

interface SabRawSensor {
  IDSENSOR: number;
  IDESTACION: number;
  ESTACION: string;
  TIPOSENSOR?: string;
  LATITUD: number;
  LONGITUD: number;
  ESTADO?: number;
  TIPOTECNOLOGIA?: string | null;
  LOCALIDAD?: string;
  VISIBLE?: number;
  ACUMULADODIA?: number | null;
  VALORLECTURA?: number | null;
  FECHALECTURA?: string | null;
  ALTITUD?: number | null;
  ESTADOESTACION?: number;
  PRESIONATMOSFERICA?: number | null;
}

const LOCALITY_DISPLAY_NAMES: Record<string, string> = {
  USAQUEN: 'Usaquén',
  CHAPINERO: 'Chapinero',
  'SANTA FE': 'Santa Fe',
  'SAN CRISTOBAL': 'San Cristóbal',
  USME: 'Usme',
  TUNJUELITO: 'Tunjuelito',
  BOSA: 'Bosa',
  KENNEDY: 'Kennedy',
  FONTIBON: 'Fontibón',
  ENGATIVA: 'Engativá',
  SUBA: 'Suba',
  'BARRIOS UNIDOS': 'Barrios Unidos',
  TEUSAQUILLO: 'Teusaquillo',
  'LOS MARTIRES': 'Los Mártires',
  'ANTONIO NARINO': 'Antonio Nariño',
  'ANTONIO NARIÑO': 'Antonio Nariño',
  'PUENTE ARANDA': 'Puente Aranda',
  CANDELARIA: 'La Candelaria',
  'LA CANDELARIA': 'La Candelaria',
  'RAFAEL URIBE URIBE': 'Rafael Uribe Uribe',
  'RAFAEL URIBE': 'Rafael Uribe Uribe',
  'CIUDAD BOLIVAR': 'Ciudad Bolívar',
  SUMAPAZ: 'Sumapaz',
};

function formatLocalityName(raw?: string): string {
  if (!raw) return 'Bogotá';
  const upper = raw.trim().toUpperCase();
  if (LOCALITY_DISPLAY_NAMES[upper]) return LOCALITY_DISPLAY_NAMES[upper];
  return upper
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function parseBogotaTimestamp(raw?: string | null): string | null {
  if (!raw) return null;
  // Format from SAB: "2026-11-26 18:20:00.0" (America/Bogota UTC-5)
  const clean = raw.trim().replace(/\.\d+$/, '').replace(' ', 'T');
  const iso = `${clean}-05:00`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

interface CacheBox<T> {
  data: T;
  expiresAt: number;
}

let sabStationsCache: CacheBox<SabRawSensor[]> | null = null;
let idigerRadarCache: CacheBox<{ meta: IdigerRadarOverlay; pngBuffer: Buffer }> | null = null;
let localitiesGeoJsonCache: CacheBox<unknown> | null = null;

async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'NoMeLavoApp/1.0' },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLiveSabBogotaStations(
  refCoords: { latitude: number; longitude: number }
): Promise<WeatherStation[]> {
  let rawSensors: SabRawSensor[] = [];

  if (sabStationsCache && Date.now() < sabStationsCache.expiresAt) {
    rawSensors = sabStationsCache.data;
  } else {
    try {
      const resp = await fetchWithTimeout(SAB_STATIONS_URL, 6500);
      if (resp.ok) {
        const json = (await resp.json()) as { TipoSensores?: SabRawSensor[] };
        if (Array.isArray(json.TipoSensores) && json.TipoSensores.length > 0) {
          rawSensors = json.TipoSensores.filter(
            (s) =>
              Number.isFinite(Number(s.LATITUD)) &&
              Number.isFinite(Number(s.LONGITUD)) &&
              Number(s.LATITUD) !== 0 &&
              Number(s.LONGITUD) !== 0
          );
          sabStationsCache = { data: rawSensors, expiresAt: Date.now() + 90_000 };
        }
      }
    } catch {
      if (sabStationsCache) rawSensors = sabStationsCache.data;
    }
  }

  const receivedAt = new Date().toISOString();
  return rawSensors.map((s) => {
    const lat = Number(s.LATITUD);
    const lon = Number(s.LONGITUD);
    const observedAt = parseBogotaTimestamp(s.FECHALECTURA);
    const freshness = evaluateFreshness(observedAt);

    const accDay =
      s.ACUMULADODIA !== null && s.ACUMULADODIA !== undefined && Number.isFinite(Number(s.ACUMULADODIA))
        ? Number(Number(s.ACUMULADODIA).toFixed(1))
        : null;
    const valorLectura =
      s.VALORLECTURA !== null && s.VALORLECTURA !== undefined && Number.isFinite(Number(s.VALORLECTURA))
        ? Number(Number(s.VALORLECTURA).toFixed(1))
        : null;

    const isUnavailable = s.ESTADO === 0 || (accDay === null && valorLectura === null);
    const isDelayed = !isUnavailable && freshness.qualityFlag === 'delayed';
    const sabClass = classifySabDailyAccumulation(accDay);

    return {
      id: `sab-idiger-${s.IDSENSOR}`,
      sensorId: s.IDSENSOR,
      name: (s.ESTACION || `Estación ${s.IDESTACION}`).trim(),
      source: 'IDIGER',
      type: 'Pluviómetro',
      technology: s.TIPOTECNOLOGIA ?? null,
      latitude: lat,
      longitude: lon,
      altitudeM: s.ALTITUD && Number(s.ALTITUD) > 500 ? Math.round(Number(s.ALTITUD)) : 2600,
      locality: formatLocalityName(s.LOCALIDAD),
      city: 'Bogotá',
      status: isUnavailable ? 'maintenance' : isDelayed ? 'delayed' : 'online',
      distanceKm: calculateDistanceKm(refCoords, { latitude: lat, longitude: lon }),
      latestReading: {
        rainfallMmH: isUnavailable ? null : valorLectura,
        accDayMm: isUnavailable ? null : accDay,
        acc1hMm: isUnavailable ? null : valorLectura,
        acc6hMm: isUnavailable ? null : accDay,
        acc24hMm: isUnavailable ? null : accDay,
        temperatureC: null,
        humidityPct: null,
        windKmh: null,
        pressureHpa:
          s.PRESIONATMOSFERICA !== null &&
          s.PRESIONATMOSFERICA !== undefined &&
          Number.isFinite(Number(s.PRESIONATMOSFERICA))
            ? Math.round(Number(s.PRESIONATMOSFERICA))
            : null,
        isRainingNow: !isUnavailable && valorLectura !== null && valorLectura > 0,
        sabTier: sabClass.tier,
        observedAt,
        receivedAt,
        qualityFlag: isUnavailable ? 'unavailable' : isDelayed ? 'delayed' : 'valid',
        dataCategory: 'observation',
      },
    };
  });
}

const MAX_KMZ_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_BYTES = 12 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 64;

function isSafeZipEntryName(fileName: string): boolean {
  if (!fileName || fileName.length > 255) return false;
  if (fileName.includes('\0') || fileName.startsWith('/') || fileName.startsWith('\\')) return false;
  const normalized = fileName.replace(/\\/g, '/');
  if (normalized.split('/').some((segment) => segment === '..')) return false;
  return true;
}

/**
 * Minimal pure-Node ZIP extractor for KMZ files using Central Directory records.
 * Supports compression method 0 (stored) and 8 (deflate) with strict decompression limits.
 */
export function extractZipEntries(zipBuf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  if (zipBuf.length < 22 || zipBuf.length > MAX_KMZ_BYTES) return entries;

  // Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBuf.length - 65557);
  for (let i = zipBuf.length - 22; i >= minOffset; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return entries;

  const totalEntries = Math.min(zipBuf.readUInt16LE(eocdOffset + 10), MAX_ZIP_ENTRIES);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  let cursor = cdOffset;
  let totalExtracted = 0;

  for (let i = 0; i < totalEntries && cursor + 46 <= zipBuf.length; i++) {
    if (zipBuf.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = zipBuf.readUInt16LE(cursor + 10);
    const compSize = zipBuf.readUInt32LE(cursor + 20);
    const uncompSize = zipBuf.readUInt32LE(cursor + 24);
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLen > zipBuf.length) break;
    const fileName = zipBuf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    cursor += 46 + nameLen + extraLen + commentLen;

    if (!isSafeZipEntryName(fileName)) continue;

    // Guard against zip bombs (both declared header sizes AND actual inflated output length)
    if (uncompSize > MAX_ZIP_ENTRY_BYTES || compSize > MAX_ZIP_ENTRY_BYTES) continue;
    if (localHeaderOffset + 30 > zipBuf.length) continue;
    if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const lNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > zipBuf.length) continue;

    const rawSlice = zipBuf.subarray(dataStart, dataEnd);
    try {
      let extracted: Buffer | null = null;
      if (method === 0) {
        if (rawSlice.length > MAX_ZIP_ENTRY_BYTES) continue;
        extracted = Buffer.from(rawSlice);
      } else if (method === 8) {
        extracted = zlib.inflateRawSync(rawSlice, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
      }
      if (extracted) {
        if (totalExtracted + extracted.length > MAX_TOTAL_EXTRACTED_BYTES) break;
        totalExtracted += extracted.length;
        entries.set(fileName, extracted);
      }
    } catch {
      // Skip malformed or oversized compressed entry (e.g. forged header zip bomb)
    }
  }
  return entries;
}

const KML_TAG_REGEXES = {
  href: /<href>([^<]+)<\/href>/i,
  north: /<north>([^<]+)<\/north>/i,
  south: /<south>([^<]+)<\/south>/i,
  east: /<east>([^<]+)<\/east>/i,
  west: /<west>([^<]+)<\/west>/i,
  name: /<name>([^<]+)<\/name>/i,
} as const;

type AllowedKmlTag = keyof typeof KML_TAG_REGEXES;

function extractXmlTag(xml: string, tag: AllowedKmlTag): string | null {
  const match = KML_TAG_REGEXES[tag].exec(xml);
  return match ? match[1].trim() : null;
}

export async function fetchIdigerRadarKmz(): Promise<{
  meta: IdigerRadarOverlay;
  pngBuffer: Buffer;
} | null> {
  if (idigerRadarCache && Date.now() < idigerRadarCache.expiresAt) {
    return idigerRadarCache.data;
  }

  try {
    const resp = await fetchWithTimeout(IDIGER_RADAR_KMZ_URL, 6500);
    if (!resp.ok) return idigerRadarCache?.data ?? null;
    const contentLength = Number(resp.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_KMZ_BYTES) {
      return idigerRadarCache?.data ?? null;
    }
    const arrayBuf = await resp.arrayBuffer();
    if (arrayBuf.byteLength > MAX_KMZ_BYTES) {
      return idigerRadarCache?.data ?? null;
    }
    const entries = extractZipEntries(Buffer.from(arrayBuf));

    const kmlEntry = Array.from(entries.entries()).find(([name]) =>
      name.toLowerCase().endsWith('.kml')
    );
    if (!kmlEntry) return idigerRadarCache?.data ?? null;

    const kmlText = kmlEntry[1].toString('utf8');
    const href = extractXmlTag(kmlText, 'href');
    const north = Number(extractXmlTag(kmlText, 'north'));
    const south = Number(extractXmlTag(kmlText, 'south'));
    const east = Number(extractXmlTag(kmlText, 'east'));
    const west = Number(extractXmlTag(kmlText, 'west'));
    const folderName = extractXmlTag(kmlText, 'name') ?? 'Radar Meteorológico IDIGER Bogotá';

    if (
      !Number.isFinite(north) ||
      !Number.isFinite(south) ||
      !Number.isFinite(east) ||
      !Number.isFinite(west)
    ) {
      return idigerRadarCache?.data ?? null;
    }

    const pngEntry =
      (href && entries.get(href)) ||
      Array.from(entries.entries()).find(([name]) => name.toLowerCase().endsWith('.png'))?.[1];
    if (!pngEntry || pngEntry.length < 8) return idigerRadarCache?.data ?? null;

    // Validate PNG magic header (89 50 4E 47)
    if (
      pngEntry[0] !== 0x89 ||
      pngEntry[1] !== 0x50 ||
      pngEntry[2] !== 0x4e ||
      pngEntry[3] !== 0x47
    ) {
      return idigerRadarCache?.data ?? null;
    }

    // Parse timestamp from folder name e.g. "1399BOG-Intensity (Horizontal)-Thu Nov 26 23:17:14 2026 GMT"
    const dateMatch = folderName.match(/[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}\s+GMT/);
    const observedAt = dateMatch && !Number.isNaN(Date.parse(dateMatch[0]))
      ? new Date(Date.parse(dateMatch[0])).toISOString()
      : new Date().toISOString();

    const stamp = Date.parse(observedAt) || Date.now();
    const result = {
      meta: {
        available: true,
        name: folderName,
        observedAt,
        imageUrl: `/api/v1/radar/idiger/image?v=${stamp}`,
        bounds: { north, south, east, west },
        source: 'Radar Meteorológico IDIGER Bogotá (SAB)',
      },
      pngBuffer: pngEntry,
    };

    idigerRadarCache = { data: result, expiresAt: Date.now() + 60_000 };
    return result;
  } catch {
    return idigerRadarCache?.data ?? null;
  }
}

export async function fetchBogotaLocalitiesGeoJson(): Promise<unknown | null> {
  if (localitiesGeoJsonCache && Date.now() < localitiesGeoJsonCache.expiresAt) {
    return localitiesGeoJsonCache.data;
  }

  try {
    const resp = await fetchWithTimeout(BOGOTA_LOCALITIES_GEOJSON_URL, 7000);
    if (!resp.ok) return localitiesGeoJsonCache?.data ?? null;
    const geojson = (await resp.json()) as { type?: string; features?: unknown[] };
    if (geojson?.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
      localitiesGeoJsonCache = {
        data: geojson,
        expiresAt: Date.now() + 12 * 3600_000,
      };
      return geojson;
    }
  } catch {
    // Return cached fallback if available
  }
  return localitiesGeoJsonCache?.data ?? null;
}
