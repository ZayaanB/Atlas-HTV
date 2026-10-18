import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  Article,
  InvestigationResponse,
  OpenTimelineArgs,
  AssistantResponseV2,
  AssistantStreamEvent,
} from "@atlas/contracts";
import { useWorkspace } from "../../app/state";
import { assistantAudience } from "../../app/audience";
import type { AtlasApi } from "../../lib/api";
import { ApiFailure } from "../../lib/api";
import { readContract } from "../../lib/validation";
import { packHistory, validateAnswer, type Exchange } from "./protocol";
import { prepareActions } from "./actions";

export function useAssistantSession(
  api: AtlasApi,
  articles: readonly Article[],
  investigation?: InvestigationResponse,
) {
  const client = useQueryClient();
  const audience = useWorkspace(state => state.audience);
  const [exchanges, setExchanges] = useState<Exchange[]>([]),
    [draft, setDraft] = useState(""),
    [pending, setPending] = useState(false),
    [status, setStatus] = useState(""),
    [composerError, setComposerError] = useState("");
  const lastPromptId = useRef<string | null>(null);
  const revision = useRef(0),
    active = useRef<{
      id: string;
      turnId: string;
      controller: AbortController;
    } | null>(null),
    transcript = useRef(exchanges),
    sources = useRef({ articles, investigation });
  transcript.current = exchanges;
  sources.current = { articles, investigation };
  function cancel(message = "Question cancelled.") {
    const work = active.current;
    if (!work) return;
    active.current = null;
    work.controller.abort();
    setPending(false);
    setExchanges((previous) =>
      previous.map((e) =>
        e.id === work.turnId && e.status === "pending"
          ? { ...e, status: "cancelled", preview: undefined, phase: undefined }
          : e,
      ),
    );
    setStatus(message);
  }
  useEffect(
    () =>
      useWorkspace.subscribe((next, previous) => {
        if (
          next.contextRevision !== previous.contextRevision ||
          next.audience !== previous.audience ||
          (previous.panel?.view === "assistant" &&
            next.panel?.view !== "assistant")
        )
          cancel(
            "Workspace context changed. The pending question was cancelled.",
          );
      }),
    [],
  );
  useEffect(() => {
    cancel("Research context changed. The pending question was cancelled.");
  }, [investigation]);
  useEffect(
    () => () => {
      active.current?.controller.abort();
      active.current = null;
    },
    [],
  );
  async function submit(retryId?: string) {
    if (active.current || (!api.assistant && !api.assistantStream)) return;
    const failed = retryId
      ? transcript.current.find(
          (e) =>
            e.id === retryId &&
            (e.status === "failed" || e.response?.mode === "fallback"),
        )
      : undefined;
    if (retryId && !failed) return;
    const message = failed?.question ?? draft;
    if (!message.trim()) return;
    const snapshot = structuredCloneSnapshot(),
      context = sources.current,
      conversation = revision.current;
    const requestId = crypto.randomUUID(),
      turnId = failed?.id ?? crypto.randomUUID(),
      controller = new AbortController();
    let packed: ReturnType<typeof packHistory>;
    try {
      packed = packHistory(
        {
          protocol_version: 2,
          interaction_mode: "intent",
          request_id: requestId,
          message,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          filters: snapshot.filters,
          audience: assistantAudience(snapshot.audience),
          ...(snapshot.selectedInvestigationId
            ? { selected_investigation_id: snapshot.selectedInvestigationId }
            : {}),
          ...(snapshot.selection.articleId
            ? { selected_article_id: snapshot.selection.articleId }
            : {}),
          ...(snapshot.selection.locationId
            ? { selected_location_id: snapshot.selection.locationId }
            : {}),
          ...(snapshot.filters.bounds
            ? { selected_bounds: [...snapshot.filters.bounds] }
            : {}),
        },
        transcript.current,
      );
    } catch (error) {
      setComposerError(
        error instanceof Error
          ? error.message
          : "Shorten the question or simplify its context.",
      );
      return;
    }
    active.current = { id: requestId, turnId, controller };
    setExchanges((previous) =>
      failed
        ? previous.map((e) =>
            e.id === turnId
              ? {
                  id: turnId,
                  question: message,
                  status: "pending",
                  historyOmitted: packed.omitted,
                }
              : e,
          )
        : [
            ...previous,
            {
              id: turnId,
              question: message,
              status: "pending",
              historyOmitted: packed.omitted,
            },
          ],
    );
    if (!failed) setDraft("");
    setComposerError("");
    setStatus("");
    setPending(true);
    const current = () =>
      !controller.signal.aborted &&
      active.current?.id === requestId &&
      useWorkspace.getState().contextRevision === snapshot.contextRevision &&
      revision.current === conversation &&
      useWorkspace.getState().audience === snapshot.audience;
    const update = (event: AssistantStreamEvent) => {
      if (!current()) return;
      if (event.request_id !== requestId) throw new Error('The assistant returned a mismatched stream.');
      setExchanges(previous => previous.map(e => {
        if (e.id !== turnId) return e;
        if (event.type === 'status') return { ...e, phase: event.phase,
          ...(event.phase === 'researching' && e.phase === 'writing' ? { preview: undefined } : {}) };
        if (event.type === 'answer_delta') {
          const preview = (e.preview ?? '') + event.text;
          if (preview.length > 32000) return e;
          return { ...e, preview, phase: 'writing' };
        }
        return e;
      }));
    };
    try {
      const response = readContract(
        "AssistantResponseV2",
        await (api.assistantStream
          ? api.assistantStream(packed.request, controller.signal, update)
          : api.assistant!(packed.request, controller.signal)),
      );
      if (!current()) return;
      if (response.request_id !== requestId)
        throw new Error(
          "The assistant returned a mismatched request. No changes were applied.",
        );
      validateAnswer(response);
      const prepared = await prepareActions(
        api,
        client,
        response.actions,
        snapshot,
        context.articles,
        context.investigation,
        controller.signal,
        response.resolved_range,
      );
      if (!current()) return;
      // Retire before the single transaction publishes its context revision.
      active.current = null;
      setExchanges((previous) =>
        previous.map((e) =>
          e.id === turnId ? { ...e, status: "complete", response, preview: undefined, phase: undefined } : e,
        ),
      );
      setPending(false);
      if (response.actions.length) {
        useWorkspace
          .getState()
          .commitAssistant(prepared, snapshot.contextRevision);
        setStatus(
          response.actions
            .map((a) =>
              a.type === "set_filters"
                ? "Updated reporting filters"
                : a.type === "focus_location"
                  ? "Focused a sourced location"
                  : "Opened the historical timeline",
            )
            .join(" · "),
        );
      } else setStatus(response.mode === 'fallback'
        ? 'The answer could not be completed. Retry the question or use manual search.'
        : response.kind === 'clarification' ? 'Atlas needs a clarification.' : 'Response ready.');
    } catch (error) {
      if (!current()) return;
      const failure =
        error instanceof ApiFailure
          ? {
              message: error.message,
              code: error.code,
              retryable: error.retryable,
              requestId: error.requestId,
            }
          : {
              message:
                error instanceof Error
                  ? error.message
                  : "Assistant unavailable.",
              code: "INVALID_RESPONSE",
              retryable: false,
              requestId,
            };
      setExchanges((previous) =>
        previous.map((e) =>
          e.id === turnId ? { ...e, status: "failed", error: failure, preview: undefined, phase: undefined } : e,
        ),
      );
    } finally {
      if (active.current?.id === requestId) {
        active.current = null;
        setPending(false);
      }
    }
  }
  // Both suggested links and explicit actions pass through the same target preflight.
  async function openTimeline(
    target: OpenTimelineArgs,
    label: AssistantResponseV2["resolved_range"],
  ) {
    cancel();
    const snapshot = structuredCloneSnapshot(),
      controller = new AbortController(),
      conversation = revision.current;
    const navigationId = crypto.randomUUID();
    active.current = { id: navigationId, turnId: "", controller };
    setPending(true);
    setStatus("Opening timeline…");
    try {
      const prepared = await prepareActions(
        api,
        client,
        [{ type: "open_timeline", ...target }],
        snapshot,
        sources.current.articles,
        sources.current.investigation,
        controller.signal,
        label,
      );
      if (
        controller.signal.aborted ||
        active.current?.id !== navigationId ||
        snapshot.contextRevision !== useWorkspace.getState().contextRevision ||
        conversation !== revision.current
      )
        return;
      active.current = null;
      setPending(false);
      useWorkspace
        .getState()
        .commitAssistant(prepared, snapshot.contextRevision);
      setStatus("Opened the historical timeline.");
    } catch (error) {
      if (!controller.signal.aborted && active.current?.id === navigationId)
        setStatus(
          error instanceof Error
            ? error.message
            : "The timeline is unavailable.",
        );
    } finally {
      if (active.current?.id === navigationId) {
        active.current = null;
        setPending(false);
      }
    }
  }
  return {
    exchanges,
    draft,
    setDraft,
    audience,
    pending,
    status,
    composerError,
    submit,
    cancel,
    openTimeline,
    populatePrompt(request: { id: string; text: string }) {
      if (lastPromptId.current !== request.id) {
        lastPromptId.current = request.id;
        setDraft(request.text);
      }
    },
    setAudience(value: typeof audience) {
      cancel("Perspective changed. The pending question was cancelled.");
      useWorkspace.getState().setAudience(value);
    },
    newConversation() {
      cancel();
      revision.current++;
      setExchanges([]);
      transcript.current = [];
      setDraft("");
      setStatus("");
      setComposerError("");
    },
  };
}
function structuredCloneSnapshot() {
  const state = useWorkspace.getState();
  return {
    ...state,
    filters: structuredClone(state.filters),
    selection: { ...state.selection },
  };
}
export type AssistantSession = ReturnType<typeof useAssistantSession>;
