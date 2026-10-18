# Atlas — Final Hackathon Product Requirements Document

Status: Implementation-ready plan; this revision does not start implementation.
Team: 3 or 4 people. Build window: approximately 36 hours, subject to confirmed event rules.
Primary theme: AI for Social Impact.
Sponsor targets: Gemini API, Tiger Data, Vultr, GoDaddy Registry.
Optional challenge: School of Cities, only with a complete Toronto civic investigation.
Budget: Verified free allowances and hackathon credits; no assumed unlimited access or paid upgrades.

## 1. Product

Atlas is an interactive geographic news and evidence workspace for the general public, journalists, community organizations, and investors.

**Pitch:** Explore what is happening in the world, understand where it matters, and investigate the evidence.

**Core flow:** Ask or explore → filter map and news → zoom into a place → inspect sources and changes → understand implications → save an investigation.

Public understanding anchors the demo. Journalists get sources, timelines, and unanswered questions; investors additionally get documented sector/company exposure. One shared workspace serves all audiences through suggested questions, without separate products.

### Problem and value

A headline tells people that something happened, but often leaves them to find the location, related reporting, historical context, and affected communities themselves. Those pieces are spread across news sites, maps, public datasets, and company disclosures. Atlas puts them into one navigable investigation.

A user should leave with a clearer understanding of what is known, where it happened, who may be affected, and which source to read next. Atlas supports discovery and research; it does not establish causality from proximity or replace original reporting.

### Audiences

| Audience | Main question | Useful output |
| --- | --- | --- |
| General public | What is happening near me, and why does it matter? | Plain-language overview, geographic context, dates, and verified resources. |
| Journalists | What is the timeline, what evidence exists, and what is missing? | Related reports, source trail, observation comparisons, and open research questions. |
| Community organizations | Which places face service gaps or infrastructure changes? | Sourced indicators, place comparisons, limitations, and a briefing to inform further research. |
| Investors | Which sectors or businesses have documented exposure? | Source-backed relationships and research hypotheses alongside community effects. |

Audience selection changes suggested prompts and the order of explanatory sections, not the underlying evidence or facts. Users can switch perspective without losing their place.

### Example investigation

A hypothetical flood investigation starts with verified reporting about an affected region. The user sees the event boundary, related articles, a dated environmental observation, and documented infrastructure locations. Zooming reveals the street and facility context; the assistant explains the reported disruption and distinguishes confirmed effects from unanswered questions. If an affected company operates a facility there, that relationship appears only with a supporting source.

This is a story pattern, not a claim about a specific event. Select the final demonstration based on available reporting and usable data.

## 2. MVP

| Feature | Required behavior |
| --- | --- |
| Custom globe | Original Atlas styling using Mapbox GL JS: dark ocean, restrained land detail, subtle atmosphere, clustered news markers, and selection highlights. |
| Globe-to-street exploration | Pan, wheel/pinch/button zoom, and smooth camera flights from globe to local detail. Maintain one Mapbox engine and shared camera/selection state. |
| Satellite exploration | At a configurable local zoom threshold, switch to satellite imagery with street labels. Provide Map/Satellite/Auto controls; manual choice persists until Auto is restored. |
| Precise locations | Click to inspect coordinates; display source-backed facility/address pins when available. City/region-level events retain broad geometry and an explicit precision label. |
| Flight tracking | Toggle a near-real-time aircraft overlay for a bounded region; select an aircraft for available callsign, position, altitude, speed, heading, source, and observation age. |
| News discovery | Synchronized map/feed with geography, issue, keyword, entity, and publication-date filters. Show source links, dates, coverage, and last refresh. |
| AI side panel | Gemini interprets requests, filters news, focuses places, and explains retrieved evidence with validated citations. |
| Investigation | What happened, where/when, public impacts, evidence, relevant resources where verified, journalist questions, optional business exposure, and uncertainties. |
| Historical comparison | A real Tiger Data-backed observation series powers a visible time-filtered chart or comparison with units and source links. |
| Evidence imagery | One useful dated satellite comparison if feasible; otherwise one dated observation with a narrower explanation. |
| Saving | Saved investigation IDs persist in browser storage. |
| Deployment | Working Vultr HTTPS deployment with an eligible GoDaddy Registry domain, subject to account/offer activation. |

**Satellite distinction:** Mapbox satellite imagery is exploration context, not live imagery or proof of when an event occurred. Buildings and roads can be visually inspected where source resolution permits; automatic building recognition and parcel ownership are outside scope. Show imagery attribution and do not invent acquisition dates. Dated evidence imagery has separate observation dates, source metadata, bounds, and limitations.

## 3. Interface and globe design

