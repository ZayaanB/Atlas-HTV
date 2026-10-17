import { useEffect } from "react";
import type { Source } from "@atlas/contracts";
import { dateTime } from "../../lib/presentation";
export function SourceCards({
  sources,
  focusId,
}: {
  sources: readonly Source[];
  focusId?: string | null;
}) {
  useEffect(() => {
    if (focusId)
      document
        .getElementById("source-" + focusId)
        ?.scrollIntoView?.({ block: "start" });
  }, [focusId]);
  return (
    <div className="source-list">
      {sources.map((source) => (
        <section
          className="source-row"
          key={source.id}
          id={"source-" + source.id}
        >
          <p className="meta">
            {source.publisher} · {source.source_type.replaceAll("_", " ")}
          </p>
          <h3>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title} ↗
            </a>
          </h3>
          <dl className="metadata">
            <dt>Published</dt>
            <dd>
              {source.published_at
                ? dateTime(source.published_at)
                : source.published_date
                  ? source.published_date + " · date only"
                  : "Unavailable"}
            </dd>
            <dt>Retrieved</dt>
            <dd>{dateTime(source.retrieved_at)}</dd>
            <dt>Source review</dt>
            <dd>{source.verification_status}</dd>
          </dl>
          {source.attribution && <p className="muted">{source.attribution}</p>}
          {source.license && (
            <p className="muted">
              {source.license_url ? (
                <a
                  href={source.license_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.license}
                </a>
              ) : (
                source.license
              )}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
