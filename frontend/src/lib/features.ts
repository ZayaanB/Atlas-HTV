import { useQuery } from "@tanstack/react-query";
import type { AtlasApi } from "./api";
import { readContract } from "./validation";
export function useCatalog(api: AtlasApi) {
  return useQuery({
    queryKey: [api.mode, "workspace"],
    queryFn: ({ signal }) => {
      if (!api.workspace)
        throw new Error("Workspace discovery is not connected.");
      return api.workspace(signal);
    },
    retry: false,
    staleTime: 60_000,
  });
}
export function useInvestigation(api: AtlasApi, id: string | null) {
  return useQuery({
    queryKey: [api.mode, "investigation", id],
    enabled: !!id,
    queryFn: async ({ signal }) => {
      if (!id || !api.investigation)
        throw new Error("Investigations are not connected.");
      readContract("InvestigationQuery", { id });
      const data = readContract(
        "InvestigationResponse",
        await api.investigation(id, signal),
      );
      if (data.investigation.id !== id)
        throw new Error("The investigation response has a mismatched ID.");
      return data;
    },
  });
}
export function readSaved(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem("atlas.saved.v1") ?? "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (id): id is string =>
              typeof id === "string" &&
              /^[a-z0-9][a-z0-9._:-]{0,159}$/.test(id),
          )
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
export function writeSaved(ids: string[]): boolean {
  try {
    localStorage.setItem(
      "atlas.saved.v1",
      JSON.stringify([...new Set(ids)].slice(0, 100)),
    );
    return true;
  } catch {
    return false;
  }
}
