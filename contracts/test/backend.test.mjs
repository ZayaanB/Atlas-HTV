// Integration checks exercise Person 3's existing code without editing it or opening external connections.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readConfig } from "../../backend/src/config.ts";
import { loadHandoffs } from "../../backend/src/runtime/handoffs.ts";
import {
  Contracts,
  normalizeQuery,
} from "../../backend/src/services/validation.ts";
import { normalizeArticle } from "../../backend/src/data/ingestion.ts";
import { EvidenceLedger } from "../../backend/src/services/gemini/citations.ts";
import { Retrieval } from "../../backend/src/services/retrieval.ts";
import { Assistant } from "../../backend/src/services/gemini/orchestrator.ts";
import { schemas } from "../dist/index.js";

const examples = JSON.parse(
  await readFile(
    new URL("../examples/helene-core.json", import.meta.url),
    "utf8",
  ),
);
const contracts = new Contracts(schemas);
const research = JSON.parse(
  await readFile(
    new URL("../examples/helene-research.json", import.meta.url),
    "utf8",
  ),
);
function researchRetrieval() {
  return new Retrieval(contracts, {
    mode: "fixture",
    async read(name, args) {
      if (name === "news") return examples.articles;
      if (name === "locations") return examples.locations;
      if (name === "sources")
        return examples.sources.filter((source) =>
          args.ids.includes(source.id),
        );
      if (name === "freshness") return [];
      if (name === "investigation")
        return research.investigations.filter(
          (row) => row.investigation.id === args.id,
        );
      if (name === "observations")
        return research.observations
          .filter(
            (row) =>
              row.location_id === args.location_id &&
              row.metric === args.metric &&
              (!args.observed_from || row.observed_at >= args.observed_from) &&
              (!args.observed_to || row.observed_at <= args.observed_to),
          )
          .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at))
          .slice(args.offset, args.offset + args.limit);
      throw new Error(`Unexpected repository operation ${name}`);
    },
  });
}

