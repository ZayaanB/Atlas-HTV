import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NewsQuery, WorkspaceResponse } from "@atlas/contracts";
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
  const [keyword, setKeyword] = useState(filters.keyword ?? ""),
    [place, setPlace] = useState(""),
    [term, setTerm] = useState(""),
    [draft, setDraft] = useState(filters),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(filters);
    setKeyword(filters.keyword ?? "");
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
        <label htmlFor="keyword">Search reporting</label>
        <div className="search-input">
          <Icon name="search" />
          <input
            autoComplete="off"
            id="keyword"
            value={keyword}
            maxLength={1000}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="An issue, name, or story"
          />
          <button aria-label="Search" type="submit" className="icon-button">
            <Icon name="arrow" />
          </button>
        </div>
        <label htmlFor="place">Find a known place</label>
        <input
          id="place"
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
        <details className="filter-details">
          <summary>
            <Icon name="filter" /> Refine reporting
          </summary>
          {(["themes", "entity_ids"] as const).map((key) => (
            <fieldset key={key}>
              <legend>{key === "themes" ? "Topics" : "Known entities"}</legend>
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
              From
              <input
                type="date"
                value={draft.published_from?.slice(0, 10) ?? ""}
                onChange={(e) =>
                  setDraft((previous) => {
                    const next = { ...previous };
                    if (e.target.value)
                      next.published_from = e.target.value + "T00:00:00.000Z";
                    else delete next.published_from;
                    return next;
                  })
                }
              />
            </label>
            <label>
              Through
              <input
                type="date"
                value={draft.published_to?.slice(0, 10) ?? ""}
                onChange={(e) =>
                  setDraft((previous) => {
                    const next = { ...previous };
                    if (e.target.value)
                      next.published_to = e.target.value + "T23:59:59.999Z";
                    else delete next.published_to;
                    return next;
                  })
                }
              />
            </label>
            <p className="muted">
              Up to 366 days. Date-only and unknown publication times are
              excluded by this filter.
            </p>
          </fieldset>
          <button type="submit" className="primary">
            Apply filters
          </button>
        </details>
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
