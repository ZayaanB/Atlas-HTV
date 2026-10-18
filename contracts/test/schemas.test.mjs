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

const assistantWorkspace = {
  revision: 1, captured_at: '2026-10-18T12:00:00.000Z',
  viewport: { bounds: [-80, 43, -79, 44], center: [-79.5, 43.5], zoom: 9 }, filters: {},
  selection: { article_id: null, investigation_id: null, location_id: null, aircraft_id: null },
  origin: { view: 'news' }, visible_article_ids: [], timeline: null, basemap: 'map',
  layers: { flights: false, wind: false }, capabilities: { flights: false, wind: false }, flight_context: null,
};
test('v3 snapshots preserve viewport/result context and remain incompatible with legacy requests', () => {
  const input = { protocol_version: 3, request_id: 'v3-schema', turn_id: 'turn-1', message: 'What is happening here?', timezone: 'UTC', workspace: assistantWorkspace };
  valid('AssistantRequestV3', input); invalid('AssistantRequestV2', input); invalid('AssistantRequest', input);
  invalid('AssistantRequestV3', { ...input, workspace: { ...assistantWorkspace, screenshot_url: 'https://example.invalid' } });
  invalid('AssistantRequestV3', { ...input, workspace: { ...assistantWorkspace, viewport: { ...assistantWorkspace.viewport, center: [43, 181] } } });
  invalid('AssistantRequestV3', { ...input, workspace: { ...assistantWorkspace, visible_article_ids: ['same-id', 'same-id'] } });
});
test('v3 workspace actions remain bounded to existing UI controls and validated record IDs', () => {
  for (const action of [
    { type: 'open_record', record_type: 'article', id: knownArticle.id },
    { type: 'set_basemap', basemap: 'satellite' }, { type: 'set_layers', wind: true }, { type: 'navigate_map', command: 'zoom_out' },
  ]) valid('UIActionV3', action);
  invalid('UIActionV3', { type: 'navigate_map', command: 'execute', code: 'arbitrary code' });
  invalid('UIActionV3', { type: 'open_record', record_type: 'article', id: 'https://example.invalid' });
  invalid('UIActionV3', { type: 'set_layers', wind: true, provider: 'invented-provider' });
  invalid('UIActionV3', { type: 'set_layers' });
});
test('v3 fallback cannot carry active references/proposals and terminal streams do not downgrade', () => {
  const response = { protocol_version: 3, request_id: 'v3-schema', conversation_id: 'conversation-1', context: assistantWorkspace,
    research_scope: {}, references: [], pending: null, kind: 'answer', answer: 'Assistant unavailable.', mode: 'fallback',
    coverage: { mode: 'fixture', live: false }, errors: [], citations: [], result_ids: [], actions: [], search: null, resolved_range: null, timeline: null };
  valid('AssistantResponseV3', response);
  valid('AssistantStreamEventV3', { type: 'complete', request_id: response.request_id, response });
  invalid('AssistantStreamEvent', { type: 'complete', request_id: response.request_id, response });
  invalid('AssistantResponseV3', { ...response, references: [{ record_type: 'article', id: knownArticle.id, label: knownArticle.title }] });
  invalid('AssistantResponseV3', { ...response, pending: { id: 'pending-1', question: 'Apply?', choices: [], actions: [] } });
});

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

