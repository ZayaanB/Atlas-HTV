import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssistantResponseV2, CitationV2 } from "@atlas/contracts";
import type { AssistantSession } from "./session";
import { useWorkspace } from "../../app/state";
import { audienceProfiles } from "../../app/audience";
import { AudienceSelect } from "../../components/AudienceSelect";
import { Icon } from "../../components/Icon";
import { dateTime } from "../../lib/presentation";
import { ResearchCoverage } from "../research/ResearchCoverage";

const phases = {
  reading: 'Reading the available evidence…',
  interpreting: 'Understanding your question…',
  researching: 'Following the available sources…',
  writing: 'Writing…',
  validating: 'Finishing your response…',
} as const;

function Answer({ response }: { response: AssistantResponseV2 }) {
  const parts = response.answer.split(/(\[\d+\])/g);
  return (
    <p className="answer-text">
      {parts.map((part, index) => {
        const match = /^\[(\d+)\]$/.exec(part),
          citation = match
            ? response.citations.find(c => c.number === Number(match[1]))
            : undefined;
        return citation ? (
          <a
            key={index}
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Source ${citation.number}: ${citation.title} (opens in a new tab)`}
          >
            {part}
          </a>
        ) : (
          part
        );
      })}
    </p>
  );
}
function CitationCard({ citation: c }: { citation: CitationV2 }) {
  return (
    <li className="assistant-source">
      <a
        href={c.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Source ${c.number}: ${c.title} (opens in a new tab)`}
      >
        [{c.number}] {c.title} ↗
      </a>
      <dl className="metadata">
        <dt>Published</dt>
        <dd>
          {c.published_at
            ? dateTime(c.published_at)
            : (c.published_date ?? "Date unavailable")}
        </dd>
        {c.observed_at && (
          <>
            <dt>Observed</dt>
            <dd>{dateTime(c.observed_at)}</dd>
          </>
        )}
        {(c.observed_from || c.observed_to) && (
          <>
            <dt>Observation range</dt>
            <dd>
              {c.observed_from
                ? dateTime(c.observed_from)
                : "Start unavailable"}{" "}
              – {c.observed_to ? dateTime(c.observed_to) : "End unavailable"}
            </dd>
          </>
        )}
        {(c.period_start || c.period_end) && (
          <>
            <dt>Period</dt>
            <dd>
              {c.period_start ? dateTime(c.period_start) : "Start unavailable"}{" "}
              – {c.period_end ? dateTime(c.period_end) : "End unavailable"}
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}
function Sources({ citations }: { citations: CitationV2[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!citations.length) return null;
  return (
    <div className="assistant-sources">
      <h3>Sources</h3>
      <ol className="plain-list">
        {citations.slice(0, expanded ? citations.length : 3).map((c) => (
          <CitationCard key={c.number} citation={c} />
        ))}
      </ol>
      {citations.length > 3 && (
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show fewer sources"
            : `Show all ${citations.length} sources`}
        </button>
      )}
    </div>
  );
}
export function AssistantPanel({
  session,
  fixture,
  connected,
}: {
  session: AssistantSession;
  fixture: boolean;
  connected: boolean;
}) {
  const {
    audience,
    selection,
    selectedInvestigationId,
    filterUndo,
    undoFilters,
    openPanel,
  } = useWorkspace();
  const pendingTurn = session.exchanges.find(turn => turn.status === 'pending');
  const conversation = useRef<HTMLDivElement>(null), follow = useRef(true);
  useEffect(() => {
    const body = conversation.current?.closest('.panel-body');
    if (!(body instanceof HTMLElement)) return;
    const reading = () => { follow.current = body.scrollHeight - body.scrollTop - body.clientHeight < 100; };
    body.addEventListener('scroll', reading, { passive: true });
    return () => body.removeEventListener('scroll', reading);
  }, []);
  useLayoutEffect(() => {
    const body = conversation.current?.closest('.panel-body');
    if (body instanceof HTMLElement && follow.current && !conversation.current?.closest('[hidden]')) body.scrollTop = body.scrollHeight;
  }, [session.exchanges]);
  const suggestions = audienceProfiles[audience].questions.map(prompt => (
    <button
      key={prompt}
      className="suggestion"
      onClick={() => session.populatePrompt({ id: crypto.randomUUID(), text: prompt })}
    >
      {prompt}<Icon name="arrow" size={15} />
    </button>
  ));
  return (
    <section aria-label="Ask Atlas">
      <div className="panel-tools">
        <p className="muted assistant-context">
          {selection.locationId
            ? "Selected place and active filters"
            : selectedInvestigationId
              ? "Selected investigation and active filters"
              : selection.articleId
                ? "Selected article and active filters"
                : "Current reporting and filters"}
        </p>
        <button className="text-button" onClick={session.newConversation}>
          New conversation
        </button>
      </div>
      {fixture && (
        <p className="notice">
          Historical fixture mode. No Gemini request is made.
        </p>
      )}
      {!connected && (
        <p className="notice">
          The assistant is not connected. Manual search and source-linked
          research remain available.
        </p>
      )}
      <div className="conversation" aria-label="Conversation" ref={conversation}>
        {!session.exchanges.length && (
          <div className="assistant-empty">
            <Icon name="spark" size={28} />
            <h2>A closer look.</h2>
            <p className="muted">
              Ask what the sources establish, what changed, or what remains
              uncertain.
            </p>
            {suggestions}
          </div>
        )}
        {session.exchanges.map((turn) => (
          <div key={turn.id} className="exchange">
            <article className="message user">
              <span className="meta">You</span>
              <p>{turn.question}</p>
            </article>
            {turn.historyOmitted && (
              <p className="notice">
                Earlier conversation was omitted from this request to fit the
                message and size limits. The full transcript remains here.
              </p>
            )}
            {turn.status === "pending" && (
              <article className="message assistant" aria-label="Atlas response in progress" aria-busy="true">
                <span className="meta">Atlas</span>
                {turn.preview && <p className="answer-text" aria-live="off">{turn.preview}</p>}
                <p aria-hidden="true" className="muted streaming-status">
                  {phases[turn.phase ?? 'reading']}
                </p>
              </article>
            )}
            {turn.status === "cancelled" && (
              <p className="muted">Question cancelled. You can ask it again.</p>
            )}
            {turn.error && (
              <div role="alert" className="error">
                <p>
                  {turn.error.message} ({turn.error.code})
                </p>
                {turn.error.code === "CONTRACTS_UNAVAILABLE" ? (
                  <p>
                    The backend needs the v2 contracts build and a restart.
                    Manual search is available.
                  </p>
                ) : (
                  <button
                    disabled={session.pending}
                    onClick={() => void session.submit(turn.id)}
                  >
                    Retry question
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() => openPanel({ view: "search" })}
                >
                  Manual search
                </button>
              </div>
            )}
            {turn.response && (
              <article className="message assistant">
                <span className="meta">
                  Atlas ·{" "}
                  {turn.response.mode === "live"
                    ? "live generation · stored evidence"
                    : turn.response.mode}{" "}
                  · {turn.response.kind.replace("_", " ")}
                </span>
                <Answer response={turn.response} />
                {turn.response.search && (
                  <p className="meta">
                    {turn.response.search.returned_count} articles returned on
                    this page · limit {turn.response.search.limit} · offset{" "}
                    {turn.response.search.offset}
                  </p>
                )}
                {turn.response.resolved_range && (
                  <p className="meta">
                    {turn.response.resolved_range.target === "publication"
                      ? "Publication"
                      : "Observation"}{" "}
                    period: {turn.response.resolved_range.label} ·{" "}
                    {turn.response.resolved_range.timezone}
                  </p>
                )}
                {turn.response.timeline && (
                  <button
                    className="text-button"
                    disabled={session.pending}
                    onClick={() =>
                      void session.openTimeline(
                        turn.response!.timeline!,
                        turn.response!.resolved_range,
                      )
                    }
                  >
                    Open timeline
                  </button>
                )}
                {turn.response.errors.map((error, index) => (
                  <p className="notice" key={index}>
                    {error.message} ({error.code})
                  </p>
                ))}
                {turn.response.mode === "fallback" &&
                  turn.response.errors.some((e) => e.retryable) && (
                    <button
                      disabled={session.pending}
                      onClick={() => void session.submit(turn.id)}
                    >
                      Retry question
                    </button>
                  )}
                {turn.response.mode === "fallback" && (
                  <button
                    className="text-button"
                    onClick={() => openPanel({ view: "search" })}
                  >
                    Use manual search
                  </button>
                )}
                <Sources citations={turn.response.citations} />
                <ResearchCoverage coverage={turn.response.coverage} />
              </article>
            )}
          </div>
        ))}
      </div>
      {session.exchanges.length > 0 && (
        <details className="audience-suggestions">
          <summary>Suggested questions</summary>
          {suggestions}
        </details>
      )}
      <p role="status" aria-atomic="true" className={pendingTurn || !session.status ? 'sr-only' : 'notice'}>
        {pendingTurn ? phases[pendingTurn.phase ?? 'reading'] : session.status}
      </p>
      {filterUndo && (
        <button className="text-button" onClick={undoFilters}>
          Undo filters
        </button>
      )}
      {session.composerError && (
        <p role="alert" className="error">
          {session.composerError}
        </p>
      )}
      <form
        className="assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void session.submit();
        }}
      >
        <label htmlFor="question">Your question</label>
        <textarea
          id="question"
          maxLength={4000}
          value={session.draft}
          rows={3}
          onChange={(e) => session.setDraft(e.target.value)}
          placeholder="Ask about this place or story…"
        />
        <div className="composer-options">
          <AudienceSelect label="Perspective" />
        </div>
        <p className="muted">
          Clear filter, zoom, and timeline commands update the workspace.
          Questions keep your current view. Conversation stays until refresh or
          New conversation.
        </p>
        {session.pending ? (
          <button type="button" onClick={() => session.cancel()}>
            Cancel
          </button>
        ) : (
          <button
            className="primary"
            disabled={!session.draft.trim() || !connected}
          >
            Send question <Icon name="arrow" size={16} />
          </button>
        )}
      </form>
    </section>
  );
}
