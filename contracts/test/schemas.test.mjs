import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { schemas } from "../dist/index.js";
import { seedExamples } from "../scripts/seed-examples.mjs";
import { apiExamples } from "../scripts/api-examples.mjs";

const examples = JSON.parse(
  await readFile(
    new URL("../examples/helene-core.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv({
  allErrors: false,
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
});
addFormats(ajv);
for (const [name, schema] of Object.entries(schemas))
  ajv.addSchema(schema, name);
const valid = (name, value) => {
  const validate = ajv.getSchema(name);
  assert.equal(
    validate(value),
    true,
    `${name}: ${JSON.stringify(validate.errors)}`,
  );
};
const invalid = (name, value) =>
  assert.equal(
    ajv.getSchema(name)(value),
    false,
    `${name} should reject ${JSON.stringify(value)}`,
  );
const datedArticle = examples.articles.find(
  (article) => article.publication_time_basis === "date_only",
);
const knownArticle = examples.articles.find(
  (article) => article.publication_time_basis === "document_text",
);
const unknownArticle = examples.articles.find(
  (article) => article.publication_time_basis === "unavailable",
);
const city = examples.locations.find(
  (location) => location.precision === "city",
);
const gauge = examples.locations.find(
  (location) => location.precision === "facility",
);

test("all public schemas compile, register by name, and resolve from another schema", () => {
  assert.ok(Object.keys(schemas).length >= 31);
  for (const name of [
    "InvestigationResponse",
    "AssistantResponse",
    "FlightsResponse",
    "ObservationsResponse",
    "WorkspaceResponse",
  ])
    assert.ok(schemas[name]);
  for (const name of Object.keys(schemas))
    assert.equal(typeof ajv.getSchema(name), "function");
  const wrapper = ajv.compile({
    type: "object",
    properties: { article: { $ref: "Article" } },
    required: ["article"],
    additionalProperties: false,
  });
  assert.equal(wrapper({ article: knownArticle }), true);
  assert.equal(wrapper({ article: { ...knownArticle, title: 7 } }), false);
});

test("shared historical API examples remain derived and validate complete envelopes", async () => {
  const api = JSON.parse(
    await readFile(
      new URL("../examples/helene-api.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(api, await apiExamples());
  valid("NewsResponse", api.news);
  valid("NewsResponse", api.emptyNews);
  valid("LocationsResponse", api.locations);
  valid("Coverage", {
    mode: "stored",
    live: false,
    scope: "all",
    source_id: null,
    status: null,
    attempted_at: null,
    last_successful_at: null,
    next_retry_at: null,
    consecutive_failures: null,
    verification_status: null,
    feeds: [],
    datasets: [],
    articles: null,
  });
  invalid("NewsResponse", { ...api.news, total: 10 });
  invalid("NewsResponse", {
    ...api.news,
    items: [{ ...api.news.items[0], published_at: "yesterday" }],
  });
  invalid("Coverage", { mode: "stored", live: true });
  invalid("Coverage", {
    mode: "fixture",
    live: false,
    feeds: [{ arbitrary: "field" }],
  });
  valid("ApiError", {
    error: {
      code: "CONTRACTS_UNAVAILABLE",
      message: "Missing schema",
      retryable: true,
      request_id: "req-1",
    },
  });
  invalid("ApiError", {
    error: { code: "INTERNAL_ERROR", message: "Unavailable" },
  });
  valid("LocationsQuery", {
    ids: ["loc-asheville-nc"],
    query: "Asheville",
    limit: 100,
    offset: 0,
  });
  invalid("LocationsQuery", { ids: "loc-asheville-nc" });
});

test("plain JSON exports exactly match the TypeScript-authored schemas", async () => {
  for (const [name, schema] of Object.entries(schemas)) {
    const json = JSON.parse(
      await readFile(
        new URL(`../dist/schemas/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(json, schema);
    const independent = new Ajv({ strict: true });
    addFormats(independent);
    for (const [key, dependency] of Object.entries(schemas))
      independent.addSchema(dependency, key);
    assert.equal(typeof independent.getSchema(name), "function");
  }
});

test("committed examples match the seed and preserve all current core records", async () => {
  assert.deepEqual(examples, await seedExamples());
  assert.equal(examples.provenance.live, false);
  assert.equal(examples.articles.length, 10);
  assert.equal(examples.locations.length, 4);
  assert.equal(examples.sources.length, 23);
  for (const [key, name] of [
    ["articles", "Article"],
    ["locations", "Location"],
    ["sources", "Source"],
    ["citations", "Citation"],
  ]) {
    for (const record of examples[key]) valid(name, record);
  }
});

test("query accepts normalized filters and leaves inputs unchanged without injecting defaults", () => {
  for (const query of [
    {},
    { location_ids: [], themes: [], entity_ids: [], keyword: "" },
    {
      location_ids: ["loc-asheville-nc"],
      themes: ["flooding"],
      entity_ids: ["ent-usgs"],
      bounds: [-83, 35, -82, 36],
      keyword: "flood",
      semantic_query: "river flooding",
      published_from: "2024-09-01T00:00:00Z",
      published_to: "2024-11-30T23:59:59.999Z",
      limit: 100,
      offset: 10000,
    },
  ]) {
    const before = structuredClone(query);
    valid("NewsQuery", query);
    assert.deepEqual(query, before);
  }
});

test("query rejects unnormalized, oversized, and unknown request fields", () => {
  for (const query of [
    null,
    [],
    { location_ids: "loc-asheville-nc" },
    { location_ids: Array(101).fill("loc-asheville-nc") },
    { limit: "20" },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { offset: -1 },
    { offset: 10001 },
    { keyword: "x".repeat(1001) },
    { semantic_query: "   " },
    { semantic_query: "x".repeat(4001) },
    { sql: "SELECT 1" },
    { fetch_url: "https://example.invalid/" },
    { location_ids: ["../secret"] },
  ])
    invalid("NewsQuery", query);
});

test("query rejects invalid calendar instants and preserves explicit UTC", () => {
  for (const value of [
    "2024-02-30T00:00:00Z",
    "2024-09-01",
    "2024-09-01T00:00:00",
    "2024-09-01T00:00:00+00:00",
    "2024-09-01T00:00:00.1234Z",
    "2024-09-01T23:59:60Z",
  ])
    invalid("NewsQuery", { published_from: value });
});

test("coordinate tuples reject invalid dimensions, ordering-by-axis, and ranges", () => {
  for (const bounds of [
    [1, 2],
    [1, 2, 3, 4, 5],
    [181, 0, 0, 1],
    [0, -91, 0, 1],
    ["-83", 35, -82, 36],
  ])
    invalid("NewsQuery", { bounds });
  invalid("Location", { ...gauge, coordinates: [181, 35] });
  invalid("Location", { ...gauge, coordinates: [-82, 91] });
  invalid("Location", { ...gauge, coordinates: [-82, 35, 0] });
});

test("articles distinguish date-only, unavailable, and known publication times", () => {
  const { published_date, ...withoutDate } = knownArticle;
  valid("Article", withoutDate);
  const { published_date: omitted, ...withoutRequiredDate } = datedArticle;
  invalid("Article", withoutRequiredDate);
  invalid("Article", { ...datedArticle, published_date: null });
  invalid("Article", { ...datedArticle, published_date: "2024-02-30" });
  invalid("Article", { ...datedArticle, published_at: "2024-10-04T00:00:00Z" });
  invalid("Article", {
    ...unknownArticle,
    published_at: "2024-09-27T00:00:00Z",
  });
  invalid("Article", { ...unknownArticle, published_date: "2024-09-27" });
  invalid("Article", { ...knownArticle, published_at: null });
  invalid("Article", { ...knownArticle, fetched_at: null });
});

test("articles enforce explicit missing values, metadata enums, text limits, and hashes", () => {
  const { excerpt, ...withoutExcerpt } = knownArticle;
  invalid("Article", withoutExcerpt);
  for (const change of [
    { title: "" },
    { title: "  " },
    { excerpt: "x".repeat(501) },
    { provider: "invented" },
    { content_hash: "not-a-sha256" },
    { geographic_precision: "building" },
    { verification_status: "verified" },
    { summary: "invented full article summary" },
  ])
    invalid("Article", { ...knownArticle, ...change });
  valid("Article", { ...knownArticle, excerpt: "A permitted excerpt." });
});

test("locations require broad extents or precise points and matching provenance", () => {
  invalid("Location", { ...city, bounds: null, bounds_basis: null });
  invalid("Location", { ...gauge, coordinates: null, coordinates_basis: null });
  invalid("Location", { ...city, coordinates_basis: null });
  invalid("Location", { ...gauge, bounds_basis: "invented" });
  invalid("Location", { ...city, coordinates: null });
  valid("Location", { ...city, coordinates: null, coordinates_basis: null });
  valid("Location", {
    ...city,
    source_id: null,
    verification_status: "unreviewed",
  });
});

test("source records preserve date-only publications, original provenance, and explicit nulls", () => {
  const dateOnly = examples.sources.find(
    (source) => source.published_at_basis === "date_only",
  );
  invalid("Source", { ...dateOnly, published_at: "2024-10-04T00:00:00Z" });
  invalid("Source", { ...dateOnly, published_date: null });
  invalid("Source", { ...examples.sources[0], published_at: null });
  const { license, ...withoutLicense } = dateOnly;
  invalid("Source", withoutLicense);
  valid("Source", {
    ...dateOnly,
    license: null,
    license_url: null,
    attribution: null,
    retrieved_at: null,
  });
  invalid("Source", { ...dateOnly, source_type: "provider_catalog" });
  invalid("Source", { ...dateOnly, license_url: "javascript:alert(1)" });
});

test("original-source URLs reject non-HTTPS, missing authorities, and credentials", () => {
  for (const url of [
    "http://example.invalid/",
    "/relative",
    "javascript:alert(1)",
    "https://",
    "https://user:secret@example.invalid/",
    "https://example.invalid/a b",
  ]) {
    invalid("Article", { ...knownArticle, url });
    invalid("Source", { ...examples.sources[0], url });
    invalid("Citation", { ...examples.citations[0], url });
  }
});

test("citation references accept real record IDs including observations but never URL overrides", () => {
  valid("CitationReference", {
    source_id: "src-usgs-iv-03451500-00060",
    record_id: "usgs-03451500-discharge@20240927T213800Z",
  });
  invalid("CitationReference", {
    source_id: knownArticle.source_id,
    record_id: knownArticle.id,
    url: knownArticle.url,
  });
  invalid("CitationReference", {
    source_id: "Invented Uppercase ID",
    record_id: knownArticle.id,
  });
  invalid("CitationReference", {
    source_id: knownArticle.source_id,
    record_id: "usgs-03451500-discharge@2024-09-27",
  });
  invalid("Citation", {
    source_id: knownArticle.source_id,
    record_id: knownArticle.id,
  });
  invalid("Citation", {
    ...examples.citations[0],
    claim: "unagreed claim field",
  });
});

const research = JSON.parse(
  await readFile(
    new URL("../examples/helene-research.json", import.meta.url),
    "utf8",
  ),
);
test("research fixtures validate, preserve source relationships and raw observations", () => {
  valid("WorkspaceResponse", research.workspace);
  for (const investigation of research.investigations) {
    valid("InvestigationResponse", investigation);
    for (const item of investigation.investigation.items)
      for (const id of item.source_ids)
        assert.ok(investigation.sources.some((source) => source.id === id));
  }
  assert.equal(research.observations.length, 7467);
  for (const observation of research.observations)
    valid("Observation", observation);
});
test("assistant and evidence reject executable actions and unsafe paths", () => {
  invalid("UIAction", { type: "run_sql", sql: "SELECT 1" });
  invalid("UIAction", { type: "focus_location", coordinates: [0, 0] });
  invalid("AssistantRequest", {
    request_id: "r",
    message: "question",
    timezone: "UTC",
    history: Array.from({ length: 7 }, () => ({
      role: "user",
      content: "question",
    })),
  });
  const evidence = research.investigations[0].evidence.find(
    (e) => e.type === "imagery",
  );
  invalid("Evidence", {
    ...evidence,
    imagery: {
      ...evidence.imagery,
      asset_path: "https://example.invalid/track.png",
    },
  });
});

test("assistant requests accept only the agreed bounded context and audience", () => {
  const request = {
    request_id: "request-1",
    message: "What is confirmed?",
    timezone: "America/Toronto",
  };
  valid("AssistantRequest", request);
  for (const audience of ["general_public", "journalist", "investor"])
    valid("AssistantRequest", {
      ...request,
      audience,
      filters: { themes: ["flooding"] },
      selected_investigation_id: "inv-helene-asheville-2024",
      allow_ui_actions: true,
    });
  for (const change of [
    { audience: "public" },
    { audience: "expert" },
    { message: " " },
    { message: "x".repeat(4001) },
    { timezone: "x".repeat(101) },
    { request_id: "x".repeat(161) },
    { allow_ui_actions: "true" },
    { selected_article_id: knownArticle.id },
    { history: [] },
    { filters: { location_ids: Array(101).fill("loc-asheville-nc") } },
  ])
    invalid("AssistantRequest", { ...request, ...change });
});

test("model-only draft independently compiles for respond and cannot override citation provenance", () => {
  assert.equal(
    JSON.stringify(schemas.AssistantDraft).includes('"$ref"'),
    false,
  );
  const standalone = new Ajv({ strict: true });
  addFormats(standalone);
  const validate = standalone.compile(schemas.AssistantDraft);
  const draft = {
    answer: "Synthetic protocol answer, not a factual briefing.",
    citations: [
      { source_id: knownArticle.source_id, record_id: knownArticle.id },
    ],
    result_ids: [knownArticle.id],
    actions: [
      { type: "set_filters", filters: { themes: ["flooding"] } },
      { type: "focus_location", location_id: "loc-asheville-nc" },
    ],
  };
  assert.equal(validate(draft), true);
  for (const change of [
    { citations: [{ ...draft.citations[0], url: knownArticle.url }] },
    { citations: [{ ...draft.citations[0], title: "Model supplied title" }] },
    {
      actions: [
        {
          type: "focus_location",
          location_id: "loc-asheville-nc",
          coordinates: [0, 0],
        },
      ],
    },
    { actions: [{ type: "set_filters", filters: { sql: "SELECT 1" } }] },
    { actions: Array(9).fill(draft.actions[0]) },
    { result_ids: Array(101).fill(knownArticle.id) },
    { answer: "x".repeat(12001) },
    { request_id: "model-must-not-supply-request-id" },
    { mode: "live" },
  ])
    assert.equal(validate({ ...draft, ...change }), false);
  invalid("AssistantResponse", {
    ...draft,
    request_id: "r",
    coverage: { mode: "stored", live: false },
    mode: "live",
    errors: [],
  });
});

test("frozen observation projection preserves nulls, periods, precision, and series metadata", () => {
  const row = research.observations[0];
  valid("Observation", { ...row, value: null });
  for (const field of [
    "series_id",
    "statistic",
    "qualifiers",
    "time_precision",
    "period_start",
    "period_end",
    "value",
    "fetched_at",
  ]) {
    const missing = { ...row };
    delete missing[field];
    invalid("Observation", missing);
  }
  for (const change of [
    { value: "0" },
    { value: Infinity },
    { unit: "" },
    { metric: "River discharge" },
    { statistic: "average" },
    { time_precision: "exact" },
    { time_precision: "day" },
    { period_start: null, period_end: "2024-09-28T00:00:00Z" },
    { fetched_at: "2024-09-28" },
    { observed_at: "2024-09-27T00:00:00-04:00" },
    { qualifiers: Array(101).fill("P") },
  ])
    invalid("Observation", { ...row, ...change });
  const peak = research.observations.find((o) => o.statistic === "annual_peak");
  assert.ok(peak);
  valid("Observation", peak);
  const series = research.investigations[0].observation_series[0];
  invalid("ObservationSeries", { ...series, expected_interval_seconds: null });
  invalid("ObservationSeries", { ...series, coverage_from: null });
  const report = research.investigations[0].evidence.find(
    (e) => e.type === "report",
  );
  valid("Evidence", { ...report, type: "article", location_id: null });
});

test("research queries match the frozen database inputs and reject execution fields", () => {
  valid("InvestigationQuery", { id: "inv-helene-asheville-2024" });
  valid("FocusLocationArgs", { location_id: "loc-asheville-nc" });
  const query = {
    location_id: "loc-usgs-03451500",
    metric: "discharge",
    observed_from: "2024-09-27T00:00:00Z",
    observed_to: "2024-09-28T00:00:00Z",
    limit: 100,
  };
  valid("ObservationsQuery", { ...query, offset: 100 });
  valid("CompareObservationsArgs", query);
  invalid("CompareObservationsArgs", { metric: "discharge" });
  invalid("CompareObservationsArgs", { ...query, offset: 100 });
  // 006: a live series can share a location + metric with a curated archive; series_id selects one of them.
  valid("ObservationsQuery", { ...query, series_id: "usgs-03451500-discharge" });
  valid("CompareObservationsArgs", { ...query, series_id: "usgs-03451500-discharge" });
  invalid("ObservationsQuery", { ...query, series_id: "../usgs-03451500-discharge" });
  invalid("ObservationsQuery", { ...query, series_id: ["usgs-03451500-discharge"] });
  invalid("ObservationsQuery", { ...query, limit: "100" });
  invalid("InvestigationQuery", { id: "../secret" });
  invalid("FocusLocationArgs", {
    location_id: "loc-asheville-nc",
    coordinates: [0, 0],
  });
  const investigation = research.investigations[0];
  for (const field of ["evidence", "observation_series", "sources"]) {
    const missing = { ...investigation };
    delete missing[field];
    invalid("InvestigationResponse", missing);
  }
});
