import { AppError } from '../../runtime/errors.js';
import { range } from '../validation.js';

// Calendar arithmetic is local to the requested IANA zone, never the host zone.
// Resolve a local midnight by finding the first instant of that calendar date.
// This also handles midnight DST gaps; a completely skipped date is rejected.
function calendar(time: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(time);
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)!.value).join('-');
}
function date(value: string): number {
  const time = Date.parse(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value)
    throw new AppError('INVALID_TIME', 'Use a valid YYYY-MM-DD calendar date');
  return time;
}
function shift(value: string, days: number): string {
  return new Date(date(value) + days * 86400000).toISOString().slice(0, 10);
}
function month(value: string, offset: number): string {
  const d = new Date(date(value));
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
}
function midnight(value: string, zone: string): number {
  const center = date(value);
  let lo = center - 36 * 3600000, hi = center + 36 * 3600000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (calendar(mid, zone) < value) lo = mid + 1;
    else hi = mid;
  }
  if (calendar(lo, zone) !== value) throw new AppError('INVALID_TIME', 'This calendar date does not exist in the requested timezone');
  return lo;
}

export function resolveDateRange(expression: string, timezone: string, now = Date.now()) {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
  catch { throw new AppError('INVALID_TIMEZONE', 'Use a valid IANA timezone'); }
  if (!Number.isFinite(now)) throw new AppError('INVALID_TIME', 'Invalid reference time');
  const value = expression.trim().toLowerCase(), today = calendar(now, timezone);
  let start: string, end: string;
  if (value === 'today') { start = today; end = shift(today, 1); }
  else if (value === 'yesterday') { start = shift(today, -1); end = today; }
  else if (value === 'this month') { start = month(today, 0); end = month(today, 1); }
  else if (value === 'last month') { start = month(today, -1); end = month(today, 0); }
  else if (value === 'this week' || value === 'last week') {
    const monday = shift(today, -((new Date(date(today)).getUTCDay() + 6) % 7));
    start = shift(monday, value === 'last week' ? -7 : 0); end = shift(start, 7);
  } else if (/^past \d{1,3} days$/.test(value)) {
    const days = Number(value.split(' ')[1]);
    if (days < 1 || days > 366) throw new AppError('INVALID_RANGE', 'Use 1–366 calendar days');
    start = shift(today, 1 - days); end = shift(today, 1);
  } else {
    const explicit = /^(\d{4}-\d{2}-\d{2})(?:\s+(?:to|through)\s+(\d{4}-\d{2}-\d{2}))?$/.exec(value);
    if (!explicit) throw new AppError('UNSUPPORTED_PERIOD', 'Specify calendar dates or a supported relative period');
    start = explicit[1]!; date(start); end = shift(explicit[2] ?? start, 1);
  }
  const from = new Date(midnight(start, timezone)).toISOString();
  const to = new Date(midnight(end, timezone) - 1).toISOString();
  // Calendar periods can exceed 366*24 hours across an offset change. The
  // existing API's duration limit remains authoritative in that rare case.
  range({ from, to }, 'from', 'to');
  return { from, to, timezone, label: `${start} through ${shift(end, -1)} (${timezone})` };
}
