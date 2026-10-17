# Worldwide discovery and audience relevance

## Why the map currently has few locations

Tiger was seeded with 10 source-linked Helene articles. Several share locations; the map displays sourced location features, not one invented point per article. The frontend renders the current news page (default 50, supported maximum 100), not the entire database.

Current approved imports include three Asheville/Ontario GDELT queries and one NASA RSS feed. Imported records deliberately have empty `location_ids`, `themes`, and `entity_ids`. More ingestion can increase the feed without increasing mapped locations. Publication time remains distinct from discovery/fetch time, and GDELT records without publication times are excluded by publication-date filters.

One live refresh of `rss-nasa-earth-observatory` was attempted on 2026-10-17. It failed, recorded failure/backoff metadata and imported no articles. The existing 10 curated records were preserved. The original CLI did not retain a safe failure code; it is not possible to attribute that attempt to a particular HTTP/database error from its output. The updated CLI reports sanitized error codes and upstream HTTP status when available; it never prints response bodies, arbitrary URLs or credentials. Do not bypass the recorded backoff to retry.

## Person 4: broader sources and reviewed location links

Add reviewed definitions in `scripts/source-definitions/atlas.mjs` for worldwide issue coverage. Candidate DOC queries for review, not installed sources:

- `(flood OR flooding OR wildfire OR earthquake)`
- `("energy infrastructure" OR "power outage" OR "supply chain")`
- `("public transit" OR "drinking water" OR housing)`

Check endpoint behavior, rights, attribution, duplicate volume, language/geographic coverage and polling expectations before marking a definition permitted. Existing imports remain bounded to 100 records per query/day. A query match is not a verified theme or geographic link. Existing GDELT guidance records an observed minimum request spacing of 5 seconds and 15-minute backoff after failures; sequential manual refreshes remain the initial workflow.

Geographic enrichment is a separate handoff. GDELT GEO can discover place mentions linked to articles, but its documentation explicitly describes geocoding errors and incidental mentions. A mentioned location is a candidate, not proof that an event happened there. Its source-country mode describes the publisher's origin, not the event location. [Official GDELT GEO documentation](https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/), [DOC documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/).

Provide reviewed story-to-location links with original source references, sourced coordinates/bounds and city/region/facility precision. Never substitute publisher headquarters, random coordinates or a Gemini guess. For the first worldwide demonstration, select a bounded set of verified stories across several continents. Broader automated candidates need an agreed schema/review workflow before promotion to mapped records. The backend runtime role currently has no write privileges for location/link tables; no extra grants or mappings have been created here.

## Person 1 and Person 2: global overview

Keep the existing map/feed page semantics explicit. Increasing the news limit to 100 can display a larger page, but does not represent complete world coverage. A scalable world overview should use a separately agreed, filtered spatial aggregation API for clusters/region summaries; drilldown then loads paginated stories. Its counts must come from actual stored rows and retain geographic precision. Do not bypass the 100-item contract limit or claim a page count is the full corpus.

## Audience behavior and contract proposal

Audience is a perspective, not an exclusive story category. A story can be useful to multiple audiences. Changing perspective should first change suggested questions and explanation emphasis while retaining the same evidence/filter state:

| Perspective | Explanation emphasis |
| --- | --- |
| `general_public` | Plain language, public impacts, services/resources and uncertainty. |
| `journalist` | Source trail, chronology, evidence gaps and explicitly labeled research leads. |
| `investor` | Documented sector/infrastructure/company exposure, its source and uncertainty; distinguish exposure from demonstrated financial impact. |

The backend now supplies this server-authored guidance to Gemini and rejects unsupported audience values. Tests show unchanged facts, filters, citations and actions across perspectives. This path still awaits Person 1's authoritative `AssistantRequest` schema and the assistant UI; no actual model generation is claimed.

Person 1 should add optional `AssistantRequest.audience` using the enum above. For visible relevance badges, agree an optional `Article.audience_relevance` array (at most three unique audiences) with bounded reason text, source IDs, classification origin and `suggested`/`reviewed` status. Classification suggestions must not become verified company relationships or event facts. Do not infer investor relevance solely from a nearby business or a topic match.

If filtering by relevance is desired, add optional `NewsQuery.audiences` (OR within this field, AND with geography/theme/date constraints). An explicit UI action may apply this filter; selecting a perspective alone should not silently hide records. Person 4 must freeze storage/provenance plus the keyword/semantic SQL changes before Person 3 wires the filter. Article bodies and NewsQuery are closed today; no private audience fields, production validators or fake tags were added to them.

## Current implementation and checks

Only backend prompt policy, safe provider/ingestion diagnostics and tests changed. Source definitions, database schema, shared contracts and frontend source are untouched. All 75 backend tests, source/test typechecks and production build pass. Global ingestion, automatic geocoding, relevance badges/filtering and worldwide cluster retrieval are not complete integrations.
