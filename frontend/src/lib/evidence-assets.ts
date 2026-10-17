const assets = import.meta.glob("../../../assets/evidence/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
export function localEvidenceAsset(path: string): string | null {
  if (
    !/^assets\/evidence\/[a-zA-Z0-9_./-]+\.png$/.test(path) ||
    path.split("/").includes("..")
  )
    return null;
  return assets["../../../" + path] ?? null;
}
