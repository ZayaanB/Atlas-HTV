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
// Attribution and use notes the reviewed source definitions require next to each record
// (scripts/source-definitions/README.md). Keyed on stored provider/publisher values, never on guesses.
export function providerNote(article: Article): string | null {
  if (article.provider === "gdelt")
    return "News discovery via the GDELT Project (gdeltproject.org). Title and link only.";
  if (article.provider === "rss" && article.publisher === "GDACS")
    return "Source: GDACS, CC BY 4.0. Alerts are indicative; check official sources before acting.";
  return null;
}
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
