import { expect, it, vi } from "vitest";
import type { Article, Location } from "@atlas/contracts";
// The feature builder is pure; the Mapbox runtime is not needed to test it.
vi.mock("mapbox-gl", () => ({ default: {} }));
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));
const { makeLocations } = await import("../src/features/map/AtlasMap");

const region = (id: string, verification_status: Location["verification_status"]): Location => ({
  id, name: `Test ${id}`, precision: "region", coordinates: [66.25, 28.5], bounds: [62.25, 24.5, 70.25, 32.5],
  coordinates_basis: "test point", bounds_basis: "test box", source_id: "test-source", verification_status,
});
const article = { id: "test-article", location_ids: ["test-provider", "test-reviewed"] } as unknown as Article;

it("draws unreviewed provider regions at their published point, never as a filled extent", () => {
  const { features } = makeLocations([article], [region("test-provider", "unreviewed"), region("test-reviewed", "reviewed")], null, null);
  const provider = features.find((f) => f.id === "test-provider")!;
  const reviewed = features.find((f) => f.id === "test-reviewed")!;
  expect(provider.geometry).toEqual({ type: "Point", coordinates: [66.25, 28.5] });
  expect(provider.properties).toMatchObject({ provisional: true, articleIds: ["test-article"] });
  // A reviewed region keeps its sourced extent and its optional coordinates are not a pin.
  expect(reviewed.geometry.type).toBe("Polygon");
  expect(reviewed.properties.provisional).toBe(false);
});
