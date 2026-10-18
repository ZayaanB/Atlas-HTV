import examples from "@atlas/contracts/examples/helene-api.json";
import type { Article, Location, NewsQuery } from "@atlas/contracts";
import { matchesNewsCategories } from "@atlas/contracts";
import type { AtlasApi } from "./api";
import { normalizeNewsQuery } from "./api";
import { readContract } from "./validation";

const news = readContract("NewsResponse", examples.news);
const locations = readContract("LocationsResponse", examples.locations);
function within(
  location: Location,
  bounds: NonNullable<NewsQuery["bounds"]>,
): boolean {
  const [w, s, e, n] = bounds;
  if (location.bounds) {
    const [lw, ls, le, ln] = location.bounds;
    return lw >= w && ls >= s && le <= e && ln <= n;
  }
  return (
    !!location.coordinates &&
    location.coordinates[0] >= w &&
    location.coordinates[0] <= e &&
    location.coordinates[1] >= s &&
    location.coordinates[1] <= n
  );
}
function matches(article: Article, query: NewsQuery): boolean {
  if (!matchesNewsCategories(article, query)) return false;
  for (const key of ["location_ids", "themes", "entity_ids"] as const) {
    if (
      query[key]?.length &&
      !query[key].some((id) => article[key].includes(id))
    )
      return false;
  }
  const keyword = (query.keyword || query.semantic_query || "")
    .trim()
    .toLocaleLowerCase("en");
  if (
    keyword &&
    !`${article.title} ${article.excerpt}`
      .toLocaleLowerCase("en")
      .includes(keyword)
  )
    return false;
  if ((query.published_from || query.published_to) && !article.published_at)
    return false;
  if (
    query.published_from &&
    Date.parse(article.published_at!) < Date.parse(query.published_from)
  )
    return false;
  if (
    query.published_to &&
    Date.parse(article.published_at!) > Date.parse(query.published_to)
  )
    return false;
  if (
    query.bounds &&
    !locations.items.some(
      (l) => article.location_ids.includes(l.id) && within(l, query.bounds!),
    )
  )
    return false;
  return true;
}
export function createFixtureApi(): AtlasApi {
  return {
    mode: "fixture",
    async workspace(signal) {
      signal.throwIfAborted();
      const { default: data } = await import(
        "@atlas/contracts/examples/helene-research.json"
      );
      return readContract("WorkspaceResponse", data.workspace);
    },
    async investigation(id, signal) {
      signal.throwIfAborted();
      const { default: data } = await import(
        "@atlas/contracts/examples/helene-research.json"
      );
      const item = data.investigations.find((x) => x.investigation.id === id);
      if (!item)
        throw new Error(
          "Investigation unavailable in this historical collection.",
        );
      return readContract("InvestigationResponse", item);
    },
    async observations(query, signal) {
      signal.throwIfAborted();
      readContract("ObservationsQuery", query);
      const { default: data } = await import(
        "@atlas/contracts/examples/helene-research.json"
      );
      const items = data.observations
        .filter(
          (o) =>
            (!query.location_id || o.location_id === query.location_id) &&
            (!query.metric || o.metric === query.metric) &&
            (!query.series_id || o.series_id === query.series_id) &&
            (!query.observed_from || o.observed_at >= query.observed_from) &&
            (!query.observed_to || o.observed_at <= query.observed_to),
        )
        .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
      return readContract("ObservationsResponse", {
        items: items.slice(
          query.offset ?? 0,
          (query.offset ?? 0) + (query.limit ?? 100),
        ),
        coverage: news.coverage,
        aggregation: "raw",
      });
    },
    async compare(query, signal) {
      readContract("CompareObservationsArgs", query);
      const response = await createFixtureApi().observations!(query, signal);
      const first = response.items[0],
        last = response.items.at(-1);
      const comparable =
        !!first &&
        !!last &&
        first.id !== last.id &&
        response.items.every(
          (o) =>
            o.source_id === first.source_id &&
            o.unit === first.unit &&
            o.metric === first.metric &&
            o.series_id === first.series_id &&
            o.value !== null,
        );
      return readContract("ObservationsResponse", {
        ...response,
        comparison: comparable
          ? {
              first_id: first.id,
              last_id: last.id,
              difference: last.value! - first.value!,
              unit: first.unit,
            }
          : null,
        limitation: comparable
          ? "Capped raw observations: difference between returned endpoints only, not a complete-period analysis."
          : "Two comparable numeric observations are required.",
      });
    },
    async assistant(request, signal) {
      signal.throwIfAborted();
      return readContract("AssistantResponse", {
        request_id: request.request_id,
        answer:
          "Assistant explanation unavailable in historical fixture mode. Explore the source-linked investigation and manual filters; no AI explanation has been generated.",
        citations: [],
        result_ids: [],
        actions: [],
        coverage: news.coverage,
        mode: "fallback",
        errors: [
          {
            code: "FIXTURE_MODE",
            message: "No provider request was made.",
            retryable: false,
          },
        ],
      });
    },
    async news(raw, signal) {
      signal.throwIfAborted();
      const query = normalizeNewsQuery(raw),
        offset = query.offset!,
        limit = query.limit!;
      return readContract("NewsResponse", {
        ...news,
        items: news.items
          .filter((a) => matches(a, query))
          .slice(offset, offset + limit),
        offset,
        limit,
        search_mode: query.semantic_query ? "keyword_fallback" : "keyword",
      });
    },
    async locations(query, signal) {
      signal.throwIfAborted();
      readContract("LocationsQuery", query);
      const offset = query.offset ?? 0,
        limit = query.limit ?? 50;
      return readContract("LocationsResponse", {
        ...locations,
        items: locations.items
          .filter(
            (l) =>
              (!query.ids?.length || query.ids.includes(l.id)) &&
              (!query.query ||
                l.name
                  .toLocaleLowerCase("en")
                  .includes(query.query.toLocaleLowerCase("en"))),
          )
          .slice(offset, offset + limit),
      });
    },
  };
}
