import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AtlasApi } from "./api";
export function useFlights(api: AtlasApi, region: string, enabled: boolean) {
  const [visible, setVisible] = useState(
      () => typeof document !== "undefined" && !document.hidden,
    ),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const visibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    const timer = enabled
      ? setInterval(() => setNow(Date.now()), 15000)
      : undefined;
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      clearInterval(timer);
    };
  }, [enabled]);
  const query = useQuery({
    queryKey: [api.mode, "flights", region],
    enabled: enabled && visible && !!region && !!api.flights,
    queryFn: ({ signal }) => api.flights!(region, signal),
    retry: false,
    refetchInterval: (q) =>
      Math.max(
        60000,
        Date.parse(q.state.data?.retry_at ?? "") - Date.now() || 60000,
      ),
    refetchIntervalInBackground: false,
  });
  return {
    query,
    stale:
      !!query.data &&
      (query.data.stale ||
        query.isError ||
        now - Date.parse(query.data.fetched_at) > 120000),
    aircraft: enabled
      ? (query.data?.items ?? []).filter(
          (a) => now - Date.parse(a.observed_at) <= 300000,
        )
      : [],
    now,
  };
}
