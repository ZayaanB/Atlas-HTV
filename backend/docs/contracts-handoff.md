# Required Person 1 contract handoff

Status: **proposal awaiting Person 1 integration**. `contracts/` remains the sole domain schema/type authority. No production domain schemas or fixtures have been created under backend. `Data` in backend code is an opaque integration payload, not an independently defined Article/Location/etc. type. Test-only minimal protocol validators exercise behavior and must not be used as shared schemas or runtime seed data.

Supply a reviewed module under `contracts/` exporting `schemas: Record<string, JSONSchema>` (draft-07, Ajv strict, ajv-formats supported). Set `ATLAS_CONTRACTS_MODULE` to its repository-relative `.mjs`/built `.js` path. It must work in development and built production. Each schema name below is registered once and may reference another name or unique `$id`. Prefer closed objects, bounded strings/arrays, explicit nullability, UTC `date-time`, stable IDs and enums for precision/units. Backend does not mutate or coerce shared-schema inputs. If Person 1 chooses a different schema library or field layout, integrate a conversion at this adapter; do not maintain private parallel domain schemas.

## Named input schemas

| Name | Required backend shape/meaning |
| --- | --- |
| `NewsQuery` | Optional `location_ids`, `themes`, `entity_ids` string arrays (OR within one field, AND across fields), `bounds` [west,south,east,north], `keyword` literal case-insensitive substring of title/excerpt, `published_from`, `published_to` inclusive UTC, `semantic_query`; `limit` 1–100 default 50, `offset` 0–10000 default 0 |
| `LocationsQuery` | Optional `ids` string array, `query` name substring, `limit`, `offset` |
| `InvestigationQuery` | `id` stable investigation ID |
| `ObservationsQuery` | Optional `location_id`, `metric`, `observed_from`, `observed_to`, `limit`, `offset`; separate from publication time |
| `CompareObservationsArgs` | `location_id`, `metric`; optional observation range and `limit`; constrain one source/unit series |
| `FlightsQuery` | `region_id` from reviewed configuration; no global or arbitrary bounding requests |
| `FindAircraftArgs` | `region_id`, `identifier` exact aircraft hex/callsign in that bounded feed |
| `FocusLocationArgs` | `location_id` known stored location |
| `AssistantRequest` | `request_id`, `message` (1–4000 chars), `timezone` IANA; optional `filters`, `selected_investigation_id`, `allow_ui_actions` boolean default false, `audience` enum `general_public` / `journalist` / `investor` defaulting in backend policy to `general_public`; history additions need bounded schemas |
| `AssistantDraft` | Model-only `answer` plain string, `citations` [{`source_id`,`record_id`}], `result_ids` array, `actions` array; no arbitrary URLs or executable content |
| `UIAction` | Closed union: `{type:"set_filters",filters:NewsQuery}` or `{type:"focus_location",location_id:string}` |
| `FlightRegion` | Reviewed `id`, `latitude`, `longitude`, integer `radius_nm` 1–100; provider requests use lat/lon, shared map records use lon/lat |

`search_news` and `set_filters` use `NewsQuery`; all other tool inputs use the matching schemas above. Tools reuse canonical manual services, not a separate AI database path. There is no `sql`, `code`, `fetch_url` or arbitrary URI tool.

## Named record schemas