test("existing research retrieval validates the frozen envelope, raw pagination and comparison", async () => {
  const retrieval = researchRetrieval();
  const investigation = await retrieval.investigation({
    id: research.investigations[0].investigation.id,
  });
  assert.deepEqual(investigation, research.investigations[0]);
  const series = investigation.observation_series.find(
    (s) => s.statistic === "instantaneous",
  );
  const query = {
    location_id: series.location_id,
    metric: series.metric,
    observed_from: series.coverage_from,
    observed_to: series.coverage_to,
    limit: 2,
  };
  const first = await retrieval.observations(query);
  const next = await retrieval.observations({ ...query, offset: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.items[0].series_id, series.id);
  assert.notEqual(first.items[1].id, next.items[0].id);
  const compared = contracts.parse(
    "ObservationsResponse",
    await retrieval.compare(query),
    true,
  );
  assert.equal(
    compared.comparison.difference,
    first.items[1].value - first.items[0].value,
  );
  assert.equal(compared.comparison.unit, series.unit);
  assert.match(compared.limitation, /returned endpoints/);
  await assert.rejects(
    retrieval.observations({ ...query, observed_to: "2024-01-01T00:00:00Z" }),
    /ordered|range/i,
  );
});

test("actual respond tool resolves model-only citations using shared schemas and preserves audience context", async () => {
  const investigation = research.investigations[0],
    observation = investigation.observations[0];
  let supplied;
  const model = {
    async generate(contents, declarations) {
      supplied = JSON.parse(contents[0].parts[0].text);
      const respond = declarations.find(
        (declaration) => declaration.name === "respond",
      );
      assert.ok(respond);
      assert.equal(
        respond.parametersJsonSchema.properties.citations.items
          .additionalProperties,
        false,
      );
      assert.equal(
        JSON.stringify(respond.parametersJsonSchema).includes('"$ref"'),
        false,
      );
      return {
        content: { role: "model", parts: [] },
        calls: [
          {
            name: "respond",
            args: {
              answer: "Synthetic integration response; not a factual briefing.",
              citations: [
                { source_id: observation.source_id, record_id: observation.id },
              ],
              result_ids: [observation.id],
              actions: [],
            },
          },
        ],
        text: "",
      };
    },
  };
  const assistant = new Assistant(
    // The resolved investigation plus initial news/source records exceeds the
    // default context budget. Exercise success inside the configured upper bound.
    readConfig({ AI_MAX_CONTEXT_BYTES: "128000" }),
    contracts,
    researchRetrieval(),
    undefined,
    model,
  );
  const response = await assistant.answer({
    request_id: "request-1",
    message: "Explain the source limitations",
    timezone: "America/Toronto",
    audience: "journalist",
    selected_investigation_id: investigation.investigation.id,
    filters: { themes: ["flooding"] },
  });
  assert.equal(response.mode, "fixture", JSON.stringify(response.errors));
  assert.deepEqual(response.errors, []);
  assert.equal(
    response.citations[0].url,
    investigation.sources.find((s) => s.id === observation.source_id).url,
  );
  assert.equal(supplied.request.audience, "journalist");
  assert.equal(supplied.audience_context.audience, "journalist");
  assert.match(supplied.audience_context.guidance, /source trail/);
  assert.deepEqual(supplied.request.filters, { themes: ["flooding"] });
  assert.equal(response.request_id, "request-1");
});

test("a full investigation exceeding its configured context budget falls back without model calls or actions", async () => {
  let calls = 0;
  const model = {
    async generate() {
      calls++;
      throw new Error("Model must not be called");
    },
  };
  const assistant = new Assistant(
    readConfig({ AI_MAX_CONTEXT_BYTES: '4000' }),
    contracts,
    researchRetrieval(),
    undefined,
    model,
  );
  const response = await assistant.answer({
    request_id: "bounded-investigation",
    message: "Explain the investigation",
    timezone: "UTC",
    selected_investigation_id: research.investigations[0].investigation.id,
    filters: { themes: ["flooding"] },
    allow_ui_actions: true,
  });
  assert.equal(response.mode, "fallback");
  assert.equal(response.errors[0].code, "CONTEXT_LIMIT");
  assert.deepEqual(response.actions, []);
  assert.equal(calls, 0);
});

test("actual assistant rejects forged citations, unretrieved results and actions without consent", async () => {
  const article = examples.articles[0];
  const baseline = {
    answer: "Synthetic protocol output",
    citations: [{ source_id: article.source_id, record_id: article.id }],
    result_ids: [article.id],
    actions: [],
  };
  for (const change of [
    { citations: [{ ...baseline.citations[0], url: article.url }] },
    {
      citations: [
        { source_id: article.source_id, record_id: "art-unretrieved" },
      ],
    },
    { result_ids: ["art-unretrieved"] },
    { actions: [{ type: "set_filters", filters: { keyword: "changed" } }] },
    { actions: [{ type: "run_sql", sql: "SELECT 1" }] },
  ]) {
    const model = {
      async generate() {
        return {
          content: { role: "model", parts: [] },
          calls: [],
          text: JSON.stringify({ ...baseline, ...change }),
        };
      },
    };
    const assistant = new Assistant(
      readConfig({}),
      contracts,
      researchRetrieval(),
      undefined,
      model,
    );
    const response = await assistant.answer({
      request_id: "rejected",
      message: "Read only",
      timezone: "UTC",
    });
    assert.equal(response.mode, "fallback");
    assert.deepEqual(response.actions, []);
    assert.ok(response.errors.length);
  }
});

test("existing retrieval emits news/location responses accepted by the shared envelopes", async () => {
  const retrieval = new Retrieval(contracts, {
    mode: "fixture",
    async read(name) {
      if (name === "news") return examples.articles;
      if (name === "locations") return examples.locations;
      if (name === "freshness")
        return [
          {
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
          },
        ];
      throw new Error(`Unexpected repository operation ${name}`);
    },
  });
  const news = await retrieval.news({ limit: 50, offset: 0 });
  assert.equal(news.items.length, 10);
  assert.equal(news.coverage.mode, "fixture");
  const locations = await retrieval.locations({
    ids: [examples.locations[0].id],
  });
  assert.deepEqual(locations.items, [examples.locations[0]]);
  const empty = await retrieval.news({ keyword: "zz-no-match" });
  assert.deepEqual(empty.items, []);
});

test("existing backend loader imports the compiled module and provides complete contract readiness", async () => {
  const handoff = await loadHandoffs(
    readConfig({ ATLAS_CONTRACTS_MODULE: "contracts/dist/index.js" }),
  );
  for (const name of Object.keys(schemas))
    assert.equal(handoff.contracts.has(name), true);
  assert.equal(handoff.contracts.ready, true);
  assert.equal(handoff.databaseHandoff, undefined);
  assert.deepEqual(
    handoff.contracts.parse("Article", examples.articles[0], true),
    examples.articles[0],
  );
});

test("existing GET normalization feeds the shared query schema without coercion or defaults", () => {
  const normalized = normalizeQuery({
    location_ids: "loc-asheville-nc,loc-buncombe-county-nc",
    themes: "flooding",
    bounds: "-83,35,-82,36",
    limit: "20",
    offset: "0",
  });
  assert.deepEqual(contracts.parse("NewsQuery", normalized), {
    location_ids: ["loc-asheville-nc", "loc-buncombe-county-nc"],
    themes: ["flooding"],
    bounds: [-83, 35, -82, 36],
    limit: 20,
    offset: 0,
  });
  assert.throws(
    () => contracts.parse("NewsQuery", { limit: "20" }),
    /Invalid NewsQuery/,
  );
});

test("existing article normalizer supports GDELT unknown publication and RSS feed assertions", () => {
  // Synthetic protocol inputs only; no external provider is contacted.
  const definition = { id: "synthetic-feed", excerpts_permitted: false };
  const raw = {
    title: "Synthetic protocol headline",
    publisher: "Synthetic publisher",
    url: "https://example.invalid/story?utm_source=test",
    excerpt: null,
    published_at: null,
    discovered_at: "2026-01-01T00:00:00.000Z",
    publication_time_basis: "unavailable",
    provider: "gdelt",
  };
  const article = normalizeArticle(
    raw,
    definition,
    Date.parse("2026-01-02T00:00:00Z"),
    contracts,
  );
  assert.equal(article.published_at, null);
  assert.equal("published_date" in article, false);
  assert.equal(article.url, "https://example.invalid/story");
  assert.deepEqual(article.location_ids, []);
  const rss = normalizeArticle(
    {
      ...raw,
      provider: "rss",
      published_at: "2026-01-01T00:00:00.000Z",
      publication_time_basis: "feed_asserted",
      discovered_at: null,
      excerpt: "Synthetic permitted feed excerpt.",
    },
    { ...definition, excerpts_permitted: true },
    Date.parse("2026-01-02T00:00:00Z"),
    contracts,
  );
  assert.equal(rss.excerpt, "Synthetic permitted feed excerpt.");
});

test("existing citation ledger resolves original sources and rejects unsupported relationships", () => {
  const article = examples.articles[0],
    source = examples.sources.find((source) => source.id === article.source_id);
  const ledger = new EvidenceLedger();
  ledger.collect({ items: [article] });
  ledger.attach([source]);
  assert.deepEqual(
    ledger.resolve(
      [{ source_id: source.id, record_id: article.id }],
      contracts,
    ),
    [
      {
        source_id: source.id,
        record_id: article.id,
        url: source.url,
        title: source.title,
      },
    ],
  );
  assert.throws(
    () =>
      ledger.resolve(
        [{ source_id: source.id, record_id: examples.articles[1].id }],
        contracts,
      ),
    /not retrieved/,
  );
  assert.throws(
    () =>
      ledger.resolve(
        [
          {
            source_id: source.id,
            record_id: article.id,
            url: "https://example.invalid/forged",
          },
        ],
        contracts,
      ),
    /does not match/,
  );
});

test("backend configuration checker reports supplied contracts and remaining setup honestly", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/check.ts"],
    {
      cwd: fileURLToPath(new URL("../../backend/", import.meta.url)),
      encoding: "utf8",
      timeout: 15000,
      // Do not inherit credentials or load .env. This checker imports local handoffs only.
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        ATLAS_CONTRACTS_MODULE: "contracts/dist/index.js",
        ATLAS_DATABASE_MODULE: "db/handoff/database.mjs",
        ATLAS_SOURCES_MODULE: "scripts/source-definitions/atlas.mjs",
      },
    },
  );
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.contracts.complete, true);
  assert.equal(report.contracts.missing.length, 0);
  for (const name of [
    "NewsQuery",
    "NewsResponse",
    "LocationsQuery",
    "LocationsResponse",
    "Article",
    "Location",
    "Source",
    "Citation",
  ])
    assert.equal(report.contracts.missing.includes(name), false);
  assert.deepEqual(report.database.missing_plans, []);
  assert.equal(report.database.credentials_configured, false);
  assert.equal(report.live_connections_verified, false);
});

