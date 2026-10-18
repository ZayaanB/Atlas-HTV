import { useEffect, useRef, useState } from "react";
import type {
  Article,
  AssistantResponse,
  InvestigationResponse,
  NewsQuery,
  Location,
} from "@atlas/contracts";
import type { AtlasApi } from "../../lib/api";
import { normalizeNewsQuery } from "../../lib/api";
import { readContract } from "../../lib/validation";
import { useWorkspace } from "../../app/state";
import { Icon } from "../../components/Icon";
import { ResearchCoverage } from "../research/ResearchCoverage";
import {assistantAudience, audienceProfiles} from '../../app/audience';
import {AudienceSelect} from '../../components/AudienceSelect';
interface Message {
  role: "user" | "assistant";
  text: string;
  response?: AssistantResponse;
}
export function AssistantPanel({
  api,
  articles,
  investigation,
  initialPrompt,
}: {
  api: AtlasApi;
  articles: readonly Article[];
  investigation?: InvestigationResponse | undefined;
  initialPrompt?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(""),
    [allow, setAllow] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [undo, setUndo] = useState<NewsQuery | null>(null),
    [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null),
    requestId = useRef<string | null>(null),
    revision = useWorkspace((s) => s.contextRevision),
    selection = useWorkspace((s) => s.selection),
    audience = useWorkspace((s) => s.audience),
    filters = useWorkspace((s) => s.filters);
  useEffect(() => {
    if (initialPrompt) setDraft(initialPrompt);
  }, [initialPrompt]);
  useEffect(() => {
    controller.current?.abort();
    requestId.current = null;
    setPending(false);
  }, [revision, audience]);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(message = draft) {
    if (!message.trim() || !api.assistant || pending) return;
    const id = crypto.randomUUID(),
      abort = new AbortController(),
      context = useWorkspace.getState().contextRevision;
    controller.current?.abort();
    controller.current = abort;
    requestId.current = id;
    setPending(true);
    setError("");
    setStatus("");
    const trusted = new Map<string, Set<string>>();
    const trust = (record: string, sources: string[]) =>
      trusted.set(record, new Set(sources));
    for (const article of [...articles, ...(investigation?.articles ?? [])])
      trust(article.id, [article.source_id]);
    for (const evidence of investigation?.evidence ?? [])
      trust(evidence.id, evidence.source_ids);
    for (const item of investigation?.investigation.items ?? [])
      trust(item.id, item.source_ids);
    for (const observation of investigation?.observations ?? [])
      trust(observation.id, [observation.source_id]);
    const urls = new Map([
      ...(investigation?.sources ?? []).map((s) => [s.id, s.url] as const),
      ...articles.map((a) => [a.source_id, a.url] as const),
    ]);
    setMessages((previous) => [...previous, { role: "user", text: message }]);
    setDraft("");
    try {
      const response = readContract(
        "AssistantResponse",
        await api.assistant(
          readContract("AssistantRequest", {
            request_id: id,
            message: message.trim(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            filters,
            allow_ui_actions: allow,
            ...(investigation
              ? { selected_investigation_id: investigation.investigation.id }
              : {}),
            audience: assistantAudience(audience),
          }),
          abort.signal,
        ),
      );
      const current = () =>
        !abort.signal.aborted &&
        requestId.current === id &&
        useWorkspace.getState().contextRevision === context &&
        useWorkspace.getState().audience === audience;
      if (!current()) return;
      if (response.request_id !== id)
        throw new Error(
          "The assistant returned a mismatched request. No changes were applied.",
        );
      if (
        response.mode === "live" &&
        response.answer.trim() &&
        response.citations.length === 0
      )
        throw new Error(
          "The assistant returned an explanation without source citations. No changes were applied.",
        );
      // The server resolves citations from its retrieval ledger, including records
      // not loaded in this browser. Reject contradictions with known provenance;
      // the shared Citation schema still enforces safe original-source links.
      if (
        response.citations.some(
          (c) =>
            (trusted.has(c.record_id) &&
              !trusted.get(c.record_id)!.has(c.source_id)) ||
            (urls.has(c.source_id) && urls.get(c.source_id) !== c.url),
        )
      )
        throw new Error(
          "A citation could not be resolved against the available source records. No changes were applied.",
        );
      if (response.mode === "fallback" && response.actions.length)
        throw new Error("Fallback answers cannot change the workspace.");
      if (response.actions.length && !allow)
        throw new Error(
          "Workspace changes were not enabled. No changes were applied.",
        );
      const locations = new Map<string, Location>();
      for (const action of response.actions) {
        if (action.type === "set_filters") {
          normalizeNewsQuery(action.filters);
        }
        const ids =
          action.type === "focus_location"
            ? [action.location_id]
            : (action.filters.location_ids ?? []);
        if (ids.length) {
          const result = readContract(
            "LocationsResponse",
            await api.locations({ ids, limit: 100 }, abort.signal),
          );
          for (const loc of result.items) locations.set(loc.id, loc);
          if (ids.some((id) => !locations.has(id)))
            throw new Error(
              "The assistant referenced an unavailable location.",
            );
        }
      }
      if (!current()) return;
      if (response.actions.length) {
        const snapshot = useWorkspace.getState().filters;
        const lastFilter = response.actions
          .filter((a) => a.type === "set_filters")
          .at(-1);
        if (lastFilter?.type === "set_filters") {
          setUndo(snapshot);
          useWorkspace.getState().applyFilters(lastFilter.filters);
        }
        const focus = response.actions
          .filter((a) => a.type === "focus_location")
          .at(-1);
        if (focus?.type === "focus_location")
          useWorkspace
            .getState()
            .focusLocation(locations.get(focus.location_id)!);
        setStatus(
          response.actions
            .map((a) =>
              a.type === "set_filters"
                ? "Updated reporting filters"
                : "Focused a sourced location",
            )
            .join(" · "),
        );
      }
      setMessages((previous) => [
        ...previous,
        { role: "assistant", text: response.answer, response },
      ]);
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(
          e instanceof Error ? e.message : "Assistant unavailable. Try again.",
        );
        setDraft(message);
      }
    } finally {
      if (requestId.current === id) {
        setPending(false);
        requestId.current = null;
      }
    }
  }
  const suggestions = audienceProfiles[audience].questions.map(prompt => (
    <button key={prompt} className="suggestion" onClick={() => setDraft(prompt)}>
      {prompt}<Icon name="arrow" size={15} />
    </button>
  ));
  return (
    <section aria-label="Ask Atlas">
      <p className="muted assistant-context">
        {investigation
          ? investigation.investigation.title
          : (articles.find((a) => a.id === selection.articleId)?.title ??
            "Current reporting and filters")}
      </p>
      {api.mode === "fixture" && (
        <p className="notice">
          Historical fixture mode. No Gemini request is made.
        </p>
      )}
      {!api.assistant && (
        <p className="notice">
          The assistant is not connected. Manual search and source-linked
          research remain available.
        </p>
      )}
      <div className="conversation" aria-live="polite">
        {messages.length === 0 ? (
          <div className="assistant-empty">
            <Icon name="spark" size={28} />
            <h2>A closer look.</h2>
            <p className="muted">
              Ask what the sources establish, what changed, or what remains
              uncertain.
            </p>
            {suggestions}
          </div>
        ) : (
          messages.map((message, i) => (
            <article key={i} className={`message ${message.role}`}>
              <span className="meta">
                {message.role === "user" ? "You" : "Atlas"}
                {message.response ? " · " + message.response.mode : ""}
              </span>
              <p>{message.text}</p>
              {message.response?.errors.map((failure, index) => (
                <p className="notice" key={index}>
                  {failure.message} ({failure.code})
                  {failure.retryable ? " You can retry this question." : ""}
                </p>
              ))}
              {message.response?.citations.map((c) => (
                <a
                  className="citation"
                  key={c.record_id + c.source_id}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {c.title} ↗
                </a>
              ))}
              {message.response && (
                <ResearchCoverage coverage={message.response.coverage} />
              )}
            </article>
          ))
        )}
      </div>
      {messages.length > 0 && <details className="audience-suggestions"><summary>Suggested questions</summary>{suggestions}</details>}
      {status && (
        <p role="status" className="notice">
          {status}
        </p>
      )}
      {undo && (
        <button
          className="text-button"
          onClick={() => {
            useWorkspace.getState().applyFilters(undo);
            setUndo(null);
            setStatus("Previous filters restored.");
          }}
        >
          Undo filters
        </button>
      )}
      {pending && (
        <p role="status" className="muted">
          Reading the available evidence…
        </p>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => void submit(draft)}>Retry question</button>
        </div>
      )}
      <form
        className="assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="question">Your question</label>
        <textarea
          id="question"
          maxLength={4000}
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about this place or story…"
        />
        <div className="composer-options">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={allow}
              onChange={(e) => {
                controller.current?.abort();
                requestId.current = null;
                setPending(false);
                setAllow(e.target.checked);
              }}
            />
            Allow map and filter updates
          </label>
          <AudienceSelect label="Perspective" />
        </div>
        <p className="muted">
          Perspective changes explanation emphasis. Facts and active filters
          stay the same.
        </p>
        {pending ? (
          <button
            type="button"
            onClick={() => {
              controller.current?.abort();
              requestId.current = null;
              setPending(false);
              setStatus("Question cancelled.");
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            className="primary"
            disabled={!draft.trim() || !api.assistant}
          >
            Send question <Icon name="arrow" size={16} />
          </button>
        )}
      </form>
    </section>
  );
}