| Name | Fields the backend reads/emits |
| --- | --- |
| `Article` | `id`, `source_id`, `title`, `publisher`, `url`, nullable permitted `excerpt`, nullable `published_at`, `event_at`, `discovered_at`, `fetched_at`; `location_ids`, `entity_ids`, `themes`; import metadata `provider`, `provider_source_id`, `publication_time_basis`, `verification_status`, nullable `geographic_precision`, `content_hash` |
| `Location` | `id`, `name`, nullable `coordinates` [longitude,latitude], nullable `bounds` [west,south,east,north], `precision` address/facility/city/region; source-backed location metadata as agreed |
| `Observation` | `id`, `location_id`, `metric`, numeric/null `value`, `unit`, `source_id`, `observed_at`, `fetched_at`; source-specific precision/period metadata preserved |
| `Source` | `id`, HTTPS `url`, `title` or `name`; publisher/license/attribution/verification metadata as agreed; must identify original evidence, not just a provider catalog |
| `AircraftState` | `id` lowercased hex, `provider:"adsb.lol"`, nullable `callsign`, `coordinates` [lon,lat], nullable numeric `altitude`, `altitude_unit:"ft"`, `altitude_reference:"barometric"`, nullable numeric `speed`, `speed_unit:"kn"`, nullable numeric `heading`, UTC `observed_at`, `fetched_at`, `source_url`, `license:"ODbL-1.0"` |
| `Citation` | `source_id`, `record_id`, resolved original-source `url`, `title`; optional claim/excerpt metadata must be agreed and validated |

Preserve distinct event/publication/discovery/observation/fetch times. GDELT `seendate` is `discovered_at`; `published_at` stays null. RSS publication dates are feed assertions and new imports remain `unreviewed`. An article's verified arrays start empty: query configuration is not proof of its geography/theme. `AircraftState` excludes flight route/delay/emergency inference. A ground altitude string is represented as unknown numeric altitude, not converted to an invented measurement.

## Named response schemas

| Name | Payload supplied by backend |
| --- | --- |
| `NewsResponse` | `{items:Article[],limit,offset,coverage,search_mode:"keyword"|"semantic"|"keyword_fallback"}` |
| `LocationsResponse` | `{items:Location[],coverage}` |
| `InvestigationResponse` | A resolved envelope from the repository, with agreed investigation/articles/evidence/observations/locations/sources; all nested records must validate; citation-bearing records need `id` and `source_id`/`source_ids` |
| `ObservationsResponse` | `{items:Observation[],coverage,aggregation:"raw"}`; comparison adds nullable `{first_id,last_id,difference,unit}` and explicit limitation |
| `FlightsResponse` | `{items:AircraftState[],region_id,fetched_at,stale,mode:"live",replay:false,attribution,retry_at,error:string|null}`; cached live samples can be stale, never replay disguised as live |
| `AssistantResponse` | `{request_id,answer,citations:Citation[],result_ids,actions:UIAction[],coverage,mode:"live"|"fixture"|"fallback",errors:[{code,message,retryable}]}` |

`coverage` is stored freshness/coverage metadata plus `mode:"stored"|"fixture"|"unavailable"` and `live:false` for stored news/observations. Include source-specific coverage, verification, publication availability and last-successful-refresh limitations in the authoritative definition. Do not turn a database connection into a claim of complete geographic coverage. No fabricated total count is returned; SQL performs pagination before response construction. A raw comparison explicitly describes only returned endpoints and cannot claim complete-period aggregation.

Health/error envelopes are operational and work before domain contracts exist; agree their final shared definitions with Person 1. Responses use `error:{code,message,retryable,request_id}` for HTTP failures. Request/output validation errors are 400/502; missing dependencies are 503; unknown records 404; bounds/size/rate limits 400/413/429. Model output rejection yields a labeled assistant fallback with zero actions. Disconnected/time-expired requests do not yield actions.

Person 1 should supply shared verified fixtures once Person 4's records are available. Backend tests currently cover protocol behavior only. Frontend must discard stale assistant request IDs, keep selection/camera state itself, use returned precision, and render fallback/coverage/source notices.

Audience prompt policy now exists in the backend, with tests showing the same retrieval/citations/actions across all three perspectives. `AssistantRequest` is still absent from the authoritative registry, so this is not a completed assistant integration. Audience relevance badges and an optional news filter require separate agreed Article/NewsQuery fields and a frozen database handoff; none are silently injected into today's closed responses. See [global discovery and audience handoff](global-discovery-handoff.md).
