import { useEffect, useState } from "react";
import type { Evidence, InvestigationResponse } from "@atlas/contracts";
import type { AtlasApi } from "../../lib/api";
import { useWorkspace } from "../../app/state";
import { SourceCards } from "./SourceCards";
import { Timeline } from "./Timeline";
import { dateTime, words } from "../../lib/presentation";
import { localEvidenceAsset } from "../../lib/evidence-assets";
import {audienceProfiles} from '../../app/audience';
import {AudienceSelect} from '../../components/AudienceSelect';
export type EvidenceOverlay = {
  evidence: Evidence;
  url: string;
  opacity: number;
} | null;
export function InvestigationPanel({
  api,
  data,
  saved,
  onSave,
  onAsk,
  onOverlay,
  onFocus,
}: {
  api: AtlasApi;
  data: InvestigationResponse;
  saved: boolean;
  onSave: () => void;
  onAsk: (prompt?: string) => void;
  onOverlay: (overlay: EvidenceOverlay) => void;
  onFocus: (bounds: NonNullable<Evidence["imagery"]>["bounds"]) => void;
}) {
  const tab = useWorkspace((s) => s.investigationTab),
    setTab = useWorkspace((s) => s.setInvestigationTab),
    timelineIntent = useWorkspace((s) => s.timelineIntent);
  const [sourceFocus, setSourceFocus] = useState<string | null>(null),
    [imageId, setImageId] = useState(""),
    [visible, setVisible] = useState(false),
    [opacity, setOpacity] = useState(0.85),
    [imageError, setImageError] = useState(false);
  const audience = useWorkspace(state => state.audience);
  const inv = data.investigation,
    imagery = data.evidence.filter((e) => e.type === "imagery"),
    image = imagery.find((e) => e.id === imageId) ?? imagery[0],
    url = image?.imagery ? localEvidenceAsset(image.imagery.asset_path) : null;
  useEffect(() => {
    onOverlay(
      visible && image && url ? { evidence: image, url, opacity } : null,
    );
    return () => onOverlay(null);
  }, [visible, image, url, opacity, onOverlay]);
  const cited = (ids: string[]) =>
    ids.map((id, i) => (
      <button
        className="citation"
        key={id}
        aria-label={`View source ${data.sources.find((s) => s.id === id)?.title ?? i + 1}`}
        onClick={() => {
          setSourceFocus(id);
          setTab("sources");
        }}
      >
        {data.sources.find((s) => s.id === id)?.publisher ?? "Source"} ↗
      </button>
    ));
  return (
    <section aria-label="Investigation">
      <p className="meta">
        {words(inv.content_status)} · {inv.event_period.start_date}–
        {inv.event_period.end_date} · {inv.event_period.timezone}
      </p>
      <p className="meta">
        {words(inv.verification_status)}
        {inv.reviewed_at
          ? ` · reviewed ${dateTime(inv.reviewed_at)}`
          : " · review time unavailable"}
      </p>
      <h2>{inv.title}</h2>
      <div className="investigation-actions">
        <button
          className={saved ? "saved" : ""}
          aria-pressed={saved}
          onClick={onSave}
        >
          {saved ? "Saved" : "Save investigation"}
        </button>
        <button className="text-button" onClick={() => onAsk()}>
          Ask about this
        </button>
      </div>
      <nav className="section-tabs" aria-label="Investigation sections">
        {(["brief", "timeline", "evidence", "sources"] as const).map(
          (value) => (
            <button
              key={value}
              aria-current={tab === value ? "page" : undefined}
              onClick={() => setTab(value)}
            >
              {value[0]!.toUpperCase() + value.slice(1)}
            </button>
          ),
        )}
      </nav>
      {tab === "brief" && (
        <>
          <AudienceSelect label="Perspective" />
          <p className="muted">
            Perspective changes the reading order. All supplied facts and source
            links remain available.
          </p>
          <p className="investigation-summary">{inv.summary}</p>
          {audienceProfiles[audience].sections.map((kind) => (
            <section className="brief-section" key={kind}>
              <h3>{words(kind)}</h3>
              {inv.items.filter((item) => item.kind === kind).length ? (
                inv.items
                  .filter((item) => item.kind === kind)
                  .map((item) => (
                    <div className="brief-item" key={item.id}>
                      <p>{item.text}</p>
                      {item.exposure_basis && (
                        <p className="muted">Basis: {item.exposure_basis}</p>
                      )}
                      <div className="citations">{cited(item.source_ids)}</div>
                      {kind === "research_question" && (
                        <button
                          className="text-button"
                          onClick={() => onAsk(item.text)}
                        >
                          Explore this question
                        </button>
                      )}
                    </div>
                  ))
              ) : (
                <p className="muted">
                  No documented {words(kind)} is supplied for this
                  investigation.
                </p>
              )}
            </section>
          ))}
        </>
      )}
      {tab === "timeline" && (
        <Timeline
          key={timelineIntent?.id ?? inv.id}
          api={api}
          data={data}
          intent={
            timelineIntent?.target.investigation_id === inv.id
              ? timelineIntent
              : null
          }
        />
      )}
      {tab === "sources" && (
        <SourceCards sources={data.sources} focusId={sourceFocus} />
      )}
      {tab === "evidence" && (
        <>
          <h3>Dated imagery</h3>
          {imagery.length ? (
            <>
              <label>
                Observation
                <select
                  value={image?.id ?? ""}
                  onChange={(e) => {
                    setImageId(e.target.value);
                    setImageError(false);
                  }}
                >
                  {imagery.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.observed_from?.slice(0, 10)} ·{" "}
                      {e.imagery?.comparison_role ?? "observation"}
                    </option>
                  ))}
                </select>
              </label>
              {url && !imageError ? (
                <img
                  className="evidence-preview"
                  src={url}
                  alt={image!.title}
                  onError={() => {
                    setImageError(true);
                    setVisible(false);
                  }}
                />
              ) : (
                <p className="notice">
                  The verified image asset could not be loaded.
                </p>
              )}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={!url || imageError}
                  onChange={(e) => setVisible(e.target.checked)}
                />{" "}
                Show on map
              </label>
              {image?.imagery && (
                <button
                  className="text-button"
                  onClick={() => onFocus(image.imagery!.bounds)}
                >
                  Focus imagery on map
                </button>
              )}
              <label>
                Overlay opacity
                <input
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </label>
              <h3>{image?.title}</h3>
              <p>{image?.description}</p>
              <dl className="metadata">
                <dt>Observed</dt>
                <dd>{dateTime(image?.observed_from)}</dd>
                <dt>Native resolution</dt>
                <dd>{image?.imagery?.resolution_m} m</dd>
              </dl>
              <p className="notice">{image?.limitations}</p>
              <p className="muted">{image?.imagery?.legend}</p>
              <p className="muted">{image?.imagery?.attribution}</p>
              <p className="muted">{image?.imagery?.license}</p>
              <div className="citations">{cited(image?.source_ids ?? [])}</div>
            </>
          ) : (
            <p>No dated imagery is linked to this investigation.</p>
          )}
          <h3>Other evidence</h3>
          {data.evidence
            .filter((e) => e.type !== "imagery")
            .map((e) => (
              <section className="source-row" key={e.id}>
                <h3>{e.title}</h3>
                <p>{e.description}</p>
                <p className="muted">{e.limitations}</p>
                <div className="citations">{cited(e.source_ids)}</div>
              </section>
            ))}
        </>
      )}
    </section>
  );
}
