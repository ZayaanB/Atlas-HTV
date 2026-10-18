import { useId, useMemo, useState } from 'react';
import type { AircraftState } from '@atlas/contracts';

export function aircraftSearchIndex(aircraft: readonly AircraftState[]) {
  return aircraft.map(item => ({ item, text: [item.callsign, item.flight_iata, item.registration, item.id].filter(Boolean).join(' ').toLowerCase() }));
}
export function findAircraftMatches(index: ReturnType<typeof aircraftSearchIndex>, query: string) {
  const term = query.trim().toLowerCase(), matches: AircraftState[] = [];
  if (term.length < 2) return { matches, more: false };
  for (const { item, text } of index) {
    if (!text.includes(term)) continue;
    if (matches.length === 50) return { matches, more: true };
    matches.push(item);
  }
  return { matches, more: false };
}
/** All search stays on the current browser snapshot; no provider lookup. */
export function AircraftSearch({ aircraft, onSelect }: { aircraft: readonly AircraftState[]; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const hint = useId(), resultsId = useId();
  const index = useMemo(() => aircraftSearchIndex(aircraft), [aircraft]);
  const { matches, more } = useMemo(() => findAircraftMatches(index, query), [index, query]);
  return <div className="aircraft-search">
    <label>Find aircraft
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} maxLength={64}
        aria-describedby={hint} aria-controls={resultsId} autoComplete="off" placeholder="Callsign, flight, registration or hex ID" />
    </label>
    <p className="muted" id={hint}>Search this snapshot · enter at least two characters.</p>
    <p className="muted" role="status">{query.trim().length < 2 ? '' : more ? 'Showing 50 matches. Refine your search for more.'
      : matches.length ? `${matches.length} matching aircraft` : 'No matches in the displayed snapshot. Coverage is incomplete.'}</p>
    <ul id={resultsId} className="aircraft-matches" aria-label="Aircraft matches">
      {matches.map(item => <li key={item.id}><button onClick={() => onSelect(item.id)}>
        <strong>{item.callsign || item.flight_iata || item.registration || item.id}</strong>
        <span>{[item.flight_iata, item.registration, item.id].filter(Boolean).join(' · ')}</span>
      </button></li>)}
    </ul>
  </div>;
}