test("v2 exports are closed and v1 continues to reject v2-only context", () => {
  const request = {
    protocol_version: 2,
    request_id: "r",
    message: "Explain",
    timezone: "UTC",
    interaction_mode: "intent",
    selected_article_id: knownArticle.id,
    selected_location_id: city.id,
    selected_bounds: [-83, 35, -82, 36],
    history: [
      { role: "user", content: "Previous question" },
      { role: "assistant", content: "Previous answer" },
    ],
  };
  valid("AssistantRequestV2", request);
  for (const change of [
    { allow_ui_actions: true },
    { protocol_version: 1 },
    { interaction_mode: "write" },
    { selected_series_id: "unagreed" },
    { history: Array(13).fill(request.history[0]) },
    { history: [{ role: "tool", content: "untrusted" }] },
    { history: [{ role: "user", content: "x".repeat(4001) }] },
    { message: " " },
    { selected_bounds: [181, 0, 0, 1] },
  ])
    invalid("AssistantRequestV2", { ...request, ...change });
  for (const change of [
    { protocol_version: 2 },
    { selected_article_id: knownArticle.id },
    { selected_location_id: city.id },
    { history: [] },
  ])
    invalid("AssistantRequest", {
      request_id: "r",
      message: "Explain",
      timezone: "UTC",
      ...change,
    });
});
test("v2 filter patches and intent keep model authorizations distinct from complete browser actions", () => {
  valid("AssistantFilterPatch", {
    set: { keyword: "flood" },
    clear: ["themes"],
  });
  valid("AssistantFilterPatch", {
    set: { event_types: ["flood"], topics: ["health"], verification_status: "reviewed", has_location: false },
    clear: [],
  });
  valid("AssistantFilterPatch", { set: {}, clear: ["event_types", "topics", "verification_status", "has_location"] });
  for (const set of [
    { keyword: "" },
    { keyword: " " },
    { themes: [] },
    { event_types: [] },
    { topics: [] },
    { location_ids: null },
    { limit: 20 },
    { offset: 0 },
    { sql: "select" },
  ])
    invalid("AssistantFilterPatch", { set, clear: [] });
  invalid("AssistantFilterPatch", {
    set: { themes: ["flooding"] },
    clear: ["themes"],
  });
  invalid("AssistantFilterPatch", { set: {}, clear: ["keyword", "keyword"] });
  invalid("AssistantFilterPatch", { set: { has_location: false }, clear: ["has_location"] });
  invalid("UIActionV2", { type: "set_filters", set: {}, clear: [] });
  valid("UIActionV2", {
    type: "set_filters",
    filters: { themes: ["flooding"], limit: 20 },
  });
  invalid("UIActionV2", { type: "open_url", url: knownArticle.url });
  const intent = {
    actions: [],
    filter_keys: [],
    clear_filters: [],
    clarification_reason: null,
    use_current_area: false,
    date_expression: null,
    date_target: null,
  };
  valid("AssistantIntent", intent);
  invalid("AssistantIntent", { ...intent, date_expression: "today" });
  invalid("AssistantIntent", { ...intent, date_target: "publication" });
  invalid("AssistantIntent", { ...intent, clear_filters: ["themes"] });
  valid("AssistantIntent", {
    ...intent,
    filter_keys: ["themes"],
    clear_filters: ["themes"],
    date_expression: "today",
    date_target: "publication",
  });
});
test("v2 draft restrictions do not reject public server-derived page IDs or uncited fallbacks", () => {
  const status = {
    kind: "action_summary",
    answer: "",
    citations: [],
    result_ids: [],
    actions: [{ type: "set_filters", set: { keyword: "flooding" }, clear: [] }],
    clarification_reason: null,
  };
  valid("AssistantDraftV2", status);
  invalid("AssistantDraftV2", { ...status, result_ids: [knownArticle.id] });
  invalid("AssistantDraftV2", {
    ...status,
    actions: [{ type: "set_filters", filters: {} }],
  });
  invalid("AssistantDraftV2", { ...status, kind: "clarification" });
  const response = {
    protocol_version: 2,
    request_id: "r",
    kind: "action_summary",
    answer: "Updated filters.",
    citations: [],
    result_ids: [knownArticle.id],
    actions: [],
    coverage: { mode: "stored", live: false },
    mode: "live",
    errors: [],
    search: { filters: {}, returned_count: 1, limit: 20, offset: 0 },
    resolved_range: null,
    timeline: null,
  };
  valid("AssistantResponseV2", response);
  valid("AssistantResponseV2", {
    ...response,
    kind: "answer",
    mode: "fallback",
    result_ids: [],
    search: null,
  });
  invalid("AssistantResponseV2", {
    ...response,
    kind: "answer",
    mode: "fallback",
  });
  const citation = {
    ...examples.citations[0],
    number: 1,
    published_at: null,
    published_date: "2024-09-27",
    observed_at: null,
    observed_from: null,
    observed_to: null,
    period_start: null,
    period_end: null,
  };
  valid("CitationV2", citation);
  invalid("CitationV2", {
    ...citation,
    url: "https://user:secret@example.invalid/",
  });
  invalid("CitationV2", { ...citation, published_date: "2024-02-30" });
  invalid("OpenTimelineArgs", {
    investigation_id: "inv-test",
    series_id: "series-test",
    observed_from: "2024-09-01T00:00:00-04:00",
  });
  valid("OpenTimelineArgs", {
    investigation_id: "inv-test",
    series_id: "series-test",
    observed_from: "2024-09-01T04:00:00.000Z",
  });
});

