# Person 4 — Source and import definitions

Read the root `AGENTS.md`, `atlas_prd.md`, `docs/agents/person-4.md`, `db/AGENTS.md`, and `backend/docs/sources-handoff.md`. Root instructions apply throughout this subtree. **Phase gate:** keep files comment-only until the user explicitly authorizes Person 4 implementation. Do not fetch feeds, call provider APIs, or run imports before then.

## Your scope

This folder holds reviewed, human-verified source definitions and license records. They are configuration, not executable ingestion. Person 3 owns the ingestion code in `backend/`, and Person 1 owns root startup tooling. Do not add runnable fetch or import logic here.

## Format the backend expects

Export a reviewed module (suggested `atlas.mjs`) with `sources` and `regions`. Person 3 loads it through `ATLAS_SOURCES_MODULE`.

- **Every source:** stable `id`, `provider` (`gdelt` or `rss`), `permitted: true` (only after you actually review provider terms), and a real `license_url`.
- **GDELT:** a bounded `query` (1–512 chars). It is the fixed DOC artlist endpoint, at most 100 results for one day. `seendate` is discovery time, not publication.
- **RSS:** a reviewed public HTTPS `url` and the real `publisher`. `excerpts_permitted` is false unless storage is permitted; if true, set `max_excerpt_chars` (1–500). No redirects, IP-literal or private hosts, or non-HTTPS article links.
- **Regions:** each validates as `FlightRegion` (`id`, `latitude`, `longitude`, integer `radius_nm` 1–100). These are exploration regions, not claims about airports or facilities.
- Keep a human-readable record beside each definition: rights, attribution, retention, and review date.

## Rules

- Verify each source and URL is real, reachable, and permitted before adding it. Never guess feeds, licenses, or geographic mappings. If unverified, leave it out and list it as a gap.
- Source queries are not proof of an article's theme or location. Do not mark imported rows as reviewed.
- Public indicator datasets (civic or environmental): record the actual publisher, license, cadence, geographic unit, units, and period. They are not live unless the source updates that often.
- ADSB.lol is the flight provider. Before `FLIGHTS_ENABLED=true`, record production-access expectations, acceptable polling, attribution, and ODbL obligations. OpenSky is not a substitute under its current live-product terms.
- No credentials, API keys, or tokens in any definition.
- Align formats and IDs with `contracts/` and the `db/` schema. Report mismatches to the owning person.

## Meaningful checks

When authorized, confirm every URL resolves to the stated publisher and that license text permits the retained fields. Confirm the module loads with the backend's `npm --prefix backend run check` command, and report only what was actually verified.
