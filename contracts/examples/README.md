# Shared core examples

[`helene-core.json`](helene-core.json) is a deterministic, offline projection of the committed [Helene seed](../../db/seeds/helene-asheville-2024/records.sql), following the existing SQL record projections. It contains:

- 10 curated Article records, including date-only and unavailable publication times.
- 4 Location records: two gauge points, a city extent and a county extent.
- 23 original Source records, preserving attribution and licensing metadata.
- 10 resolved Citation examples referencing the articles and their original sources.

These are **historical curated examples**, not live API responses, a fetched news corpus, or generated assistant explanations. Source verification belongs to Person 4's seed; this work makes no new external-source verification claim. The citation examples establish record relationships, not support for an unspecified generated claim.

The `provenance` object records the seed path, its sha256 and `live:false`. It belongs to the fixture envelope and is not an extra field on any core schema. The source record's own timestamps retain their original meanings.

Regenerate after an authorized seed change:

```bash
npm --prefix contracts run examples:generate
npm --prefix contracts test
```

The generator reads literal seed records and projects the existing article/source/location fields. It does not execute SQL, import data, connect to a database, or fetch URLs; unsupported seed expressions fail rather than being evaluated. Tests compare the committed examples against this projection to catch drift.

The synthetic provider inputs and malformed cases in `contracts/test/` are protocol tests only. No synthetic content is added to this shared historical fixture. Complete API success/empty/error/fallback envelopes are deferred with their response schemas.