test("stream events are closed, bounded and use the authoritative v2 terminal response", () => {
  valid("AssistantStreamEvent", { type: "status", request_id: "s", phase: "reading" });
  valid("AssistantStreamEvent", { type: "answer_delta", request_id: "s", text: "Quoted <script> text 🚀" });
  valid("AssistantStreamEvent", { type: "error", request_id: "s", error: { code: "STREAM_INTERRUPTED", message: "Retry", retryable: true, request_id: "s" } });
  for (const value of [
    { type: "status", request_id: "s", phase: "invented" },
    { type: "answer_delta", request_id: "s", text: "" },
    { type: "answer_delta", request_id: "s", text: "a".repeat(16001) },
    { type: "answer_delta", request_id: "s", text: "Preview", actions: [] },
    { type: "complete", request_id: "s", response: {} },
    { type: "tool_call", request_id: "s", args: {} },
  ]) invalid("AssistantStreamEvent", value);
});

test("research tools have strict bounded arguments without changing manual query limits", () => {
  valid("AssistantNewsSearchArgs", { limit: 5, offset: 10, themes: ["flooding"] });
  valid("NewsQuery", { limit: 100 });
  valid("AssistantLocationsSearchArgs", { ids: [city.id], limit: 5 });
  valid("AssistantArticleReadArgs", { id: knownArticle.id, excerpt_offset: 240, excerpt_limit: 2000 });
  valid("AssistantInvestigationReadArgs", { id: "inv-test", section: "items", limit: 5, offset: 5 });
  valid("AssistantCatalogSearchArgs", { kind: "investigations", query: "flood", limit: 3 });
  valid("AssistantSourcesReadArgs", { ids: [knownArticle.source_id] });
  valid("AssistantHistoryReadArgs", { offset: 5, limit: 2 });
  for (const [name, value] of [
    ["AssistantNewsSearchArgs", { limit: 6 }],
    ["AssistantNewsSearchArgs", { limit: "3" }],
    ["AssistantNewsSearchArgs", { sql: "SELECT *" }],
    ["AssistantLocationsSearchArgs", { limit: 100 }],
    ["AssistantArticleReadArgs", { id: knownArticle.id, url: "https://example.invalid" }],
    ["AssistantArticleReadArgs", { id: knownArticle.id, excerpt_limit: 2001 }],
    ["AssistantInvestigationReadArgs", { id: "inv-test", section: "everything" }],
    ["AssistantCatalogSearchArgs", { kind: "database", limit: 5 }],
    ["AssistantSourcesReadArgs", { ids: [knownArticle.source_id, knownArticle.source_id] }],
    ["AssistantSourcesReadArgs", { ids: Array.from({ length: 6 }, (_, i) => `src-${i}`) }],
    ["AssistantHistoryReadArgs", { offset: 6 }],
    ["AssistantHistoryReadArgs", { limit: 3 }],
  ]) invalid(name, value);
});

