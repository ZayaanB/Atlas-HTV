# Person 4 — Evidence assets

Read the root `AGENTS.md`, `atlas_prd.md` (sections 2 and 7), `docs/agents/person-4.md`, `db/AGENTS.md`, and `frontend/src/features/map/AGENTS.md`. Root instructions apply throughout this subtree. **Phase gate:** do not download or generate imagery until the user explicitly authorizes Person 4 implementation.

## Your scope

Supply licensed, dated evidence imagery and its metadata. Person 2 renders it, Person 1 owns the shared contract, and Person 3 serves the records. Do not edit map code or contracts. Propose changes to the owners instead.

## Rules

- **Check before fetching:** source terms, layer, acquisition date and period, resolution, bounds, coordinate reference, and alignment must all be confirmed first. NASA GIBS/Worldview is a candidate, not an assumption.
- **Metadata per asset:** stable evidence ID matching the DB/contract `Evidence` record, `source_url`, observation period (acquisition dates, not download date), longitude–latitude `bounds`, asset or layer reference, legend, attribution, license, and limitations.
- **Not the basemap:** Mapbox satellite imagery is exploration context, not live or dated event evidence. A basemap screenshot must never be presented as a dated observation. Never invent acquisition dates.
- Handoff to Person 2: a legend, bounds, and limitations text, and a statement of what the imagery cannot show (no building recognition or parcel ownership).
- If a before/after comparison is unsuitable (mismatched resolution, cloud cover, or alignment), keep one well-documented dated observation instead of forcing a comparison.
- Keep file sizes reasonable for the repo. Record the source URL and retrieval date for every file. No credentials or signed URLs in asset metadata.

## Meaningful checks

When authorized, verify that bounds align with the map rendering, dates match the source, attribution displays, and the description claims no more than the imagery supports. Report anything unverified.
