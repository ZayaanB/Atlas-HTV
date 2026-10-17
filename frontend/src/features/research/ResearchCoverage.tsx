import type { Coverage } from "@atlas/contracts";
import { dateTime, words } from "../../lib/presentation";

export function ResearchCoverage({ coverage }: { coverage: Coverage }) {
  const latestRefresh =
    coverage.feeds
      ?.flatMap((feed) =>
        feed.last_successful_at ? [feed.last_successful_at] : [],
      )
      .sort((a, b) => Date.parse(a) - Date.parse(b))
      .at(-1) ?? coverage.last_successful_at;
  return (
    <details className="coverage">
      <summary>
        Data coverage ·{" "}
        {coverage.mode === "fixture"
          ? "historical fixture"
          : words(coverage.mode)}
      </summary>
      <p>
        Available stored sources only. Coverage may be incomplete and does not
        establish live coverage.
      </p>
      {coverage.articles && (
        <p>
          Stored corpus: {coverage.articles.total} articles,{" "}
          {coverage.articles.unreviewed} unreviewed. These counts do not
          describe the filtered results.
        </p>
      )}
      {latestRefresh && (
        <p>Latest successful reporting refresh: {dateTime(latestRefresh)}.</p>
      )}
      {coverage.datasets?.map((dataset) => (
        <p key={dataset.series_id}>
          {words(dataset.metric)} · {dataset.unit} · {dataset.source_id}
          <br />
          {dataset.coverage_from
            ? dateTime(dataset.coverage_from)
            : "Start unavailable"}
          –
          {dataset.coverage_to
            ? dateTime(dataset.coverage_to)
            : "End unavailable"}
          <br />
          Retrieved:{" "}
          {dataset.retrieved_at
            ? dateTime(dataset.retrieved_at)
            : "unavailable"}
        </p>
      ))}
      {!coverage.datasets?.length && (
        <p>No dataset coverage metadata was supplied.</p>
      )}
      {coverage.feeds?.some((feed) => feed.status === "failed") && (
        <p>Some source refreshes failed. Stored records may be stale.</p>
      )}
    </details>
  );
}
