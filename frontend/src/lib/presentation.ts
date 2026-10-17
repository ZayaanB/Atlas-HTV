import type { Article } from "@atlas/contracts";
export const dateTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(value)) + " UTC"
    : "Unavailable";
export const publication = (article: Article) =>
  article.published_at
    ? dateTime(article.published_at)
    : article.published_date
      ? `${article.published_date} · date only`
      : "Publication date unavailable";
export const words = (value: string) =>
  value.replaceAll("_", " ").replaceAll("-", " ");
export function evidenceUrl(path: string): string | null {
  if (
    !/^assets\/evidence\/[a-zA-Z0-9_./-]+\.png$/.test(path) ||
    path.split("/").includes("..")
  )
    return null;
  return "/" + path;
}