test("all real v2 and bounded research schemas compile in backend registry and project locally", async () => {
  const { modelParameters } = await import(
    "../../backend/src/services/gemini/schema.ts"
  );
  const names = [
    "AssistantRequestV2",
    "AssistantIntent",
    "AssistantFilterPatch",
    "OpenTimelineArgs",
    "UIActionV2",
    "AssistantDraftV2",
    "CitationV2",
    "AssistantResponseV2",
    "AssistantNewsSearchArgs",
    "AssistantLocationsSearchArgs",
    "AssistantArticleReadArgs",
    "AssistantInvestigationReadArgs",
    "AssistantCatalogSearchArgs",
    "AssistantSourcesReadArgs",
    "AssistantHistoryReadArgs",
    "AssistantResearchRecord",
    "AssistantToolResult",
  ];
  for (const name of names) {
    assert.ok(contracts.has(name));
    const projected = modelParameters(contracts, name);
    assert.equal(JSON.stringify(projected).includes('"$ref"'), false);
  }
});

test('actual area contracts activate the injected flight service and validate normalized identity, waiting and unavailable responses', async () => {
  const { Flights } = await import('../../backend/src/services/flights.ts');
  const { AdsbLol } = await import('../../backend/src/data/providers/adsblol.ts');
  let now = Date.parse('2026-10-17T12:00:00Z');
  const config = readConfig({NODE_ENV:'test',FLIGHTS_ENABLED:'true',FLIGHTS_CONTACT:'test@example.invalid'});
  const fetcher = async () => new Response(JSON.stringify({now,ac:[{hex:'abc123',lat:43.7,lon:-79.4,seen_pos:0,flight:' TEST ',r:' C-TEST ',t:' B738 ',alt_baro:'ground',gs:0,track:0}]}));
  // Synthetic provider payload, injected fetch: no external HTTP or database connection.
  const adapter = new AdsbLol(contracts,1000,'test@example.invalid',fetcher,()=>now);
  const flights = new Flights(contracts,config,[],adapter,()=>now);
  try {
    assert.equal(flights.areaAvailable,true);
    const ready=await flights.area({latitude:43.71,longitude:-79.41,radius_nm:97});
    contracts.parse('FlightAreaResponse',ready,true);
    assert.equal(ready.status,'ready');assert.deepEqual(ready.area,{id:'area-43.7--79.4-100',latitude:43.7,longitude:-79.4,radius_nm:100});
    assert.equal(ready.items[0].registration,'C-TEST');assert.equal(ready.items[0].aircraft_type,'B738');assert.equal(ready.items[0].operator,null);assert.equal(ready.items[0].on_ground,true);
    assert.equal(ready.items[0].heading,0);assert.equal(ready.items[0].altitude,null);
    const waiting=await flights.area({latitude:40,longitude:-74,radius_nm:100});
    contracts.parse('FlightAreaResponse',waiting,true);assert.equal(waiting.status,'waiting');assert.equal(waiting.fetched_at,null);
    now+=120000;
  } finally { await flights.close(); }
  const unavailable = new Flights(contracts,config,[],{region:async()=>[],area:async()=>{throw new Error('Synthetic outage');}},()=>now);
  try {
    const result=await unavailable.area({latitude:0,longitude:0,radius_nm:5});
    contracts.parse('FlightAreaResponse',result,true);assert.equal(result.status,'unavailable');assert.equal(result.fetched_at,null);assert.equal(result.stale,true);
  } finally { await unavailable.close(); }
});

