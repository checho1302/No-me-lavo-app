import L from 'leaflet';
import type { WeatherStation } from '../types/weather';
import { classifySabDailyAccumulation, escapeHtml } from './weatherLogic';

export function createStationLeafletIcon(station: WeatherStation): L.DivIcon {
  const r = station.latestReading;
  const isIdiger = station.source === 'IDIGER';
  const sab = classifySabDailyAccumulation(r.accDayMm ?? r.acc24hMm);
  const isRaining = Boolean(r.isRainingNow);

  if (isIdiger) {
    // Iconic SAB IDIGER triangle marker (△) colored by daily accumulation since 0:00
    const pulseRing = isRaining
      ? `<circle cx="12" cy="14" r="10" fill="none" stroke="${sab.color}" stroke-width="2" opacity="0.8"><animate attributeName="r" from="7" to="11.5" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.9" to="0" dur="1.4s" repeatCount="indefinite"/></circle>`
      : '';
    const html = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style="display:block;filter:drop-shadow(0 1px 1.5px rgba(15,23,42,0.45));">
      ${pulseRing}
      <polygon points="12,3 21.5,19.5 2.5,19.5" fill="${sab.color}" stroke="${sab.stroke}" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`;
    return L.divIcon({
      className: 'pluvia-sab-triangle-icon',
      html,
      iconSize: [22, 22],
      iconAnchor: [11, 14],
      tooltipAnchor: [0, -10],
    });
  }

  // Regional stations (IDEAM, Aerocivil, SIATA) as clean bordered circles
  const fill =
    station.status === 'maintenance' || r.rainfallMmH === null
      ? '#64748B'
      : sab.tier === 'none'
        ? '#059669'
        : sab.color;
  const html = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style="display:block;filter:drop-shadow(0 1px 1.5px rgba(15,23,42,0.4));">
    <circle cx="9" cy="9" r="6.5" fill="${fill}" stroke="#FFFFFF" stroke-width="2"/>
  </svg>`;
  return L.divIcon({
    className: 'pluvia-station-circle-icon',
    html,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    tooltipAnchor: [0, -8],
  });
}

export function buildStationTooltipHtml(station: WeatherStation): string {
  const r = station.latestReading;
  const name = escapeHtml(station.name);
  const loc = escapeHtml(station.locality);
  const src = escapeHtml(station.source);
  const accVal =
    station.status === 'maintenance' || (r.accDayMm === null && r.acc24hMm === null)
      ? 'Sin lectura'
      : `${(r.accDayMm ?? r.acc24hMm ?? 0).toFixed(1)} mm hoy`;
  const activeTag = r.isRainingNow ? ' · Lloviendo ahora' : '';
  return `<div style="font-size:12px;line-height:1.35;"><strong>${name}</strong><br/><span style="color:#475569;">${src} · ${loc}</span><br/><strong style="color:#0369A1;">${accVal}${activeTag}</strong></div>`;
}
