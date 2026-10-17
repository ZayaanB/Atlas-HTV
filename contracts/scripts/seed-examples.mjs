// Offline fixture projection from Person 4's committed seed, never SQL execution or ingestion.
// Only the seed's literal VALUES lists are supported; fail rather than interpret SQL expressions.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function tuples(fragment) {
  const rows = [];
  const rowPattern = /\((?:'(?:[^']|'')*'|[^'()])*\)/g;
  let end = 0;
  for (const match of fragment.matchAll(rowPattern)) {
    if (!/^[\s,]*$/.test(fragment.slice(end, match.index)))
      throw new Error("Unsupported seed VALUES syntax");
    const body = match[0].slice(1, -1);
    const token =
      /\s*('(?:[^']|'')*'|NULL|-?[0-9]+(?:\.[0-9]+)?)(?:\s*,|\s*$)/gy;
    const values = [];
    while (token.lastIndex < body.length) {
      const value = token.exec(body)?.[1];
      if (value === undefined) throw new Error("Expected a literal seed value");
      values.push(
        value === "NULL"
          ? null
          : value.startsWith("'")
            ? value.slice(1, -1).replaceAll("''", "'")
            : Number(value),
      );
    }
    rows.push(values);
    end = match.index + match[0].length;
  }
  if (!rows.length || !/^[\s,]*$/.test(fragment.slice(end)))
    throw new Error("Incomplete seed VALUES list");
  return rows;
}

export function literalRecords(sql, table) {
  const pattern = new RegExp(
    `INSERT INTO atlas\\.${table} \\(([^)]+)\\) VALUES\\n([\\s\\S]*?);\\n`,
    "g",
  );
  const matches = [...sql.matchAll(pattern)];
  if (!matches.length) throw new Error(`Missing literal seed table: ${table}`);
  return matches.flatMap((match) => {
    const columns = match[1].split(",").map((column) => column.trim());
    return tuples(match[2]).map((values) => {
      if (columns.length !== values.length)
        throw new Error(`Column mismatch in ${table}`);
      return Object.fromEntries(
        columns.map((column, index) => [column, values[index]]),
      );
    });
  });
}

const iso = (value) => (value === null ? null : new Date(value).toISOString());

export async function seedExamples() {
  const seedPath = "db/seeds/helene-asheville-2024/records.sql";
  const sql = await readFile(
    new URL(`../../${seedPath}`, import.meta.url),
    "utf8",
  );
  const sources = literalRecords(sql, "sources").map(
    ({ reviewed_at, ...source }) => ({
      ...source,
      published_at: iso(source.published_at),
      retrieved_at: iso(source.retrieved_at),
    }),
  );
  const locations = literalRecords(sql, "locations").map((location) => ({
    id: location.id,
    name: location.name,
    precision: location.precision,
    coordinates:
      location.longitude === null
        ? null
        : [location.longitude, location.latitude],
    bounds:
      location.bounds_west === null
        ? null
        : [
            location.bounds_west,
            location.bounds_south,
            location.bounds_east,
            location.bounds_north,
          ],
    coordinates_basis: location.coordinates_basis,
    bounds_basis: location.bounds_basis,
    source_id: location.source_id,
    verification_status: location.verification_status,
  }));
  const links = Object.fromEntries(
    ["locations", "entities", "themes"].map((name) => [
      name,
      literalRecords(sql, `article_${name}`),
    ]),
  );
  const linkedIds = (name, column, articleId) =>
    links[name]
      .filter((row) => row.article_id === articleId)
      .map((row) => row[column])
      .sort();
  const articleValues =
    /FROM \(VALUES\n([\s\S]*?)\n\) AS a \(id, source_id, precision\)/.exec(
      sql,
    )?.[1];
  if (!articleValues) throw new Error("Missing curated article projection");
  const articles = tuples(articleValues).map(([id, sourceId, precision]) => {
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error(`Missing original source ${sourceId}`);
    return {
      id,
      source_id: source.id,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      excerpt: null,
      published_at: source.published_at,
      published_date: source.published_date,
      publication_time_basis: source.published_at_basis,
      event_at: null,
      discovered_at: null,
      fetched_at: source.retrieved_at,
      location_ids: linkedIds("locations", "location_id", id),
      entity_ids: linkedIds("entities", "entity_id", id),
      themes: linkedIds("themes", "theme_id", id),
      provider: "curated",
      provider_source_id: "curated-seed-helene-asheville-2024",
      verification_status: "reviewed",
      geographic_precision: precision,
      content_hash: createHash("sha256")
        .update(JSON.stringify([source.title, null]))
        .digest("hex"),
    };
  });
  const citations = articles.map((article) => ({
    source_id: article.source_id,
    record_id: article.id,
    url: article.url,
    title: article.title,
  }));
  return {
    provenance: {
      kind: "curated_seed_projection",
      seed_path: seedPath,
      seed_sha256: createHash("sha256").update(sql).digest("hex"),
      live: false,
    },
    articles,
    locations,
    sources,
    citations,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await writeFile(
    new URL("../examples/helene-core.json", import.meta.url),
    `${JSON.stringify(await seedExamples(), null, 2)}\n`,
  );
}
