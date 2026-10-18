import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  Coverage,
  InvestigationResponse,
  Observation,
} from "@atlas/contracts";
import type { AtlasApi } from "../../lib/api";
import { dateTime, words } from "../../lib/presentation";
import { readContract } from "../../lib/validation";
import { ResearchCoverage } from "./ResearchCoverage";
export function Timeline({
  api,
  data,
}: {
  api: AtlasApi;
  data: InvestigationResponse;
}) {
  const [seriesId, setSeries] = useState(data.observation_series[0]?.id ?? "");
  const series = data.observation_series.find((s) => s.id === seriesId),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [range, setRange] = useState({ from: "", to: "" }),
    [error, setError] = useState(""),
    [index, setIndex] = useState(0),
    [tableLimit, setTableLimit] = useState(100);
  const end = range.to
    ? range.to + "T23:59:59.999Z"
    : (series?.coverage_to ?? undefined);
  const start = range.from
    ? range.from + "T00:00:00.000Z"
    : series?.coverage_from && end
      ? new Date(
          Math.max(
            Date.parse(series.coverage_from),
            Date.parse(end) - 365 * 86400000,
          ),
        ).toISOString()
      : undefined;
  // The frozen projection guarantees one series per location + metric. Validate
  // identity and provenance before plotting, even with an injected API adapter.
  function validateRows(items: Observation[]) {
    if (
      items.some(
        (o) =>
          o.series_id !== seriesId ||
          o.location_id !== series!.location_id ||
          o.metric !== series!.metric ||
          o.unit !== series!.unit ||
          o.source_id !== series!.source_id ||
          (start && Date.parse(o.observed_at) < Date.parse(start)) ||
          (end && Date.parse(o.observed_at) > Date.parse(end)),
      )
    )
      throw new Error(
        "The response contains observations outside the requested series, source, units, or period.",
      );
  }
  const query = useQuery({
    queryKey: [api.mode, "observations", seriesId, start, end],
    enabled: !!series && !!api.observations,
    retry: false,
    queryFn: async ({ signal }) => {
      const rows: Observation[] = [],
        ids = new Set<string>();
      let coverage: Coverage | undefined;
      for (let offset = 0; offset < 10000; offset += 100) {
        const page = readContract(
          "ObservationsResponse",
          await api.observations!(
            {
              location_id: series!.location_id,
              metric: series!.metric,
              // A curated archive and a live series can share location + metric; select exactly this one.
              series_id: series!.id,
              ...(start ? { observed_from: start } : {}),
              ...(end ? { observed_to: end } : {}),
              limit: 100,
              offset,
            },
            signal,
          ),
        );
        signal.throwIfAborted();
        validateRows(page.items);
        for (const row of page.items) {
          if (
            ids.has(row.id) ||
            (rows.length &&
              Date.parse(row.observed_at) <=
                Date.parse(rows.at(-1)!.observed_at))
          )
            throw new Error(
              "The response repeats or misorders observations. Narrow the period and retry.",
            );
          ids.add(row.id);
          rows.push(row);
        }
        coverage = page.coverage;
        if (page.items.length < 100) return { rows, capped: false, coverage };
      }
      return { rows, capped: true, coverage };
    },
  });
  const comparison = useQuery({
    queryKey: [api.mode, "observation-comparison", seriesId, start, end],
    enabled: !!series && !!api.compare,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = readContract(
        "ObservationsResponse",
        await api.compare!(
          {
            location_id: series!.location_id,
            metric: series!.metric,
            series_id: series!.id,
            ...(start ? { observed_from: start } : {}),
            ...(end ? { observed_to: end } : {}),
            limit: 100,
          },
          signal,
        ),
      );
      signal.throwIfAborted();
      validateRows(response.items);
      const delta = response.comparison;
      if (
        delta &&
        (delta.unit !== series!.unit ||
          ![delta.first_id, delta.last_id].every((id) =>
            response.items.some((row) => row.id === id && row.value !== null),
          ))
      )
        throw new Error(
          "The comparison endpoints or units do not match the returned observations.",
        );
      return response;
    },
  });
  const rows =
    query.data?.rows ??
    data.observations
      .filter(
        (o) =>
          o.series_id === seriesId &&
          (!start || Date.parse(o.observed_at) >= Date.parse(start)) &&
          (!end || Date.parse(o.observed_at) <= Date.parse(end)),
      )
      .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const selected = rows[Math.min(index, Math.max(0, rows.length - 1))];
  const chart = useMemo(() => {
    const values = rows.filter((o) => o.value !== null);
    if (!values.length) return null;
    const min = Math.min(...values.map((o) => o.value!)),
      max = Math.max(...values.map((o) => o.value!)),
      t0 = Date.parse(rows[0]!.observed_at),
      t1 = Date.parse(rows.at(-1)!.observed_at);
    let path = "",
      prev: Observation | undefined;
    for (const row of rows) {
      if (row.value === null) {
        prev = undefined;
        continue;
      }
      const x =
          12 + ((Date.parse(row.observed_at) - t0) / (t1 - t0 || 1)) * 296,
        y = 140 - ((row.value - min) / (max - min || 1)) * 120;
      const gap =
        prev &&
        series?.expected_interval_seconds &&
        Date.parse(row.observed_at) - Date.parse(prev.observed_at) >
          series.expected_interval_seconds * 1500;
      path += (prev && !gap ? "L" : "M") + x.toFixed(2) + "," + y.toFixed(2);
      prev = row;
    }
    const points =
      rows.length <= 100
        ? values.map((row) => ({
            id: row.id,
            x: 12 + ((Date.parse(row.observed_at) - t0) / (t1 - t0 || 1)) * 296,
            y: 140 - ((row.value! - min) / (max - min || 1)) * 120,
          }))
        : [];
    return { path, min, max, points };
  }, [rows, series]);
  if (!series)
    return (
      <p className="empty-state">
        No observation series is linked to this investigation.
      </p>
    );
  const source = data.sources.find((s) => s.id === series.source_id);
  return (
    <section aria-label="Historical timeline">
      <label htmlFor="series">Observation series</label>
      <select
        id="series"
        value={seriesId}
        onChange={(e) => {
          setSeries(e.target.value);
          setRange({ from: "", to: "" });
          setFrom("");
          setTo("");
          setIndex(0);
        }}
      >
        {data.observation_series.map((s) => (
          <option key={s.id} value={s.id}>
            {words(s.metric)} ·{" "}
            {data.locations.find((l) => l.id === s.location_id)?.name}
            {s.live ? " · current readings" : ""}
          </option>
        ))}
      </select>
      <p>{series.description}</p>
      <p className="meta">
        {series.unit} · raw observations ·{" "}
        {series.live
          ? "refreshed from the provider; recent values are provisional and may be revised"
          : "historical"}
      </p>
      <form
        className="date-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            from &&
            to &&
            (to < from ||
              Date.parse(to + "T23:59:59.999Z") -
                Date.parse(from + "T00:00:00Z") >
                366 * 86400000)
          ) {
            setError("Choose an ordered period of at most 366 days.");
            return;
          }
          if ((from || to) && (!from || !to)) {
            setError("Choose both observation dates.");
            return;
          }
          setError("");
          setRange({ from, to });
          setIndex(0);
        }}
      >
        <label>
          Observed from
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button className="text-button">Update period</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {query.isFetching && (
        <p role="status" className="muted">
          Loading observations…
        </p>
      )}
      {query.isError && (
        <div className="error" role="alert">
          {query.error.message}
          <button onClick={() => void query.refetch()}>
            Retry observations
          </button>
        </div>
      )}
      {!query.data && (
        <p className="notice">
          Showing linked key observations within this period only. The complete
          series is {api.observations ? "not yet available" : "not connected"}.
        </p>
      )}
      {query.data?.coverage && (
        <ResearchCoverage coverage={query.data.coverage} />
      )}
      <p className="meta">
        Series coverage: {dateTime(series.coverage_from)}–
        {dateTime(series.coverage_to)}. Retrieved{" "}
        {dateTime(series.retrieved_at)}.
      </p>
      {chart ? (
        <>
          <div className="chart">
            <div className="chart-scale">
              <span>
                {chart.max.toLocaleString()} {series.unit}
              </span>
              <span>{chart.min.toLocaleString()}</span>
            </div>
            <svg
              viewBox="0 0 320 160"
              role="img"
              aria-label={`${words(series.metric)} in ${series.unit}; gaps are not interpolated`}
            >
              <path
                d={chart.path}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                vectorEffect="non-scaling-stroke"
              />
              {chart.points.map((point) => (
                <circle
                  key={point.id}
                  cx={point.x}
                  cy={point.y}
                  r="2.5"
                  fill="currentColor"
                />
              ))}
            </svg>
            <div className="chart-period">
              <span>{rows[0]?.observed_at.slice(0, 10)}</span>
              <span>{rows.at(-1)?.observed_at.slice(0, 10)}</span>
            </div>
          </div>
          {selected && (
            <>
              <label htmlFor="inspect-observation">Inspect observation</label>
              <input
                id="inspect-observation"
                type="range"
                min="0"
                max={rows.length - 1}
                value={Math.min(index, rows.length - 1)}
                onChange={(e) => setIndex(Number(e.target.value))}
              />
              <output className="observation-value">
                {selected.value === null
                  ? "Missing"
                  : selected.value.toLocaleString()}{" "}
                {series.unit}
                <small>
                  {dateTime(selected.observed_at)} · {selected.time_precision} ·
                  fetched {dateTime(selected.fetched_at)}
                  {selected.period_start && selected.period_end
                    ? ` · period ${dateTime(selected.period_start)}–${dateTime(selected.period_end)}`
                    : ""}
                </small>
              </output>
            </>
          )}
          {comparison.data?.comparison && (
            <p className="muted">
              Difference between the backend's returned endpoints:{" "}
              {comparison.data.comparison.difference.toLocaleString()}{" "}
              {comparison.data.comparison.unit}. {comparison.data.limitation}
            </p>
          )}
          {comparison.data && !comparison.data.comparison && (
            <p className="muted">
              {comparison.data.limitation ??
                "Two comparable observations are required."}
            </p>
          )}
          {comparison.isError && (
            <p className="notice">
              The endpoint comparison is unavailable. The chart remains
              readable.
            </p>
          )}
        </>
      ) : (
        <p className="empty-state">
          No numeric observations are available for this period.
        </p>
      )}
      <details>
        <summary>Observation table ({rows.length})</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Observed · UTC</th>
                <th>Value · {series.unit}</th>
                <th>Flags</th>
                <th>Precision / period · UTC</th>
                <th>Fetched · UTC</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, tableLimit).map((o) => (
                <tr key={o.id}>
                  <td>{dateTime(o.observed_at)}</td>
                  <td>{o.value ?? "Missing"}</td>
                  <td>{o.qualifiers.join(", ") || "—"}</td>
                  <td>
                    {o.time_precision}
                    {o.period_start && o.period_end
                      ? ` · ${dateTime(o.period_start)}–${dateTime(o.period_end)}`
                      : ""}
                  </td>
                  <td>{dateTime(o.fetched_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > tableLimit && (
          <button onClick={() => setTableLimit(tableLimit + 100)}>
            Show more observations
          </button>
        )}
      </details>
      {query.data?.capped && (
        <p className="notice">
          The response reached the observation limit. Narrow the period.
        </p>
      )}
      <p className="muted">{series.missing_data_rule}</p>
      {source && (
        <a href={source.url} target="_blank" rel="noopener noreferrer">
          {source.publisher} · Original dataset ↗
        </a>
      )}
    </section>
  );
}
