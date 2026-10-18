# Audience onboarding and Person 3 handoff

Person 1 frontend scope only: no backend, shared API schema, database, authentication, or provider changes.

## One workspace preference

`frontend/src/app/state.ts` owns `audience`, `onboardingComplete`, `audienceStorageAvailable` and `setAudience`. The former independent assistant/investigation selections now consume that same Zustand state. `frontend/src/app/audience.ts` defines UI labels, suggested questions, section order, local persistence and the explicit API adapter.

The first-visit dialog offers four audiences and Skip for now. Skip/Escape selects `general_public` and completes onboarding. Local storage key `atlas.audience.v1` stores `{audience, onboardingComplete:true}` atomically. Only a valid known audience with completed onboarding bypasses the prompt. Missing/invalid/oversized values start a general-public visit with the prompt. Storage read/write exceptions never block use: completion and selection remain in memory for this visit, with a brief notice; persistence across reloads cannot be promised when storage is blocked.

The workspace Audience control remains available without opening the assistant. Modal/fullscreen panels supply the same control while the map canvas is inert. Existing Perspective selectors also share it. Audience changes only update preference/completion/storage status; filters, viewport/camera command, selection, selected investigation, active panel, and context revision stay untouched. Assistant messages and draft remain mounted. An in-flight response for an older audience is aborted and rejected, preserving completed conversation rather than applying stale actions.

## Exact wire mapping for Person 3

The authoritative `AssistantRequest.audience` currently accepts three values. The frontend does not send unsupported values or introduce a competing API contract:

| Frontend audience | Current API `audience` |
| --- | --- |
| `general_public` | `general_public` |
| `journalist` | `journalist` |
| `community_organization` | `general_public` |
| `investor` | `investor` |

Community organization receives frontend suggestions about documented service access, infrastructure gaps, community impacts and resources, and sees public-impact/resource sections first. Its freeform assistant requests currently use the backend's general-public explanation guidance. No hidden prompt prefix or fabricated evidence is added. Journalist prioritizes research questions/uncertainty; Investor prioritizes documented exposure/uncertainty; General public prioritizes events, public impacts and resources. Every audience retains all supplied sections, facts, sources, timeline and evidence access.

If native community guidance is desired, Person 3 should coordinate with Person 1 to add `community_organization` to the authoritative audience enums (request and embedded model schemas as applicable), server guidance allowlist, and backend validation/cancellation tests. Then Person 1 can remove this one fallback mapping. Retrieval/filter semantics and evidence access must remain unchanged. This frontend delivery does not claim backend-native community guidance.

## Verification

`npm --prefix frontend test -- --maxWorkers=1` and `npm --prefix frontend run build`.

Audience tests cover every initial choice, keyboard focus/escape/shortcut isolation, skip, returning visits, invalid and unavailable storage, changing audiences, shared controls, personalized prompts, section reordering with all original facts retained, explicit community wire mapping, and preservation of filters/viewport/camera/investigation/conversation/draft. Existing assistant tests cover obsolete response rejection and consent. Browser checks exercise the compact prompt and visible workspace control; no new live Gemini calls are required.
