import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NewsQuery, WorkspaceResponse } from "@atlas/contracts";
import { newsCategories } from "@atlas/contracts";
import type { AtlasApi } from "../../lib/api";
import { normalizeNewsQuery } from "../../lib/api";
import { placeSearchOptions } from "../../lib/queries";
import { Icon } from "../../components/Icon";
import { words } from "../../lib/presentation";
export function FilterBar({
  api,
  filters,
  onApply,
  catalog,
  onAsk,
}: {
  api: AtlasApi;
  filters: NewsQuery;
  onApply: (filters: NewsQuery) => void;
  catalog?: WorkspaceResponse | undefined;
  onAsk?: () => void;
}) {
  const id = useId();
  const keywordId = `${id}-keyword`, placeId = `${id}-place`;
  const [keyword, setKeyword] = useState(filters.keyword ?? ""),
    [place, setPlace] = useState(""),
    [term, setTerm] = useState(""),
    [draft, setDraft] = useState(filters),
    [quickPeriod, setQuickPeriod] = useState('all'),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(filters);
    setKeyword(filters.keyword ?? "");
    setQuickPeriod(filters.published_from || filters.published_to ? 'custom' : 'all');
  }, [filters]);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(place.trim()), 250);
    return () => clearTimeout(timer);
  }, [place]);
  const results = useQuery(placeSearchOptions(api, term));
  const options = (key: "themes" | "entity_ids") =>
    key === "themes" ? catalog?.themes : catalog?.entities;
  function apply(next: NewsQuery) {
    try {
      onApply(normalizeNewsQuery(next));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the filters.");
    }
  }
  function period(value: string) {
    setQuickPeriod(value);
    if (value === 'custom') return;
    setDraft(previous => {
      const next = {...previous};
      delete next.published_from;
      delete next.published_to;
      if (value !== 'all') {
        const now = new Date();
        const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        from.setUTCDate(from.getUTCDate() - (Number(value) - 1));
        next.published_from = from.toISOString();
        next.published_to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).toISOString();
      }
      return next;
    });
  }
  function date(field: 'published_from' | 'published_to', value: string) {
    setQuickPeriod('custom');
    setDraft(previous => {
      const next = {...previous};
      if (value) next[field] = value + (field === 'published_from' ? 'T00:00:00.000Z' : 'T23:59:59.999Z');
      else delete next[field];
      return next;
    });
  }
  return (
    <section aria-label="News filters">
      {onAsk && (
        <div className="segmented">
          <button aria-label="Search mode" aria-pressed="true">
            Search
          </button>
          <button onClick={onAsk}>Ask Atlas</button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply({ ...draft, keyword });
        }}
      >
        <label htmlFor={keywordId}>Search reporting</label>
        <div className="search-input">
          <Icon name="search" />
          <input
            autoComplete="off"
            id={keywordId}
            value={keyword}
            maxLength={1000}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="An issue, name, or story"
          />
          <button aria-label="Search" type="submit" className="icon-button">
            <Icon name="arrow" />
          </button>
        </div>
        <label htmlFor={placeId}>Find a known place</label>
        <input
          id={placeId}
          value={place}
          maxLength={300}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="City, region, or facility"
          autoComplete="off"
        />
        {term && results.isFetching && (
          <p role="status" className="muted">
            Finding places…
          </p>
        )}
        {term && results.isError && (
          <p role="alert">
            Place search failed. Change the search or try again.
          </p>
        )}
        {term && results.isSuccess && !results.data.items.length && (
          <p className="muted">No known places match.</p>
        )}
        {term && results.data && (
          <ul className="plain-list place-results">
            {results.data.items.map((location) => (
              <li key={location.id}>
                <button
                  type="button"
                  onClick={() => {
                    apply({ ...draft, keyword, location_ids: [location.id] });
                    setPlace("");
                    setTerm("");
                  }}
                >
                  {location.name}
                  <span className="muted">{location.precision}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="news-category-filters">
          {(['event_types','topics'] as const).map(field => (
            <fieldset key={field}>
              <legend>{field === 'event_types' ? 'Event types' : 'Broad topics'}</legend>
              <div className="category-options">
                {newsCategories.filter(rule => rule.field === field).map(rule => (
                  <label className="category-option" key={rule.id}>
                    <input type="checkbox" checked={draft[field]?.some(id => id === rule.id) ?? false}
                      onChange={e => setDraft({...draft,[field]:e.target.checked ? [...(draft[field] ?? []),rule.id] : (draft[field] ?? []).filter(id => id !== rule.id)})} />
                    {rule.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="muted">Matches existing tags or English headline/excerpt terms. Categories may overlap and miss stories; they are not reviewed classifications. Choose any within a group; groups combine.</p>
        </div>
        <details className="filter-details">
          <summary>
            <Icon name="filter" /> Refine reporting
          </summary>
          {(["themes", "entity_ids"] as const).map((key) => (
            <fieldset key={key}>
              <legend>{key === "themes" ? "Stored topic tags" : "Known entities"}</legend>
              {options(key)?.length ? (
                options(key)!.map((option) => (
                  <label className="checkbox-row" key={option.id}>
                    <input
                      type="checkbox"
                      checked={draft[key]?.includes(option.id) ?? false}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [key]: e.target.checked
                            ? [...(draft[key] ?? []), option.id]
                            : (draft[key] ?? []).filter(
                                (id) => id !== option.id,
                              ),
                        })
                      }
                    />
                    {option.label}
                  </label>
                ))
              ) : (
                <p className="muted">
                  {key === "themes" ? "Topic" : "Entity"} options are
                  unavailable until workspace discovery is connected.
                </p>
              )}
            </fieldset>
          ))}
          <fieldset>
            <legend>Publication period · UTC</legend>
            <label>
              Quick period
              <select value={quickPeriod} onChange={e => period(e.target.value)}>
                <option value="all">All publication dates</option>
                <option value="1">Today (UTC)</option>
                <option value="7">Last 7 days (UTC)</option>
                <option value="30">Last 30 days (UTC)</option>
                <option value="custom">Custom dates</option>
              </select>
            </label>
            <label>
              From
              <input
                type="date"
                value={draft.published_from?.slice(0, 10) ?? ""}
                onChange={(e) => date('published_from', e.target.value)}
              />
            </label>
            <label>
              Through
              <input
                type="date"
                value={draft.published_to?.slice(0, 10) ?? ""}
                onChange={(e) => date('published_to', e.target.value)}
              />
            </label>
            <p className="muted">
              Up to 366 days. Date-only and unknown publication times are
              excluded by this filter.
            </p>
          </fieldset>
          <label>
            Review status
            <select value={draft.verification_status ?? 'all'} onChange={e => {
              const next = {...draft};
              if (e.target.value === 'all') delete next.verification_status;
              else next.verification_status = e.target.value as 'reviewed' | 'unreviewed';
              setDraft(next);
            }}>
              <option value="all">All review statuses</option>
              <option value="reviewed">Reviewed records</option>
              <option value="unreviewed">Unreviewed provider records</option>
            </select>
          </label>
          <label>
            Location availability
            <select value={draft.has_location === undefined ? 'all' : String(draft.has_location)} onChange={e => {
              const next = {...draft};
              if (e.target.value === 'all') delete next.has_location;
              else next.has_location = e.target.value === 'true';
              setDraft(next);
            }}>
              <option value="all">With or without a location</option>
              <option value="true">Has a linked location</option>
              <option value="false">No linked location</option>
            </select>
          </label>
          <label>
            Stories per page
            <select value={draft.limit ?? 50} onChange={e => setDraft({...draft,limit:Number(e.target.value)})}>
              {![20,50,100].includes(draft.limit ?? 50) && <option value={draft.limit}>{draft.limit}</option>}
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </details>
        <button type="submit" className="primary filter-apply">Apply filters</button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="chips">
        {Object.entries(filters)
          .filter(([key]) => !["limit", "offset"].includes(key))
          .map(([key, value]) => (
            <button
              key={key}
              aria-label={`Remove ${key} filter`}
              onClick={() => {
                const next = { ...filters };
                delete next[key as keyof NewsQuery];
                apply(next);
              }}
            >
              {words(key)}:{" "}
              {Array.isArray(value)
                ? value
                    .map(
                      (v) =>
                        [
                          ...(catalog?.themes ?? []),
                          ...(catalog?.entities ?? []),
                          ...newsCategories,
                        ].find((x) => x.id === v)?.label ?? words(String(v)),
                    )
                    .join(", ")
                : String(value)}{" "}
              <Icon name="close" size={12} />
            </button>
          ))}
      </div>
      {Object.keys(filters).some(
        (key) => !["limit", "offset"].includes(key),
      ) && (
        <button
          className="text-button"
          onClick={() => apply({ limit: filters.limit ?? 50 })}
        >
          Clear filters
        </button>
      )}
      <p className="muted search-note">
        Search the available source collection. Place results are known records,
        not a global directory.
      </p>
    </section>
  );
}
