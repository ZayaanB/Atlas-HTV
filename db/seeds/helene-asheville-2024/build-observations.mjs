// Person 4 seed tooling: converts saved USGS responses into observations.csv. Offline and deterministic:
// it never fetches. Download the five files listed in SOURCES.md (exact URLs) into one directory, then run
//   node db/seeds/helene-asheville-2024/build-observations.mjs <raw-dir> > db/seeds/helene-asheville-2024/observations.csv
// and compare with the committed CSV (and the sha256 values recorded in SOURCES.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('Usage: build-observations.mjs <raw-dir>');

// Retrieval instants of the committed files (UTC), recorded when they were downloaded.
const fetchedAt = {
  'iv_03451500_00060.json': '2026-10-17T11:46:34Z',
  'iv_03451500_00065.json': '2026-10-17T11:46:34Z',
  'iv_03451000_00060.json': '2026-10-17T11:46:35Z',
  'iv_03451000_00065.json': '2026-10-17T11:46:35Z',
  'peak_03451500.rdb': '2026-10-17T11:46:36Z'
};
const instantaneous = {
  'iv_03451500_00060.json': 'usgs-03451500-discharge',
  'iv_03451500_00065.json': 'usgs-03451500-gage-height',
  'iv_03451000_00060.json': 'usgs-03451000-discharge',
  'iv_03451000_00065.json': 'usgs-03451000-gage-height'
};

const iso = ms => new Date(ms).toISOString();
const rows = [];

for (const [file, seriesId] of Object.entries(instantaneous)) {
  const series = JSON.parse(readFileSync(join(dir, file), 'utf8')).value.timeSeries;
  if (series.length !== 1) throw new Error(`${file}: expected exactly one time series`);
  const noData = Number(series[0].variable.noDataValue);
  for (const point of series[0].values[0].value) {
    // USGS timestamps carry an explicit offset (e.g. -04:00); store the instant in UTC.
    const ms = Date.parse(point.dateTime);
    if (!Number.isFinite(ms) || !/[+-]\d{2}:\d{2}$/.test(point.dateTime)) throw new Error(`${file}: bad time ${point.dateTime}`);
    const value = Number(point.value);
    rows.push([seriesId, 'instantaneous', iso(ms), value === noData || !Number.isFinite(value) ? '' : String(value),
      `{${point.qualifiers.join(',')}}`, 'instant', '', '', fetchedAt[file]]);
  }
}

// Annual peak file (RDB). peak_dt/peak_tm are local standard time (EST, UTC-05:00): the 2024 entry
// (16:38) matches the approved instantaneous crest at 17:38 EDT = 21:38 UTC. Rows without a discharge value
// (pre-1895 historic stage notes) are not part of the discharge series.
const lines = readFileSync(join(dir, 'peak_03451500.rdb'), 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
const header = lines[0].split('\t');
const col = name => header.indexOf(name);
for (const line of lines.slice(2)) {
  const f = line.split('\t');
  const [date, time, value, codes] = [f[col('peak_dt')], f[col('peak_tm')], f[col('peak_va')], f[col('peak_cd')]];
  if (!value) continue;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || m[2] === '00' || m[3] === '00') throw new Error(`peak: inexact date ${date}`);
  const year = Number(m[1]), month = Number(m[2]);
  const observed = Date.parse(`${date}T${time || '00:00'}:00-05:00`);
  // USGS water year N runs from October 1 of N-1 through September 30 of N.
  const wyStart = month >= 10 ? year : year - 1;
  rows.push(['usgs-03451500-annual-peak-discharge', 'annual_peak', iso(observed), String(Number(value)),
    `{${(codes || '').split(',').map(c => c.trim()).filter(Boolean).join(',')}}`, time ? 'minute' : 'day',
    iso(Date.parse(`${wyStart}-10-01T00:00:00-05:00`)), iso(Date.parse(`${wyStart + 1}-10-01T00:00:00-05:00`)),
    fetchedAt['peak_03451500.rdb']]);
}

rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
const csv = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
process.stdout.write('series_id,statistic,observed_at,value,qualifiers,time_precision,period_start,period_end,fetched_at\n');
for (const row of rows) process.stdout.write(row.map(csv).join(',') + '\n');
