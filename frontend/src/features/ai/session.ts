import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  Article,
  InvestigationResponse,
  OpenTimelineArgs,
  AssistantResponseV2,
  AssistantStreamEvent,
  AssistantResponseV3,
  AssistantStreamEventV3,
  UIActionV3,
} from "@atlas/contracts";
import { useWorkspace } from "../../app/state";
import { assistantAudience } from "../../app/audience";
import type { AtlasApi } from "../../lib/api";
import { ApiFailure } from "../../lib/api";
import { readContract } from "../../lib/validation";
import { packHistory, validateAnswer, type Exchange } from "./protocol";
import { prepareActions } from "./actions";
import { captureWorkspace, contextLabel, type AssistantEnvironment } from './context';

export function useAssistantSession(
  api: AtlasApi,
  articles: readonly Article[],
  investigation?: InvestigationResponse,
  environment?: AssistantEnvironment,
) {
  const useV3 = !!(api.assistantV3 || api.assistantStreamV3);
  const client = useQueryClient();
  useWorkspace(state => state.contextRevision);
  const audience = useWorkspace(state => state.audience);
  const [exchanges, setExchanges] = useState<Exchange[]>([]),
    [draft, setDraft] = useState(""),
    [pending, setPending] = useState(false),
    [status, setStatus] = useState(""),
    [composerError, setComposerError] = useState("");
  const lastPromptId = useRef<string | null>(null);
  const conversationId = useRef<string | null>(null);
  const revision = useRef(0),
    active = useRef<{
      id: string;
      turnId: string;
      controller: AbortController;
    } | null>(null),
    transcript = useRef(exchanges),
    sources = useRef({ articles, investigation, environment });
  transcript.current = exchanges;
  sources.current = { articles, investigation, environment };
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
        if (useV3) return;
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
    [useV3],
  );
  useEffect(() => {
    if (!useV3) cancel("Research context changed. The pending question was cancelled.");
  }, [investigation, useV3]);
  useEffect(
    () => () => {
      active.current?.controller.abort();
      active.current = null;
    },
    [],
  );
  async function submit(retryId?: string, messageOverride?: string) {
    if (active.current || (!api.assistant && !api.assistantStream && !api.assistantV3 && !api.assistantStreamV3)) return;
    const failed = retryId
      ? transcript.current.find(
          (e) =>
            e.id === retryId &&
            (e.status === "failed" || e.response?.mode === "fallback"),
        )
      : undefined;
    if (retryId && !failed) return;
    const message = failed?.question ?? messageOverride ?? draft;
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
        useV3 ? {
          protocol_version: 3, interaction_mode: 'intent', request_id: requestId, turn_id: turnId,
          ...(conversationId.current ? { conversation_id: conversationId.current } : {}),
          message, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', audience: assistantAudience(snapshot.audience),
          workspace: captureWorkspace(snapshot, context.articles, context.environment, !!api.wind),
        } : {
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
                  ...(packed.request.protocol_version === 3 ? { contextLabel: contextLabel(packed.request.workspace) } : {}),
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
              ...(packed.request.protocol_version === 3 ? { contextLabel: contextLabel(packed.request.workspace) } : {}),
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
      (useV3 || useWorkspace.getState().contextRevision === snapshot.contextRevision) &&
      revision.current === conversation &&
      (useV3 || useWorkspace.getState().audience === snapshot.audience);
    const update = (event: AssistantStreamEvent | AssistantStreamEventV3) => {
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
      const response = packed.request.protocol_version === 3
        ? readContract('AssistantResponseV3', await (api.assistantStreamV3
          ? api.assistantStreamV3(packed.request, controller.signal, update)
          : api.assistantV3!(packed.request, controller.signal)))
        : readContract('AssistantResponseV2', await (api.assistantStream
          ? api.assistantStream(packed.request, controller.signal, update)
          : api.assistant!(packed.request, controller.signal)));
      if (!current()) return;
      if (response.request_id !== requestId)
        throw new Error(
          "The assistant returned a mismatched request. No changes were applied.",
        );
      validateAnswer(response);
      if (packed.request.protocol_version === 3 && response.protocol_version === 3 && JSON.stringify(response.context) !== JSON.stringify(packed.request.workspace))
        throw new Error('The answer belongs to a different workspace snapshot.');
      let prepared: Awaited<ReturnType<typeof prepareActions>> | undefined, actionError: string | undefined;
      let stale = useV3 && useWorkspace.getState().contextRevision !== snapshot.contextRevision;
      if (!stale) {
        try {
          prepared = await prepareActions(api, client, response.actions, snapshot, context.articles, context.investigation,
            controller.signal, response.resolved_range, context.environment?.aircraft, useV3);
        } catch (error) {
          if (!useV3) throw error;
          actionError = error instanceof Error ? error.message : 'Workspace targets are unavailable.';
        }
      }
      if (!current()) return;
      stale ||= useV3 && useWorkspace.getState().contextRevision !== snapshot.contextRevision;
      // Retire before the single transaction publishes its context revision.
      active.current = null;
      if (response.protocol_version === 3) conversationId.current = response.conversation_id;
      const applied = !!response.actions.length && !!prepared && !stale && !actionError
        && useWorkspace.getState().commitAssistant(prepared, snapshot.contextRevision);
      setExchanges((previous) =>
        previous.map((e) =>
          e.id === turnId ? { ...e, status: "complete", response, preview: undefined, phase: undefined,
            acceptedRevision: useWorkspace.getState().contextRevision, contextMoved: stale,
            ...(response.actions.length ? { actionsState: applied ? 'applied' as const : actionError ? 'failed' as const : 'stale' as const } : {}),
            ...(actionError ? { actionError } : {}),
          } : e,
        ),
      );
      setPending(false);
      if (applied) {
        setStatus(
          response.actions.map(actionSummary).join(' · '),
        );
      } else setStatus(actionError ?? (stale && response.actions.length ? 'Answer ready for the original view. Workspace changes were held because you moved elsewhere.' : response.mode === 'fallback'
        ? 'The answer could not be completed. Retry the question or use manual search.'
        : response.kind === 'clarification' ? 'Atlas needs a clarification.' : 'Response ready.'));
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
  async function applyActions(actions: readonly UIActionV3[], label: AssistantResponseV3['resolved_range'] = null, exchangeId?: string) {
    if (active.current) return;
    const snapshot = structuredCloneSnapshot(), controller = new AbortController(), id = crypto.randomUUID(), conversation = revision.current;
    active.current = { id, turnId: '', controller }; setPending(true);
    try {
      const prepared = await prepareActions(api, client, actions, snapshot, sources.current.articles, sources.current.investigation,
        controller.signal, label, sources.current.environment?.aircraft, true);
      if (controller.signal.aborted || active.current?.id !== id || revision.current !== conversation || useWorkspace.getState().contextRevision !== snapshot.contextRevision) return;
      active.current = null;
      if (!useWorkspace.getState().commitAssistant(prepared, snapshot.contextRevision)) return;
      if (exchangeId) setExchanges(previous => previous.map(turn => turn.id === exchangeId ? { ...turn, actionsState: 'applied', actionError: undefined } : turn));
      setStatus(actions.map(actionSummary).join(' · '));
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'That workspace change is unavailable.');
    } finally { if (active.current?.id === id) active.current = null; setPending(false); }
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
    useV3,
    contextLabel: useV3 ? contextLabel(captureWorkspace(useWorkspace.getState(), articles, environment, !!api.wind)) : '',
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
    applyActions,
    reply: (text: string) => submit(undefined, text),
    populatePrompt(request: { id: string; text: string }) {
      if (lastPromptId.current !== request.id) {
        lastPromptId.current = request.id;
        setDraft(request.text);
      }
    },
    setAudience(value: typeof audience) {
      if (!useV3) cancel("Perspective changed. The pending question was cancelled.");
      useWorkspace.getState().setAudience(value);
    },
    newConversation() {
      cancel();
      revision.current++;
      conversationId.current = null;
      setExchanges([]);
      transcript.current = [];
      setDraft("");
      setStatus("");
      setComposerError("");
    },
  };
}
function actionSummary(action: UIActionV3): string {
  switch (action.type) {
    case 'set_filters': return 'Updated reporting filters';
    case 'focus_location': return 'Focused a sourced location';
    case 'open_timeline': return 'Opened the historical timeline';
    case 'open_record': return `Opened ${action.record_type}`;
    case 'set_basemap': return `Switched to ${action.basemap}`;
    case 'set_layers': return 'Updated map layers';
    case 'navigate_map': return 'Updated the map view';
  }
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
