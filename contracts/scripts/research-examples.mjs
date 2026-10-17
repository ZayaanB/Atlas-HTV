// Offline projection only. Never executes SQL, imports into a database, or contacts providers.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { literalRecords, seedExamples, tuples } from "./seed-examples.mjs";
const core = await seedExamples();
const sql = (
  await readFile(
    new URL(
      "../../db/seeds/helene-asheville-2024/records.sql",
      import.meta.url,
    ),
    "utf8",
  )
).replaceAll("INTERVAL '15 minutes'", "900");
const rows = (table) => literalRecords(sql, table);
const iso = (value) => (value === null ? null : new Date(value).toISOString());
const ordered = (table, id) =>
  rows(table)
    .filter((x) => x.investigation_id === id)
    .sort((a, b) => a.position - b.position);
const series = rows("observation_series").map(
  ({ expected_interval, ...x }) => ({
    ...x,
    expected_interval_seconds: expected_interval,
    coverage_from: iso(x.coverage_from),
    coverage_to: iso(x.coverage_to),
    retrieved_at: iso(x.retrieved_at),
    live: false,
  }),
);
const items = rows("investigation_items"),
  itemSources = rows("investigation_item_sources");
const extraEvidenceSources = tuples(
  /UNION ALL VALUES\n([\s\S]*?);/.exec(
    sql.slice(sql.indexOf("INSERT INTO atlas.evidence_sources")),
  )[1],
);
const evidence = rows("evidence").map((x) => ({
  id: x.id,
  type: x.evidence_type,
  title: x.title,
  description: x.description,
  limitations: x.limitations,
  source_id: x.source_id,
  source_ids: [
    x.source_id,
    ...extraEvidenceSources
      .filter(([id]) => id === x.id)
      .map(([, source]) => source),
  ],
  observed_from: iso(x.observed_from),
  observed_to: iso(x.observed_to),
  location_id: x.location_id,
  series_id: x.series_id ?? null,
  imagery:
    x.evidence_type === "imagery"
      ? {
          bounds: [
            x.bounds_west,
            x.bounds_south,
            x.bounds_east,
            x.bounds_north,
          ],
          asset_path: x.asset_path,
          layer_ref: x.layer_ref,
          legend: x.legend,
          attribution: x.attribution,
          license: x.license,
          resolution_m: x.resolution_m,
          comparison_group: x.comparison_group,
          comparison_role: x.comparison_role,
        }
      : null,
}));
// CSV decoding preserves quoted qualifier lists; all observations retain the archived values.
const csv = await readFile(
  new URL(
    "../../db/seeds/helene-asheville-2024/observations.csv",
    import.meta.url,
  ),
  "utf8",
);
const lines = csv.trim().split("\n");
const parse = (line) =>
  [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((m) =>
    (m[1] ?? m[2]).replaceAll('""', '"'),
  );
const keys = parse(lines.shift());
const observations = lines
  .map((line) => Object.fromEntries(parse(line).map((v, i) => [keys[i], v])))
  .map((x) => {
    const s = series.find((s) => s.id === x.series_id);
    return {
      ...x,
      id:
        x.series_id +
        "@" +
        x.observed_at.replaceAll(/[-:]/g, "").replace(".000", ""),
      location_id: s.location_id,
      metric: s.metric,
      unit: s.unit,
      source_id: s.source_id,
      value: x.value === "" ? null : Number(x.value),
      qualifiers: x.qualifiers.replace(/[{}]/g, "").split(",").filter(Boolean),
      fetched_at: iso(x.fetched_at),
      period_start: x.period_start ? iso(x.period_start) : null,
      period_end: x.period_end ? iso(x.period_end) : null,
    };
  });
const investigations = rows("investigations").map((x) => {
  const id = x.id,
    linked = (table, key) => ordered(table, id).map((x) => x[key]);
  const keyObservations = ordered("investigation_observations", id).map(
    (x) => ({
      observation_id:
        x.series_id +
        "@" +
        iso(x.observed_at).replaceAll(/[-:]/g, "").replace(".000", ""),
      role: x.role,
    }),
  );
  return {
    investigation: {
      id,
      title: x.title,
      summary: x.summary,
      primary_location_id: x.primary_location_id,
      event_period: {
        start_date: x.event_start_date,
        end_date: x.event_end_date,
        timezone: x.event_timezone,
      },
      content_status: x.content_status,
      verification_status: x.verification_status,
      reviewed_at: iso(x.reviewed_at),
      location_ids: linked("investigation_locations", "location_id"),
      article_ids: linked("investigation_articles", "article_id"),
      evidence_ids: linked("investigation_evidence", "evidence_id"),
      series_ids: linked("investigation_series", "series_id"),
      key_observations: keyObservations,
      items: items
        .filter((i) => i.investigation_id === id)
        .map(({ investigation_id, position, ...i }) => ({
          ...i,
          source_ids: itemSources
            .filter((s) => s.item_id === i.id)
            .map((s) => s.source_id),
        })),
    },
    articles: core.articles.filter((a) =>
      linked("investigation_articles", "article_id").includes(a.id),
    ),
    evidence: evidence.filter((e) =>
      linked("investigation_evidence", "evidence_id").includes(e.id),
    ),
    observations: observations.filter((o) =>
      keyObservations.some((k) => k.observation_id === o.id),
    ),
    observation_series: series.filter((s) =>
      linked("investigation_series", "series_id").includes(s.id),
    ),
    locations: core.locations,
    sources: core.sources,
  };
});
const workspace = {
  capabilities: {
    investigations: true,
    assistant: false,
    flights: false,
    observations: true,
    assistant_context: false,
    series_filter: true,
  },
  themes: rows("themes").map((x) => ({ id: x.id, label: x.label })),
  entities: rows("entities").map((x) => ({ id: x.id, label: x.name })),
  flight_regions: [],
  investigations: investigations.map(({ investigation: i }) => ({
    id: i.id,
    title: i.title,
    article_ids: i.article_ids,
  })),
};
await writeFile(
  new URL("../examples/helene-research.json", import.meta.url),
  JSON.stringify({
    provenance: {
      ...core.provenance,
      observations_path: "db/seeds/helene-asheville-2024/observations.csv",
      observations_sha256: createHash("sha256").update(csv).digest("hex"),
    },
    workspace,
    investigations,
    observations,
  }) + "\n",
);
console.log(
  `Projected ${investigations.length} investigation and ${observations.length} archived observations (offline).`,
);
