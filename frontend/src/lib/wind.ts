import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { WindQuery } from "@atlas/contracts";
import type { ViewportSnapshot } from "../app/map-interface";
import type { AtlasApi } from "./api";

export function windBounds(viewport: ViewportSnapshot | null): WindQuery["bounds"] | null {
  if (!viewport || viewport.bounds.some(value => !Number.isFinite(value))) return null;
  const [west, south, east, north] = viewport.bounds;
  let width = east - west;
  if (width < 0) width += 360;
  if (width <= 0) return null;
  const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
  const bottom = Math.max(-90, south), top = Math.min(90, north);
  if (bottom >= top) return null;
  const bounds = width >= 360 ? [-180, bottom, 180, top] : [wrap(west), bottom, wrap(west + width), top];
  return bounds.map(value => Number(value.toFixed(6))) as WindQuery["bounds"];
}

export function useWind(api: AtlasApi, viewport: ViewportSnapshot | null, enabled: boolean) {
  const client = useQueryClient();
  const [visible, setVisible] = useState(() => !document.hidden);
  const [area, setArea] = useState<WindQuery["bounds"] | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastArea = useRef(0);
  const boundsKey = JSON.stringify(windBounds(viewport));
  useEffect(() => {
    const visibility = () => { setVisible(!document.hidden); setNow(Date.now()); };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (!enabled) { setArea(null); return; }
    if (!visible || !api.wind || boundsKey === "null" || boundsKey === JSON.stringify(area)) return;
    const timer = setTimeout(() => {
      setArea(JSON.parse(boundsKey) as WindQuery["bounds"]);
      lastArea.current = Date.now();
    }, area ? Math.max(800, 10000 - (Date.now() - lastArea.current)) : 0);
    return () => clearTimeout(timer);
  }, [enabled, visible, api.wind, boundsKey, area]);
  const key = [api.mode, "wind", area] as const;
  const query = useQuery({
    queryKey: key,
    enabled: enabled && visible && !!area && !!api.wind,
    queryFn: ({ signal }) => api.wind!({ bounds: area! }, signal),
    retry: false, staleTime: 15 * 60000, gcTime: 15 * 60000,
    refetchInterval: q => Math.max(60000, Date.parse(q.state.data?.next_refresh_at ?? "") - Date.now() || 60000),
    refetchIntervalInBackground: false,
  });
  const areaKey = JSON.stringify(area);
  useEffect(() => {
    if (enabled && visible) return;
    void client.cancelQueries({ queryKey: [api.mode, "wind", area], exact: true });
  }, [enabled, visible, areaKey, api.mode, client]);
  useEffect(() => {
    if (!enabled || !visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [enabled, visible]);
  const expired = !!query.data && now - Date.parse(query.data.fetched_at) >= 60 * 60000;
  const stale = !!query.data && (query.data.stale || query.isError || now - Date.parse(query.data.fetched_at) >= 15 * 60000);
  return {
    query, stale, expired,
    samples: enabled && visible && !expired ? (query.data?.items ?? []).filter(sample =>
      now - Date.parse(sample.valid_at) <= 60 * 60000 && Date.parse(sample.valid_at) <= now + 15 * 60000) : [],
  };
}