test('actual AirLabs adapter, global service and HTTP discovery use shared schemas with no account metadata', async () => {
  const { AirLabs } = await import('../../backend/src/data/providers/airlabs.ts');
  const { GlobalFlights } = await import('../../backend/src/services/global-flights.ts');
  const { Flights } = await import('../../backend/src/services/flights.ts');
  const { buildApp } = await import('../../backend/src/app.ts');
  let now = Date.parse('2026-10-17T12:00:00Z'), requests = 0, attempts = 0;
  const config = readConfig({ NODE_ENV:'test', FLIGHTS_ENABLED:'true', FLIGHTS_PROVIDER:'airlabs', AIRLABS_API_KEY:'synthetic-key' });
  const adapter = new AirLabs(contracts, 'synthetic-key', 1000, async () => {
    requests++;
    return new Response(JSON.stringify({ request:{key:'synthetic-key'},account:{type:'private-account'}, response:[
      {hex:'abc123',lat:43,lng:-79,updated:now/1000,status:'en-route',flight_icao:' TEST ',flight_iata:'AB12',airline_icao:'ABC',airline_iata:'AB',dep_iata:'YYZ',arr_iata:'YVR',alt:1000,dir:0},
      {hex:'def456',lat:42,lng:-78,updated:now/1000,status:'en-route'}
    ] }));
  },()=>now);
  const global = new GlobalFlights(contracts,adapter,{reserve:async()=>{attempts++;}},()=>now);
  const flights = new Flights(contracts,config,[],undefined,()=>now,global);
  const repository = {mode:'fixture',async read(name) {if(name==='workspace') return [{themes:[],entities:[],investigations:[]}]; return [];},async close(){}};
  const retrieval = new Retrieval(contracts,repository);
  const app = await buildApp(config,{contracts,repository,retrieval,flights,assistant:new Assistant(config,contracts,retrieval,flights)});
  try {
    const catalog=(await app.inject({url:'/api/workspace'})).json();
    contracts.parse('WorkspaceResponse',catalog,true);
    assert.equal(catalog.capabilities.flight_global,true);assert.equal(catalog.capabilities.flights,false);assert.equal(catalog.capabilities.flight_areas,false);
    assert.equal(attempts,0);
    const invalid=await app.inject({url:'/api/flights/global?zoom=1'});assert.equal(invalid.statusCode,400);assert.equal(attempts,0);
    const [a,b]=await Promise.all([app.inject({url:'/api/flights/global'}),app.inject({url:'/api/flights/global'})]);
    assert.equal(a.statusCode,200);assert.equal(a.headers['cache-control'],'no-store');assert.deepEqual(a.json(),b.json());assert.equal(requests,1);assert.equal(attempts,1);
    const response=contracts.parse('FlightGlobalResponse',a.json(),true),item=response.items[0];
    assert.equal(item.altitude_unit,'m');assert.equal(item.altitude_reference,'unknown');assert.equal(item.speed,null);assert.equal(item.direction_kind,'direction');assert.equal(item.heading,0);
    assert.equal(item.airline_icao,'ABC');assert.equal(item.departure_iata,'YYZ');assert.equal(response.items[1].callsign,null);assert.equal(response.items[1].operator,null);
    assert.ok(!/synthetic-key|private-account|account|api_key/.test(a.body));
    now+=300_000;
    const second=contracts.parse('FlightGlobalResponse',(await app.inject({url:'/api/flights/global'})).json(),true);
    assert.notEqual(second.snapshot_id,response.snapshot_id);assert.equal(second.trails[0].points.length,2);assert.equal(requests,2);
  } finally {await app.close();}
  for (const [code,pause_reason] of [['AIRLABS_AUTH','authentication'],['FLIGHT_QUOTA','quota'],['FLIGHT_LEDGER','configuration'],['NETWORK','unavailable']]) {
    const service=new GlobalFlights(contracts,{snapshot:async()=>{throw Object.assign(new Error('private provider body'),{code});}},{reserve:async()=>{}},()=>now);
    try {
      const response=contracts.parse('FlightGlobalResponse',await service.get(),true);
      assert.equal(response.status,'unavailable');assert.equal(response.snapshot_id,null);assert.equal(response.fetched_at,null);assert.deepEqual(response.items,[]);assert.deepEqual(response.trails,[]);
      assert.equal(response.pause_reason,pause_reason==='unavailable'?null:pause_reason);
      assert.equal(response.retry_at===null,pause_reason!=='unavailable');assert.ok(!JSON.stringify(response).includes('private provider body'));
    } finally {await service.close();}
  }
  // Deliberately omit the new export to verify fail-closed behavior after activation.
  const {FlightGlobalResponse: omitted,...legacy}=schemas;
  let reserved=0;
  const absent=new GlobalFlights(new Contracts(legacy),{snapshot:async()=>{throw new Error('must not call');}},{reserve:async()=>{reserved++;}});
  try {await assert.rejects(absent.get(),/contracts/);assert.equal(reserved,0);} finally {await absent.close();}
});
