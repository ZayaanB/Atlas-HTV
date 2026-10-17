import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NewsQuery } from '@atlas/contracts';
import type { AtlasApi } from '../../lib/api';
import { placeSearchOptions } from '../../lib/queries';

export function FilterBar({ api, filters, onApply }: {
  api: AtlasApi; filters: NewsQuery; onApply: (filters: NewsQuery) => void;
}) {
  const [keyword, setKeyword] = useState(filters.keyword ?? '');
  const [place, setPlace] = useState('');
  const [debouncedPlace, setDebouncedPlace] = useState('');
  useEffect(() => setKeyword(filters.keyword ?? ''), [filters.keyword]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPlace(place.trim()), 250);
    return () => clearTimeout(timer);
  }, [place]);
  const results = useQuery(placeSearchOptions(api, debouncedPlace));
  const chips = Object.entries(filters).filter(([key]) => key !== 'limit' && key !== 'offset');
  return <section className="filters" aria-label="News filters">
    <form onSubmit={event => { event.preventDefault(); onApply({ ...filters, keyword }); }}>
      <label htmlFor="keyword">Search reporting</label>
      <div className="input-row"><input id="keyword" value={keyword} maxLength={1000} onChange={event => setKeyword(event.target.value)} placeholder="Issue, name, or keyword" />
      <button type="submit">Search</button></div>
    </form>
    <label htmlFor="place">Find a known place</label>
    <input id="place" value={place} maxLength={300} onChange={event => setPlace(event.target.value)} placeholder="City, region, or facility" />
    {debouncedPlace && results.isFetching && <p role="status">Finding places…</p>}
    {debouncedPlace && results.isError && <p role="alert">Place search failed. Change the search or try again.</p>}
    {debouncedPlace && results.isSuccess && results.data.items.length === 0 && <p>No known places match.</p>}
    {debouncedPlace && results.data && <ul className="place-results">{results.data.items.map(location => <li key={location.id}>
      <button onClick={() => { onApply({ ...filters, location_ids: [location.id] }); setPlace(''); setDebouncedPlace(''); }}>{location.name} · {location.precision}</button>
    </li>)}</ul>}
    {chips.length > 0 && <div className="chips" aria-label="Applied filters">{chips.map(([key, value]) => <button key={key} onClick={() => {
      const next = { ...filters }; delete next[key as keyof NewsQuery]; onApply(next);
    }} aria-label={`Remove ${key} filter`}>{key.replaceAll('_', ' ')}: {Array.isArray(value) ? value.join(', ') : String(value)} ×</button>)}
      <button onClick={() => { onApply({ limit: filters.limit ?? 50 }); setPlace(''); }}>Clear filters</button>
    </div>}
  </section>;
}