test("filter receipts accept complete resets and reject unsupported or repeated keys", () => {
  const keys = schemas.AssistantFilterPatch.properties.clear.items.enum;
  const receipt = { kind: "receipt", items: [], returned_count: 0, truncated: false,
    receipt: { action_type: "set_filters", changed_keys: keys } };
  valid("AssistantToolResult", receipt);
  invalid("AssistantToolResult", { ...receipt, receipt: { ...receipt.receipt, changed_keys: ["sql"] } });
  invalid("AssistantToolResult", { ...receipt, receipt: { ...receipt.receipt, changed_keys: ["keyword", "keyword"] } });
});

test("compact research results preserve nullable dates and qualifiers while rejecting record dumps", () => {
  const record = {
    id: knownArticle.id, record_type: "article", title: knownArticle.title,
    published_at: null, published_date: "2024-09-27", publication_time_basis: "date_only",
    excerpt: null, geographic_precision: knownArticle.geographic_precision,
  };
  valid("AssistantResearchRecord", record);
  invalid("AssistantResearchRecord", { ...record, published_date: "2024-02-30" });
  invalid("AssistantResearchRecord", { ...record, published_at: "2024-09-27T00:00:00-04:00" });
  invalid("AssistantResearchRecord", { ...record, url: "javascript:alert(1)" });
  invalid("AssistantResearchRecord", { ...record, full_article: "Unexpected body" });
  const result = { kind: "article", items: [record], returned_count: 1, truncated: false };
  valid("AssistantToolResult", result);
  valid("AssistantToolResult", { ...result, kind: "receipt", items: [], returned_count: 0, receipt: { action_type: "set_filters", changed_keys: ["keyword"] }, page_returned_count: 50 });
  invalid("AssistantToolResult", { ...result, items: Array(6).fill(record) });
  invalid("AssistantToolResult", { ...result, returned_count: 6 });
  invalid("AssistantToolResult", { ...result, investigation: {} });
  invalid("AssistantToolResult", { ...result, receipt: { filters: {} } });
  invalid("AssistantToolResult", { ...result, exchanges: [{ index: 0, user: "Question", assistant: "a".repeat(4001) }] });
});

test('flight area schemas are strict, bounded and legacy identity fields remain optional', async () => {
  const query = { latitude: 43.71, longitude: -79.41, radius_nm: 97 };
  valid('FlightAreaQuery', query);
  for (const value of [{ ...query, latitude: 91 }, { ...query, longitude: Infinity }, { ...query, radius_nm: 0 }, { ...query, radius_nm: 100.1 }, { ...query, radius_nm: '100' }, { ...query, extra: true }, {}]) invalid('FlightAreaQuery', value);
  const stamp = '2026-10-17T12:00:00Z';
  const aircraft = { id:'abc123',provider:'adsb.lol',callsign:null,coordinates:[-79.4,43.7],altitude:null,altitude_unit:'ft',altitude_reference:'barometric',speed:null,speed_unit:'kn',heading:null,observed_at:stamp,fetched_at:stamp,source_url:'https://example.invalid/synthetic',license:'ODbL-1.0' };
  valid('AircraftState', aircraft);
  valid('AircraftState', { ...aircraft,registration:null,aircraft_type:null,operator:null,on_ground:null });
  valid('AircraftState', { ...aircraft,registration:'C-TEST',aircraft_type:'B738',operator:null,on_ground:true });
  for (const value of [{registration:' A '},{registration:'X'.repeat(33)},{aircraft_type:'X'.repeat(17)},{on_ground:'ground'}]) invalid('AircraftState',{...aircraft,...value});
  const area = {id:'area-43.7--79.4-100',latitude:43.7,longitude:-79.4,radius_nm:100};
  const response = { area,items:[aircraft],fetched_at:stamp,status:'ready',stale:false,truncated:false,mode:'live',replay:false,attribution:'Synthetic contract test',retry_at:stamp,error:null };
  valid('FlightAreaResponse',response);
  valid('FlightAreaResponse',{...response,items:Array(500).fill(aircraft)});
  for (const status of ['waiting','unavailable']) valid('FlightAreaResponse',{...response,status,items:[],fetched_at:null,stale:true});
  for (const value of [{items:Array(501).fill(aircraft)},{status:'empty'},{extra:true},{retry_at:'2026-10-17T12:00:00-04:00'},{truncated:null}]) invalid('FlightAreaResponse',{...response,...value});
  const research = JSON.parse(await readFile(new URL('../examples/helene-research.json',import.meta.url),'utf8'));
  valid('WorkspaceResponse', research.workspace);
  valid('WorkspaceResponse', {...research.workspace,capabilities:{...research.workspace.capabilities,flight_areas:true}});
  valid('FlightsResponse',{items:[aircraft],region_id:'legacy',fetched_at:stamp,stale:false,mode:'live',replay:false,attribution:'Synthetic test',retry_at:stamp,error:null});
});

