import { type Data, object, string } from '../../services/validation.js';
// GDACS RSS extensions (https://www.gdacs.org/xml/rss.xml, observed 2026-10-17). The XML parser strips namespace
// prefixes, so gdacs:fromdate is `fromdate`, geo:Point is `Point` and gdacs:bbox is `bbox`. Only values GDACS itself
// publishes for an item are used: its event point, its alert bounding box and its event start time. Nothing is geocoded.
const EVENT_TYPES: Record<string,string> = {
  EQ:'earthquake', TC:'tropical cyclone', FL:'flood', VO:'volcano', DR:'drought', WF:'wildfire', TS:'tsunami'
};
export interface GdacsLocation {
  id: string; name: string; precision: 'region'; longitude: number; latitude: number; coordinates_basis: string;
  bounds_west: number; bounds_south: number; bounds_east: number; bounds_north: number; bounds_basis: string;
}
export function rssTime(value: unknown): string | null {
  const text = string(value).trim();
  const milliseconds = text && /(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i.test(text) ? Date.parse(text) : NaN;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}
function coordinate(value: unknown, limit: number): number | null {
  const text = string(value).trim();
  if (!/^-?\d{1,3}(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Math.abs(number) <= limit ? number : null;
}
function label(value: unknown, max: number): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) value = object(value)['#text'];
  return string(value).replace(/\s+/g,' ').trim().slice(0,max);
}
const ALERT_LEVELS = ['Green','Orange','Red'] as const;
// Reviewed curation: `min_alert_level` maps an event type to the lowest alert level imported for it, e.g. {WF:'Orange'}
// because Green wildfire notices outnumber every other event type ~6:1. Unlisted types import at every level.
export function gdacsSelected(item: Data, minimum: Data): boolean {
  const required = minimum[string(item.eventtype).trim()];
  if (required === undefined) return true;
  return ALERT_LEVELS.indexOf(string(item.alertlevel).trim() as typeof ALERT_LEVELS[number]) >= ALERT_LEVELS.indexOf(required as typeof ALERT_LEVELS[number]);
}
export function validMinimumAlerts(value: unknown): boolean {
  return value === undefined || (!!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([type,level]) => /^[A-Z]{2}$/.test(type) && ALERT_LEVELS.includes(level as typeof ALERT_LEVELS[number])));
}
export function gdacsEvent(item: Data): {event_at: string | null; location: GdacsLocation | null} {
  const type = string(item.eventtype).trim(), eventId = string(item.eventid).trim();
  // Only earthquakes carry an origin time to the second. Other types publish day-level dates (00:00 or 01:00), so an
  // instant would be false precision; their dates remain in the provider description.
  const event_at = type === 'EQ' ? rssTime(item.fromdate) : null;
  if (!/^[A-Z]{2}$/.test(type) || !/^\d{1,12}$/.test(eventId)) return {event_at,location:null};
  const point = item.Point && typeof item.Point === 'object' && !Array.isArray(item.Point) ? object(item.Point) : {};
  const latitude = coordinate(point.lat,90), longitude = coordinate(point.long,180);
  // gdacs:bbox is "lonmin lonmax latmin latmax". Atlas bounds never cross the antimeridian, so a wrapped or
  // degenerate box is not stored, and without bounds a region-precision location is not created at all.
  const box = string(item.bbox).trim().split(/\s+/).map(part => coordinate(part,180));
  if (latitude === null || longitude === null || box.length !== 4 || box.some(v => v === null)) return {event_at,location:null};
  const [west,east,south,north] = box as [number,number,number,number];
  if (!(west < east && south < north) || south < -90 || north > 90 || longitude < west || longitude > east || latitude < south || latitude > north)
    return {event_at,location:null};
  const kind = EVENT_TYPES[type] ?? `event type ${type}`;
  const place = label(item.country,200) || 'No country given by GDACS';
  return {event_at,location:{
    id:`loc-gdacs-${type.toLowerCase()}-${eventId}`, name:`${place} · GDACS ${kind} ${eventId}`.slice(0,300), precision:'region',
    longitude, latitude,
    coordinates_basis:`GDACS event point for ${type} ${eventId} as published in its RSS item (provider-asserted, not reviewed by Atlas)`,
    bounds_west:west, bounds_south:south, bounds_east:east, bounds_north:north,
    bounds_basis:'GDACS alert bounding box from its RSS item: a display extent around the event point, not an affected-area footprint'
  }};
}
