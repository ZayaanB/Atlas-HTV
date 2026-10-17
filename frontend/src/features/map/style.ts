import type { AtlasMapProps, Coordinates } from "../../app/map-interface";
export const GLOBE_CENTER: Coordinates = [-100, 32];
/** Fitting a whole globe uses symmetric room around the full viewport center. */
export function homeZoom(
  width: number,
  height: number,
  insets: AtlasMapProps["overlayInsets"],
): number {
  const mobile = width < 1200;
  const side = mobile ? 0 : Math.max(insets?.left ?? 0, insets?.right ?? 0);
  const vertical = mobile ? 0 : Math.max(insets?.top ?? 0, insets?.bottom ?? 0);
  const diameter = Math.max(
    100,
    Math.min(
      height * 0.7,
      width - 2 * (side + 32),
      mobile
        ? height - (insets?.bottom ?? 0) - 110
        : height - 2 * (vertical + 36),
    ),
  );
  // Mapbox's globe radius is worldSize/(2π); keep a safety margin for perspective.
  return Math.max(
    -1,
    Math.min(2.4, Math.log2((diameter * Math.PI) / 512) - 0.15),
  );
}

export function homePadding(
  width: number,
  insets: AtlasMapProps["overlayInsets"],
  height = typeof window === "undefined" ? 900 : window.innerHeight,
) {
  return width < 1200 && insets?.bottom
    ? {
        top: 40,
        right: 0,
        bottom: Math.min(insets.bottom + 96, height - 140),
        left: 0,
      }
    : 0;
}
