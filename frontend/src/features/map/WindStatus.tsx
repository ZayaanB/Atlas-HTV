import type { useWind } from "../../lib/wind";

export function WindStatus({ wind, onOpenLayers }: { wind: ReturnType<typeof useWind>; onOpenLayers: () => void }) {
  const times = wind.samples.map(sample => sample.valid_at).sort();
  const time = times[0]?.slice(0, 16).replace("T", " ");
  const lastTime = times.at(-1)?.slice(0, 16).replace("T", " ");
  const speeds = wind.samples.map(sample => sample.speed_kmh);
  const title = wind.expired ? "Wind data expired" : wind.query.isError && !wind.samples.length ? "Wind unavailable"
    : wind.stale ? "Wind · cached estimate" : wind.query.isFetching || wind.query.isPending ? "Wind · loading…" : "Wind · model estimates";
  return <section className="wind-status" aria-label="Wind data" aria-live="polite">
    <button className="text-button" onClick={onOpenLayers}>{title}</button>
    {time && <p>10 m · {wind.samples.length} samples · {Math.round(Math.min(...speeds))}–{Math.round(Math.max(...speeds))} km/h</p>}
    {time && <p>Model time: {time}{lastTime !== time ? ` – ${lastTime}` : ""} UTC</p>}
    {!!wind.samples.length && <p>Arrows: flow direction. Dots: calm/unknown direction.</p>}
    {!!wind.samples.length && <p>Coarse model grid, not street-level measurements.</p>}
    {!wind.query.isFetching && !wind.query.isError && !wind.samples.length && <p>No recent model samples for this view.</p>}
    {wind.query.isError && <p>{wind.query.error.message}</p>}
    {wind.stale && <p>Estimates may be out of date.</p>}
    <p><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></p>
  </section>;
}
