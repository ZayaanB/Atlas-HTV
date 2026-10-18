import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssistantResponseV2, CitationV2 } from "@atlas/contracts";
import type { AssistantSession } from "./session";
import { useWorkspace } from "../../app/state";
import { audienceProfiles } from "../../app/audience";
import { AudienceSelect } from "../../components/AudienceSelect";
import { Icon } from "../../components/Icon";
import { GeminiMark } from "../../components/GeminiMark";
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
    <details className="assistant-sources">
      <summary>Sources <span>{citations.length}</span><Icon name="chevron" size={14} /></summary>
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
    </details>
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
  const conversation = useRef<HTMLDivElement>(null), follow = useRef(true), input = useRef<HTMLTextAreaElement>(null), footer = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      footer.current?.querySelectorAll<HTMLDetailsElement>('.assistant-popover[open]').forEach(menu => {
        if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
      });
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useLayoutEffect(() => {
    const body = conversation.current;
    if (body && !body.closest('[hidden]')) {
      if (!session.exchanges.length) body.scrollTop = 0;
      else if (follow.current) body.scrollTop = body.scrollHeight;
    }
  }, [session.exchanges]);
  useLayoutEffect(() => {
    if (input.current) {
      input.current.style.height = 'auto';
      input.current.style.height = `${Math.min(input.current.scrollHeight, 144)}px`;
    }
  }, [session.draft]);
  useEffect(() => {
    if (!session.exchanges.length) { follow.current = true; setShowLatest(false); }
  }, [session.exchanges.length]);
  const suggestions = audienceProfiles[audience].questions.map(prompt => (
    <button
      key={prompt}
      className="suggestion"
      onClick={(event) => {
        session.populatePrompt({ id: crypto.randomUUID(), text: prompt });
        event.currentTarget.closest('details')?.removeAttribute('open');
        input.current?.focus();
      }}
    >
      {prompt}<Icon name="arrow" size={15} />
    </button>
  ));
  return (
    <section aria-label="Ask Atlas" className="assistant-chat">
      <div className="assistant-toolbar">
        <span className="assistant-brand"><GeminiMark /> Gemini</span>
        <button className="text-button" onClick={session.newConversation}>
          <Icon name="plus" size={14} /> New conversation
        </button>
      </div>
      <p className="assistant-context muted">
        <Icon name="layers" size={13} />
        {selection.locationId ? "Selected place" : selectedInvestigationId ? "Selected investigation" : selection.articleId ? "Selected article" : "Current reporting"}
        <span>· active filters</span>
      </p>
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
      <div className="conversation" role="region" tabIndex={0} aria-label="Conversation" ref={conversation}
        onScroll={(event) => {
          const body = event.currentTarget;
          follow.current = body.scrollHeight - body.scrollTop - body.clientHeight < 100;
          setShowLatest(!follow.current);
        }}>
        {!session.exchanges.length && (
          <div className="assistant-empty">
            <GeminiMark size={32} />
            <h2>Where should we start?</h2>
            <p className="muted">
              Explore a place, follow a story, or ask about the evidence.
            </p>
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
                <span className="meta">Atlas{turn.response.mode !== "live" && ` · ${turn.response.mode}`}</span>
                <Answer response={turn.response} />
                <details className="assistant-response-details">
                  <summary>Response details</summary>
                  <p className="meta">
                    {turn.response.mode === "live" ? "Live generation · stored evidence" : turn.response.mode}
                    {" · "}{turn.response.kind.replace("_", " ")}
                  </p>
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
                  <ResearchCoverage coverage={turn.response.coverage} />
                </details>
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
              </article>
            )}
          </div>
        ))}
      </div>
      <div className="assistant-footer" ref={footer} onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        const menu = footer.current?.querySelector<HTMLDetailsElement>('.assistant-popover[open]');
        if (menu) {
          event.preventDefault();
          event.stopPropagation();
          menu.open = false;
          menu.querySelector('summary')?.focus();
        }
      }}>
        {showLatest && <button className="assistant-latest" onClick={() => {
          follow.current = true;
          setShowLatest(false);
          if (conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
        }}>Latest response <Icon name="chevron" size={14} /></button>}
        <p role="status" aria-atomic="true" className={pendingTurn || !session.status ? 'sr-only' : 'assistant-status'}>
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
            follow.current = true;
            setShowLatest(false);
            void session.submit();
          }}
        >
          <label className="sr-only" htmlFor="question">Your question</label>
          <textarea
            ref={input}
            id="question"
            maxLength={4000}
            value={session.draft}
            rows={2}
            onChange={(e) => session.setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!session.pending && connected && session.draft.trim()) e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask about this place or story…"
            aria-describedby="assistant-input-help"
          />
          <div className="composer-options">
            <AudienceSelect label="Perspective" />
            {session.pending ? (
              <button type="button" className="composer-send" aria-label="Cancel" title="Stop response" onClick={() => session.cancel()}>
                <span className="stop-symbol" />
              </button>
            ) : (
              <button
                className="primary composer-send"
                aria-label="Send question"
                title="Send question"
                disabled={!session.draft.trim() || !connected}
              >
                <Icon name="arrow" size={18} />
              </button>
            )}
          </div>
        </form>
        <div className="assistant-footer-tools">
          <details className="audience-suggestions assistant-popover">
            <summary>Suggested questions</summary>
            <div>{suggestions}</div>
          </details>
          <details className="assistant-info assistant-popover">
            <summary>Chat info</summary>
            <div>
              <p>Filter, zoom, and timeline commands update the workspace. Questions keep your current view.</p>
              <p>Conversation stays until refresh or New conversation. Sources are linked when available; check the original material.</p>
              <p>Enter to send. Shift+Enter for a new line.</p>
            </div>
          </details>
        </div>
        <span id="assistant-input-help" className="sr-only">Enter to send. Shift+Enter for a new line.</span>
      </div>
    </section>
  );
}