- Center: Mapbox globe/map, event markers, selected region, and optional evidence layers.
- Left: news feed, search results, and saved investigations.
- Right: collapsible assistant and investigation tabs; source links stay accessible.
- Top: search, filters, and Map/Satellite/Auto controls.
- Bottom: timeline, observation dates, comparison controls, and legends.

Create a distinctive Atlas design using atmosphere, typography, event markers, selection halos, and a restrained coordinate frame. Use [21st.dev globe references](https://21st.dev/?qt=globe) for inspiration; inspect actual source, licensing, and dependencies before reusing code. Keep Mapbox as the sole geographic renderer rather than adding a separate decorative globe engine.

Stop idle rotation on interaction; honor reduced motion. Keep attribution, contrast, keyboard controls, and smaller-screen layouts usable. Switching basemap styles must restore custom sources/layers and preserve filters, selection, and camera. Test globe/local rendering of evidence layers early.

### Product parts

| Part | What the user sees and does | Connection to other parts |
| --- | --- | --- |
| Globe/map | Explore countries, regions, neighbourhoods, and supported facility locations; select markers and boundaries. | Uses the same filtered article/location IDs as the feed; selection opens research context. |
| News feed | Scan headline, publisher, publication date, issue tag, and location precision; open original sources. | Selecting a story focuses the map and offers a curated investigation when one exists. |
| Search and filters | Search known places, issues, and entities; combine date/geography/theme filters; clear individual chips. | Manual and assistant requests update one canonical filter state. |
| Assistant | Ask follow-up questions, request filters, inspect citations, and follow suggested research questions. | Receives current selection and retrieves records through the backend; returns explicit map/filter actions. |
| Investigation panel | Read a structured brief with evidence, implications, resources, and uncertainty. | Resolves linked articles, locations, observations, and optional company relationships. |
| Timeline | Inspect a supported metric over time, hover for values, and choose a period. | Queries real observations; observation filters remain distinct from news publication dates. |
| Evidence viewer | Toggle dated imagery, read legend/limitations, and compare available periods. | Uses verified evidence metadata; independent of the everyday satellite basemap. |
| Source cards | Open original reporting/data and inspect dates and what each source supports. | Shared by assistant citations and investigation sections. |
| Saved collection | Save and reopen curated investigations after refresh. | Stores IDs locally; no account or cloud synchronization required. |

### Main user journey

1. **Arrive:** the custom globe opens around North America with a populated feed, dataset freshness, and clear coverage. No sign-in or location permission is required.
2. **Choose an entry point:** browse a headline, search a known place, click a marker, or ask the assistant. Suggested prompts explain what the available data can answer.
3. **Narrow the view:** a request such as “Show flooding reports in Ontario this month” produces visible filter chips, a matching result count, and synchronized map/feed results. No matches means an honest empty state with ways to broaden the search.
4. **Select a story:** the map flies to its supported geographic extent and highlights the selection. A regional event fits its boundary; it does not zoom to an invented street address.
5. **Explore local context:** zoom into satellite-with-labels imagery and inspect streets, buildings, or verified facilities. A bare map click shows coordinates and any linked records; it does not imply Atlas knows that building's identity.
6. **Investigate:** open a curated brief if available. For an ordinary article without one, show the article's source/context and clearly indicate that a deeper investigation has not been prepared.
7. **Inspect changes:** open the supported historical series or dated imagery. Read values, units, periods, attribution, and missing-data notices before interpreting the comparison.
8. **Ask a follow-up:** “Who is affected?” uses the selected investigation as context. The assistant links claims to sources and states what cannot be established.
9. **Change perspective:** try journalist or investor prompts on the same evidence. Neither mode adds unsupported facts.
10. **Save or continue:** save the investigation, open an original source, clear filters, or return to the global view. Back-to-globe resets camera extent without silently clearing the user's filters.

### Alternative journeys

**Journalist:** search a region → filter a topic and publication period → inspect related coverage → compare dated observations → ask what is confirmed versus missing → open original sources. Suggested questions are research leads, not verified new findings.

**Investor:** select an event → inspect infrastructure and documented company relationships → read sector exposure hypotheses → check sources and uncertainties. Atlas provides no buy/sell action or predicted stock movement.

**Toronto civic user, optional:** select a neighbourhood → inspect supported development/service records → compare available indicators → ask for a sourced neighbourhood briefing. Show the dates and geographic units of each dataset; do not infer service capacity from facility counts alone.

## 4. Clear stack

| Layer | Choice | Responsibility |
| --- | --- | --- |
| Frontend | React + TypeScript + Vite | Workspace, feed, assistant, timeline, shared state, and local saves. |
| Geographic rendering | Mapbox GL JS | Globe, local zoom, satellite-with-labels style, clustering, location pins, camera navigation, and evidence overlays. |
| Backend | Node.js + TypeScript + Fastify | Validated REST API, Gemini tools, news ingestion, database queries, caching, and limits. |
| AI | Gemini API via official Google Gen AI SDK | Structured tool requests and evidence-backed explanations; model ID configured through environment. |
| Database | Tiger Cloud PostgreSQL + TimescaleDB + pgvector; `pg` client | Relational research records and genuine time-series observations with SQL aggregation. |
| Hosting | Vultr VM + Caddy | Serve frontend build, reverse-proxy API, and terminate HTTPS. Tiger Cloud hosts the database. |
| Domain | Eligible GoDaddy Registry offer | Public domain and DNS pointing to Vultr. |
| Data | Verified RSS/API sources, public indicators, curated fixtures; NASA GIBS/Worldview candidate imagery | Source-linked reporting, temporal observations, and dated geographic evidence. |

Verify service quotas, credits, licenses, imagery compatibility, and domain eligibility before committing resources. Provider/model versions are pinned during setup. Secret keys and database credentials stay server-side; only a minimal-scope, URL-restricted public Mapbox token goes into the browser.

### Service responsibilities

**Mapbox:** the browser requests map styles and geographic tiles using the restricted public token. Mapbox supplies navigation and basemap imagery; Atlas supplies its own event markers, evidence metadata, and research content. The selected styles must support both globe exploration and local satellite detail.

**Gemini:** the backend sends a bounded question/context and tool definitions. Gemini proposes retrieval or workspace actions and writes an explanation from returned records. It does not independently supply the news corpus, verify source truth, or identify an arbitrary building from satellite imagery in the MVP.

**Tiger Data:** the durable store for curated/imported records and observations. Relational links connect stories, places, investigations, and sources; time-series storage and aggregation serve the timeline. Frontend clients never connect directly to the database.

**Vultr:** runs the application server and serves the built frontend through Caddy. Caddy routes `/api` to Fastify and serves the frontend for application routes. A process supervisor restarts the backend; deployment instructions include health checks and required environment variables.

**GoDaddy Registry domain:** gives users a public address for the deployed product. Configure DNS to Vultr and HTTPS through Caddy; registration alone does not host the application. Confirm eligible offer/domain details before purchase or activation.

**News/data providers:** supply permitted reporting metadata and real observations for import. A small adapter normalizes fields and records provenance. Provider outages do not erase imported records; the UI shows the last successful refresh.

**NASA imagery, if selected:** supplies dated geographic evidence after checking the layer, period, resolution, access terms, and rendering compatibility. It is independent of Mapbox's ordinary satellite basemap.

**21st.dev:** a design/component reference, not a required runtime service. Any reused component must fit the existing React/Mapbox architecture and have a reviewed license.

### Database decision: PostgreSQL with vector search

Use **Tiger Cloud PostgreSQL + TimescaleDB + pgvector** as the single database platform. Do not add MongoDB, Firestore, Pinecone, or another separate database for the MVP. Vector search is a retrieval capability, while NoSQL describes a broader database category; they are not direct substitutes.

- Relational tables hold articles, locations, sources, investigations, and their verified relationships.
- TimescaleDB hypertables hold permitted aircraft samples and environmental/civic observations.
- pgvector holds embeddings for permitted article excerpts and investigation passages, enabling meaning-based retrieval for the assistant.
- PostgreSQL JSONB can retain bounded provider-specific metadata without introducing a document database.

**Retrieval flow:** import permitted text → attach source/chunk IDs and dates → generate embeddings with a configured, available embedding model → store vectors/model version/content hash → embed the user question → apply supported location/date/theme constraints → rank relevant passages → send a small cited evidence set to Gemini. Pair semantic matching with PostgreSQL keyword/full-text retrieval for names, callsigns, and exact terms. Strict filters remain authoritative; semantic similarity must never move results outside the requested region or time range.

Select the embedding model, dimensions, and quota after account verification; use the same model/version for indexed text and queries. Re-embed changed passages, retain original source text, and keep all embedding calls server-side. Start with exact vector search for the small hackathon corpus; add approximate indexes only if justified by measured query needs. Cite original sources, not embeddings or similarity scores.

Person 3 owns embedding generation and retrieval; the database owner supplies extension/schema migrations. Verify pgvector availability on the selected Tiger Cloud service during setup. If embeddings are unavailable, use the existing structured/keyword retrieval and disclose that semantic search is disabled. Core filters and cited explanations must still work.

References: [Tiger Data vector integration](https://www.tigerdata.com/docs), [pgvector documentation](https://github.com/pgvector/pgvector).

## 5. How everything fits together

```text
News/public-data imports → backend normalization → Tiger Data
Browser filters → backend SQL → matching news, markers, and observations
Assistant question → backend Gemini tools → same validated query functions
Retrieved records → Gemini cited answer + validated UI actions
UI actions → shared frontend state → map, feed, and timeline update together
Browser → project domain → Caddy on Vultr → frontend + /api
```

The frontend owns selection, filters, camera requests, active layers, audience suggestions, and saved IDs. The backend owns retrieval, validation, database access, ingestion, and AI orchestration. The model proposes tool calls; application code validates and executes them.

### Repository boundaries

```text
frontend/src/app/             shell, shared state, integration
frontend/src/features/map/   Mapbox rendering and camera controls
frontend/src/features/feed/  news feed and filters
frontend/src/features/ai/    assistant UI
frontend/src/features/research/ investigation and timeline UI
backend/src/routes/          HTTP endpoints
backend/src/services/        Gemini, retrieval, validation
backend/src/data/            database queries and ingestion
contracts/                   shared schemas/types and API examples
db/                         SQL migrations and seed/import definitions
scripts/                     import and startup commands
infra/                       Vultr/Caddy deployment configuration
```

API contracts and shared dependencies change through the integration owner. Agree on schemas and provide fixture responses before independent implementation; integrate one complete journey early.

### Shared records

| Record | Essential fields |
| --- | --- |
| Article | ID, title, publisher, URL, permitted excerpt, published/retrieved timestamps, optional event date, location/entity IDs, themes. |
| Location | ID, name, longitude/latitude, optional boundary, precision: address/facility/city/region. |
| Investigation | ID, title, location/article/evidence IDs, public impacts, resources, research questions, optional sourced business exposure, uncertainties. |
| Evidence | ID, type, source URL, observation period, description, limitations; imagery adds bounds, asset/layer reference, legend, attribution. |
| Observation | ID, location ID, metric, observed timestamp, value, unit, source ID, retrieval timestamp. |
| Filters | Location IDs or bounds, themes, entity IDs, keyword, publication range; observation range is separate. |
| Assistant response | Answer, validated source citations, result IDs, validated UI actions, coverage, mode: live/fallback, and errors. |

Use longitude–latitude ordering, UTC timestamps, explicit nulls, and stable IDs. Distinguish event time, publication time, and observation time.

### API

- `GET /api/news`: validated filters → matching records and coverage metadata.
- `GET /api/locations`: search/IDs → locations, bounds, and precision.
- `GET /api/investigations/:id`: resolved investigation and sources.
- `GET /api/observations`: location/metric/time range → observations or disclosed time buckets.
- `POST /api/assistant`: message, bounded context, filters, selection, timezone → answer, citations, and UI actions.
- `GET /api/health`: service readiness without exposing secrets.

Use shared schemas for inputs/outputs and consistent error shapes. Parameterize SQL; cap date ranges, row counts, tool calls, and request volume.

## 6. Gemini assistant

The assistant is a research partner connected to the workspace. It helps users navigate the available information, understand sources, and identify unanswered questions. It must perform useful actions beyond general conversation.

### Capabilities and tools

| User request | Tool/function | Visible result |
| --- | --- | --- |
| “Show Ontario flooding news this month.” | `search_news`, `set_filters` | Matching stories, result count, and visible geography/topic/date chips. |
| “Zoom to this facility.” | `focus_location` | Camera moves to a known location ID at its supported precision. |
| “Explain this event.” | `get_investigation` | Cited summary of retrieved facts, public impacts, and uncertainty. |
| “What changed here over time?” | `compare_observations` | Supported metric/time comparison and linked timeline. |
| “What should a journalist investigate next?” | `get_investigation` and related retrieval | Questions grounded in evidence gaps, explicitly labeled as research suggestions. |

All tools are allowlisted and use the same validated query/filter functions as manual controls. `set_filters` proposes a complete validated filter patch; `focus_location` uses known IDs/bounds. Read-only questions must not change filters unexpectedly. Show applied actions in the conversation and let users clear their chips or restore previous filters.

### Request lifecycle

1. The frontend sends the message, audience/timezone, bounded history and a captured workspace: viewport, actual filters, selected IDs, originating panel/tab, ordered displayed results, layers and exact timeline range.
2. The backend checks request size and limits; Gemini interprets the task in one bounded research/tool loop. Research scope can differ from screen filters. Clear display/navigation intent stages relevant validated actions without a command-word gate.
3. Application code validates tool names/arguments and executes parameterized retrieval. Unsupported locations, metrics, dates, or IDs produce a controlled result rather than invented data.
4. Retrieved records include source IDs, permitted excerpts, dates, units, and coverage. Numerical differences are computed by application/database code before explanation.
5. Gemini composes a short answer from these records and proposes any supported UI actions.
6. The backend validates response shape, source references, and actions before returning them. Citation-ID validation checks provenance, not truth; curated sources and review remain necessary.
7. The frontend displays the answer, source cards, and action summary; validated actions update the shared reducer so map/feed/timeline remain consistent.

Use bounded tool iterations and result sizes; no autonomous browsing, arbitrary URL fetching, generated SQL, or code execution. Treat retrieved text as evidence, never as instructions. Cache suitable repeated retrievals and make any answer caching sensitive to context/data version.

### Answer format

- **Answer:** direct, plain-language response to the question.
- **Evidence:** claim-linked source citations with publication/observation dates.
- **What remains unclear:** missing records, limited coverage, conflicting reports, or untested hypotheses.
- **Next step:** optional supported follow-up, such as opening a source or comparing another available period.

For filtering requests, the action summary and result count can replace a lengthy explanation. Do not force every answer into a large template.

### Context, freshness, and limitations

“Here” and “this area” mean the visible viewport when the question was submitted, even when an older story remains selected. “This story” uses the selected article; “these results” uses the ordered displayed IDs; conversational references use the ordered response ledger. New subjects replace unrelated research restrictions without changing screen filters unless display/navigation is requested. Ask a specific question only when ambiguity prevents useful progress. Short replies can resolve the one current pending clarification/proposal. Resolve relative dates using the user's timezone and show the resulting range. News publication dates and observation periods remain separate.

Gemini is not the news provider and must not invent current reporting from model memory. When data is sparse, explain the coverage and offer a broader supported query. Separate reported facts, observed measurements, and research hypotheses; proximity alone does not prove impact or causality.

### Failure behavior

Show pending, cancelled, unavailable, and quota-exhausted states with retry/manual options. Browsing preserves answers against their captured context; stale actions require explicit revalidation/application. Stop, New conversation, disconnect and deadlines cancel generation. Manual controls remain functional. Prepared fallback answers are visibly labeled and do not count as live Gemini use. Keep transcript text in browser memory for the visit; server continuation stores only six turns of references/scope and one expiring task. Do not persist chat history or include credentials in prompts/logs.

## 7. Data and content

Build one exceptional investigation before expanding to approximately 30–50 verified news records and up to three investigations. Global navigation works; analytical coverage is explicitly limited, with deeper North American coverage.

- Use permitted RSS/API content and curated imports; retain source links and permitted excerpts rather than full articles.
- Normalize, deduplicate, and manually verify demo locations. Publisher headquarters are not event coordinates.
- A manual refresh/import is sufficient; scheduled ingestion is stretch.
- Store research records in relational tables and real indicator observations in a TimescaleDB hypertable.
- Implement one meaningful time-bucketed continuous aggregate for the visible timeline; preserve raw records, disclose bucket size, and document refresh behavior.
- Choose a real environmental/civic series with sufficient observations. Do not invent history or silently interpolate gaps.
- Reporting volume measures coverage, not incident frequency or investment opportunity.
- Satellite comparisons need aligned bounds, verified observation dates, legends, and useful resolution. Basemap appearance alone does not quantify damage or economic effects.
- Company exposure requires a source; distinguish direct exposure from broad sector association. No stock-return predictions.

**Optional Toronto investigation:** Help a resident or community organization understand nearby development alongside transit and service access. Use linked Toronto civic datasets and deliver a usable comparison or briefing. Pursue School of Cities only when this flow is complete; do not build a separate product.

### Fresh news and data pipeline

Use GDELT DOC search as the initial free news-discovery source, supplemented by explicitly permitted publisher RSS feeds and verified curated records. GDELT access does not grant rights to republish publishers' full articles or images. Store titles, URLs, provider timestamps, and permitted excerpts only; distinguish provider discovery time from verified publication time. If only a title is available, do not present a generated summary as though the full article was read.

A backend ingestion job fetches a small configured set of issue/region queries, normalizes fields, deduplicates URLs, maps locations to known records, and upserts into Tiger Data. Start with manual refresh; enable a conservative 15–30-minute scheduled refresh after verifying endpoint behavior and provider guidance. This interval is an Atlas target, not a provider freshness guarantee. Browser queries read our database, not the external provider directly. Cache shared results, back off on failures/429s, and show last successful ingestion separately from source publication dates.

Geo references extracted from reporting are candidates until verified. Ambiguous locations remain broad/unlocated instead of receiving false pins. Curated demo records have manually verified location precision. New unreviewed records display their verification status. Date filters must disclose which timestamp is available.

Public civic/environmental observations are imported from selected openly licensed datasets at their actual publication cadence; these are not assumed live. Dated imagery updates only when a suitable new observation exists. Maintain provenance and a per-source freshness display.

### Flight tracking

**Purpose:** give users geographic context for air traffic around a selected region or airport. It is an exploration layer within Atlas, not a separate flight-booking product or proof of disruption. No aircraft-to-news relationship is inferred solely from proximity.

**Planned provider:** [ADSB.lol public API](https://api.adsb.lol/docs), which describes its API/data as free and licensed under ODbL. Verify current endpoints, coverage, attribution, redistribution/storage obligations, and acceptable polling before launch. Keep provider flight records in a separate dataset/schema with provenance and license notices. Preserve applicable attribution and share-alike obligations when publishing a derived database; do not assume a free endpoint means unrestricted redistribution.

User flow:

1. Enable Flights from layer controls; select a supported region or bounded area. At global zoom, prompt the user to choose a region instead of fetching the whole world.
2. Show aircraft symbols rotated by reported heading, with a capped visible count and timestamp/coverage indicator.
3. Select an aircraft to inspect available callsign/identifier, last observed position, altitude, ground speed, heading, and observation age. Units and missing values are explicit.
4. Optionally follow the selected aircraft with the camera; manual pan/zoom exits follow mode. Store aircraft selection separately from the selected investigation.
5. Ask “Show aircraft in this area” or “Find this callsign in the available feed.” Gemini uses validated flight tools and does not invent routes or operational status.

The backend adapter polls one shared bounded region/profile on demand and caches it for all users. Target 30–60-second refresh only if allowed; pause polling without active viewers, cap active regions, debounce viewport changes, and respect actual rate limits. Show observed time, fetched time, and stale state. Smooth movement between known samples only; no fabricated positions or indefinite extrapolation. Hide/mark old positions after a configurable threshold and break trails across long gaps.

Use a dedicated `AircraftState` record: provider, aircraft ID, optional callsign, longitude/latitude, altitude with reference/unit, speed/unit, heading, observed timestamp, fetched timestamp, and source/license. Add `GET /api/flights?region_id=...` (or validated bounded-area parameters) and allowlisted Gemini tools `get_aircraft_in_region` / `find_aircraft`. All provider requests are server-side. Store only a short permitted sample history in a separate TimescaleDB hypertable if needed for the selected-aircraft trail; enforce retention. The civic/environmental timeline remains the core historical evidence feature.

**Limits:** receiver coverage varies; empty results do not prove empty airspace. Callsigns may be missing and are not guaranteed scheduled flight numbers. Confirmed departure/destination, gates, tickets, delays, cancellations, passenger information, emissions calculations, and global historical replay are outside scope unless separately sourced and implemented. Do not infer emergency or safety status from a position feed.

**Fallback:** show a clearly labeled licensed recorded replay or disable the unavailable layer with a useful explanation. Never label recorded positions live. Flights are a required bounded overlay in the intended build; advanced trails/follow controls are cut before the core research workflow if time is tight.

**Ownership:** Person 2 owns flight rendering and controls. Person 3 owns flight API/cache and Gemini tools. Person 4 (or Person 3 for three people) owns any flight storage/retention and provider setup; content owner checks attribution. Agree on `AircraftState` before implementation.

### Free-access and budget expectations

| Data/service | Plan | Limit or dependency |
| --- | --- | --- |
| Fresh news | Free GDELT discovery + permitted RSS; curated backup. | Availability/coverage vary; publisher content rights remain separate. |
| Aircraft positions | Free ADSB.lol API, subject to its ODbL terms and current usage policy. | Regional scope, caching, source attribution, and partial receiver coverage; not guaranteed operational flight-status data. |
| Civic/environmental data | Selected public/open datasets. | Verify each license, geographic precision, and release cadence. |
| Dated satellite evidence | Candidate NASA GIBS/Worldview layers. | Validate suitable dates, resolution, access, attribution, and alignment. |
| Mapbox, Gemini, Tiger Cloud | Verified available allowances, trials, or event offers. | Quotas and account requirements apply; do not describe the whole stack as free forever. |
| Vultr and domain | Verified event credits/offer. | Activation, credit expiry, eligible domain, and potential ongoing costs must be confirmed. |

OpenSky is not the default: its current terms require prior written agreement for operational REST integration into a live product, even for non-profit use. Do not substitute it without resolving that requirement. No paid flight/news subscription is assumed in this plan.

## 8. Ownership: four-person team

| Person | Owns | Deliverables and handoff |
| --- | --- | --- |
| 1 — Frontend and integration lead | `frontend/src/app/`, feed/AI/research UI, frontend dependencies, `contracts/` | Freeze schemas with Person 3; shared state and panel slots; render API responses; integrate full journey, saving, and accessibility. |
| 2 — Map and visuals | `frontend/src/features/map/` | Custom Mapbox globe, zoom, satellite transition/toggle, clusters, pins, precision display, evidence overlays, and camera actions. Consumes shared records/state; emits selection events. |
| 3 — Backend and Gemini | `backend/`, backend dependencies | API scaffolding, schema validation, shared retrieval functions, Gemini tools/citations, ingestion execution, database connections, and recoverable errors. Uses Person 4’s migrations/import definitions. |
| 4 — Data, evidence, deployment | `db/`, import definitions in `scripts/`, `infra/`, evidence assets | Verify stories/sources; Tiger Data migrations and temporal aggregate; prepare imagery metadata; Vultr deployment, HTTPS, domain setup, and demo verification. Coordinate query contracts with Person 3. |

Person 1 owns integration and resolves shared-file changes. Person 3 owns backend scaffolding. Person 4 supplies a minimal seed dataset immediately so other work does not wait for final research. Each person verifies their handoff with its consumer.

## 9. Ownership: three-person team

| Person | Owns | Deliverables and handoff |
| --- | --- | --- |
| 1 — Frontend and integration lead | Same frontend/contracts ownership as above | Shell, feed, assistant/research/timeline UI, shared state, saving, and end-to-end integration. |
| 2 — Map, evidence, and content | Map feature, evidence assets, curated source/import definitions | Globe and satellite navigation, location verification, one sourced investigation, and imagery preparation. Supplies typed fixtures and metadata early. |
| 3 — Backend, Gemini, database, deployment | Backend, `db/`, import execution scripts, `infra/` | API, Gemini tools, Tiger Data queries/aggregate, Vultr/HTTPS/domain deployment. Establish minimal live integrations before expanding features. |

For three people, target one complete investigation and one indicator series first. Person 1 assists with deployment verification and submission; Person 2 supplies data rather than changing backend interfaces. Keep file ownership explicit when sharing a checkout.

## 10. Delivery and scope control

1. **Foundation:** confirm accounts/allowances, repository compatibility, Mapbox satellite/evidence feasibility, shared contracts, and seed records.
2. **First vertical slice:** one story loads from Tiger Data, appears on map/feed, opens an investigation, and gets a real cited Gemini answer.
3. **Geographic detail:** satellite transition, manual toggle, precise pins, and dated evidence.
4. **Temporal evidence and deployment:** real timeline/aggregate, Vultr HTTPS, domain, and failure states. Begin deployment setup early; do not leave accounts/DNS to the end.
5. **Refinement:** verify sources, accessibility, live integrations, rehearsed demo, and submission.

Cut order: decorative animation/terrain/arcs → extra stories → scheduled ingestion → optional Toronto scope → second dated image if evidence is unsuitable. Preserve the real Gemini/Tiger Data flow, Mapbox satellite exploration, and one useful investigation.

Out of scope: trading, brokerage, return predictions, unrestricted AI/web agents, automated worldwide satellite analysis, automatic building recognition, authentication, cloud-synced saves, and a second globe renderer.

## 11. Acceptance and demo

Flight/data checks: bounded flight requests are shared/cached, aircraft selection preserves investigation context, units and timestamps are correct, stale/replay states are visible, polling backs off, and no unsupported route/status claims appear. Fresh-news imports deduplicate records, preserve timestamp meaning, and retain existing content during provider failures.

Required checks:

- Manual and assistant filters return the same records and synchronize map/feed/timeline.
- Globe-to-local zoom works; Map/Satellite/Auto behaves predictably and preserves layers/state.
- Facility pins are source-backed; broad stories do not gain false building-level precision.
- A real Gemini call produces valid citations and controlled UI actions; invalid actions/citations are rejected.
- Real Tiger Data queries drive the timeline with correct units, periods, and aggregation.
- Source links, observation dates, imagery alignment, attribution, and limitations are verified.
- Saved investigations survive refresh; keyboard controls and reduced motion work.
- API, news, imagery, and quota failures have clear states. Prepared fallback content is labeled.
- The Vultr HTTPS deployment completes the core journey; domain resolves when activated.
- README includes setup, migrations/imports, environment variable names, actual integration evidence, and credits/licenses. Never include credentials.

**Demo:** Ask Gemini about a verified issue → map/feed filter together → fly into satellite street detail → inspect a correctly located pin → open evidence and historical comparison → get a cited public-impact explanation → show journalist/investor questions → save.

Submit only for sponsor categories with genuine implemented integrations. A prototype demonstrates a mechanism, not proven societal or environmental outcomes.

## 12. Sponsor tracks and submission plan

The same Atlas workflow supports the selected tracks. Sponsor technologies must power working features in the submitted build; a logo, planned integration, or fallback fixture alone is insufficient evidence of their use. Verify any additional sponsor-specific submission requirements before final entry.

| Track | Integration and product value | What judges see | Completion evidence / owner |
| --- | --- | --- | --- |
| **AI for Social Impact — primary theme** | Public users investigate local changes, climate risks, and infrastructure/service gaps through accessible, evidence-backed explanations. Gemini connects questions to actual records and sources. | A public-impact question filters a place, opens evidence, and returns a cited explanation with limitations and relevant resources where verified. | One complete public-facing investigation; source trail; keyboard/readability checks; document the intended benefit without claiming measured societal outcomes. Persons 1 + 3; content owner supports. |
| **Best Use of Gemini API** | Real server-side Gemini calls interpret questions, call validated retrieval/navigation tools, and synthesize cited answers. Both natural-language filtering and contextual explanation are required. | Ask a question, watch map/feed update, then ask a follow-up grounded in the selected evidence. Inspect citations and applied actions. | Document configured model and SDK, tool schemas, real request success, and failure handling without exposing secrets. Person 3. |
| **Best Use of Tiger Data** | Tiger Cloud PostgreSQL stores linked research records; TimescaleDB stores real observations. A justified continuous aggregate powers a visible historical timeline alongside raw evidence. | Change location/time range and inspect a database-backed chart; drill into values, units, dates, and sources. | Migrations, real imported dataset, hypertable/aggregate definitions, refresh instructions, and reproducible queries. Report performance only if measured. Person 4 on a four-person team; Person 3 on a three-person team. |
| **Best Use of Vultr** | A Vultr VM runs the actual application/backend; Caddy serves the frontend and HTTPS API. The deployed service connects to Gemini and Tiger Cloud. | Open the public deployment and complete the investigation flow on the hosted build. | Document deployment architecture, startup/restart procedure, health endpoint, and actual Vultr resource used. Hosting is the baseline integration; prize competitiveness depends on execution and sponsor criteria. Person 4 / Person 3. |
| **Best Domain Name from GoDaddy Registry** | Register an eligible domain through the event offer, configure DNS to Vultr, and serve Atlas over HTTPS at that address. | A memorable Atlas-related domain opens the working product. | Verify offer eligibility, registration, DNS, and HTTPS; state the actual domain in Devpost. An existing unrelated domain or merely planned registration is not sufficient. Person 4 / Person 3. |
| **School of Cities — optional** | A Toronto civic investigation uses linked civic datasets to help a defined resident/community user understand development, transit, or access to services. | Select a Toronto neighbourhood, inspect actual civic records, and generate a grounded comparison/briefing useful for civic understanding during the municipal-election context. | Identify user, problem, decision, dataset links, geographic units, dates, and limitations. Enter only if the full useful workflow is implemented; no candidate support or election prediction. Content owner + Persons 1 and 3. |

For a three-person team, “content owner” is Person 2; for four people it is Person 4. Person 1 owns the final Devpost entry and confirms the selected categories with the team.

### Submission package

Prepare one project entry containing:

- Product description, target users, problem, and implemented features.
- Repository link with setup, service configuration, licenses, data sources, and architecture.
- A short track-by-track explanation of the actual Gemini, Tiger Data, Vultr, and eligible domain integrations.
- Public HTTPS URL and a rehearsed demo showing the complete workflow.
- Clear labels for historical replay, prepared fixtures, limited geographic coverage, and unavailable features.
- Optional Toronto section only when the School of Cities use case is complete.

Confirm category choices in the initial submission by the event's required cutoff. Verify final deadlines and any separate sponsor forms with organizers; do not treat conflicting published schedules as resolved. Demo recording is a useful backup even if optional.

### Final release gates

The core release requires a working Mapbox globe/satellite experience, one sourced investigation, live Gemini filtering/explanation, a real Tiger Data timeline, and the Vultr deployment. The eligible domain must resolve before claiming the GoDaddy track. School of Cities remains conditional and must not delay the core release.

If a sponsor service is unavailable, retain a clearly labeled usable fallback, disclose the limitation, and remove unsupported integration claims from the submission. Accounts, credits, DNS activation, and provider access are external dependencies until verified; this PRD specifies the final intended build rather than asserting those steps are complete.

## 13. References and unresolved setup

- [Mapbox globe/atmosphere](https://docs.mapbox.com/mapbox-gl-js/guides/globe/), [styles](https://docs.mapbox.com/mapbox-gl-js/guides/styles/), and [pricing](https://www.mapbox.com/pricing).
- [21st.dev globe inspiration](https://21st.dev/?qt=globe); component reuse requires source/license review.
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling).
- [Tiger Data documentation](https://www.tigerdata.com/docs) and [continuous aggregates](https://www.tigerdata.com/docs/learn/continuous-aggregates).
- [Vultr documentation](https://docs.vultr.com/) and [GoDaddy Registry challenge offer](https://mlh.link/GoDaddyRegistry).
- [NASA Worldview](https://worldview.earthdata.nasa.gov/) for candidate dated imagery.
- [GDELT data and APIs](https://gdeltproject.org/data.html) and [DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) for free news discovery.
- [ADSB.lol API](https://api.adsb.lol/docs) and [open-data documentation](https://www.adsb.lol/docs/open-data/api/) for flight positions and licensing.
- [OpenSky terms](https://opensky-network.org/about/terms-of-use): live-product permission requirement; not the default provider.

Still to confirm: actual account access/credits, eligible domain, news provider terms, final story/data/imagery selection, model/library versions, and official coding/submission times. These are setup decisions, not completed integrations.
