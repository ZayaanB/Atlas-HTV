export type IconName =
  | "search"
  | "news"
  | "close"
  | "back"
  | "layers"
  | "globe"
  | "plus"
  | "minus"
  | "bookmark"
  | "arrow"
  | "filter"
  | "spark"
  | "expand"
  | "collapse"
  | "chevron"
  | "fullscreen"
  | "restore"
  | "info";
const paths: Record<IconName, string> = {
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  news: "M5 3h14v18H5zM8 7h8M8 11h8M8 15h3M14 15h2M8 18h8",
  close: "M6 6l12 12M6 18L18 6",
  back: "M15 5l-7 7 7 7",
  layers: "M12 3l10 6-10 6L2 9zM2 13l10 6 10-6M2 17l10 6 10-6",
  globe:
    "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M2 12h20M12 2c6 6 6 14 0 20-6-6-6-14 0-20",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  bookmark: "M6 3h12v19l-6-4-6 4z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  filter: "M3 5h18M6 12h12M10 19h4",
  spark: "M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z",
  expand: "M5 9l7-7 7 7M5 21l7-7 7 7",
  collapse: "M5 3l7 7 7-7M5 15l7 7 7-7",
  chevron: "M6 9l6 6 6-6",
  fullscreen: "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5",
  restore: "M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3",
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