test('global AirLabs contracts enforce UTC, coordinates, every required field and safety limits', async () => {
  const time = '2026-10-17T12:00:00Z';
  const aircraft = {id:'abc123',provider:'airlabs',callsign:null,registration:null,aircraft_type:null,operator:null,on_ground:false,coordinates:[-79,43],altitude:1000,altitude_unit:'m',altitude_reference:'unknown',speed:null,speed_unit:'kn',heading:0,direction_kind:'direction',flight_iata:'AB12',airline_icao:null,airline_iata:null,departure_iata:'YYZ',arrival_iata:null,observed_at:time,fetched_at:time,source_url:'https://airlabs.co/',license:'AirLabs-terms'};
  const point = {coordinates:[-79,43],observed_at:time,callsign:null,flight_iata:null};
  const trail = {aircraft_id:'abc123',points:[point]};
  const response = {snapshot_id:'airlabs-1792238400000',items:[aircraft],trails:[trail],fetched_at:time,status:'ready',stale:false,truncated:false,mode:'live',replay:false,attribution:'Synthetic protocol',retry_at:time,pause_reason:null,error:null};
  valid('AircraftState',aircraft); valid('FlightGlobalResponse',response);
  valid('FlightGlobalResponse',{...response,items:Array(25000).fill(aircraft),trails:Array(25000).fill({...trail,points:Array(8).fill(point)})});
  for (const status of ['waiting','unavailable']) valid('FlightGlobalResponse',{...response,status,items:[],trails:[],snapshot_id:null,fetched_at:null,retry_at:null,pause_reason:'quota'});
  for (const key of Object.keys(response)) { const copy={...response}; delete copy[key]; invalid('FlightGlobalResponse',copy); }
  for (const change of [{items:Array(25001).fill(aircraft)},{trails:Array(25001).fill(trail)},{trails:[{...trail,points:Array(9).fill(point)}]},{extra:true},{pause_reason:'billing'},{retry_at:'2026-02-30T00:00:00Z'},{fetched_at:'2026-10-17T12:00:00+00:00'},{trails:[{...trail,points:[{...point,coordinates:[181,0]}]}]},{trails:[{...trail,points:[{...point,observed_at:'invalid'}]}]},{trails:[{...trail,points:[{...point,extra:1}]}]},{trails:[{...trail,extra:true}]}]) invalid('FlightGlobalResponse',{...response,...change});
  for (const change of [{coordinates:[0,91]},{altitude_unit:'km'},{provider:'other'},{license:'unknown'},{direction_kind:'heading'},{flight_iata:'x'.repeat(33)},{airline_icao:12},{departure_iata:[]},{extra:true}]) invalid('AircraftState',{...aircraft,...change});
  const research=JSON.parse(await readFile(new URL('../examples/helene-research.json',import.meta.url),'utf8'));
  valid('WorkspaceResponse',{...research.workspace,capabilities:{...research.workspace.capabilities,flights:false,flight_areas:false,flight_global:true}});
});
