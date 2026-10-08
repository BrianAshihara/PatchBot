import type { SourcePatch } from "./registry";

export const DDRAGON_VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
export const LOL_PATCH_NOTES_URL = "https://www.leagueoflegends.com/pt-br/news/game-updates/";

/** Busca o patch atual do LoL no Data Dragon. Uma subrequisição. */
export async function fetchLolPatch(now = Date.now()): Promise<SourcePatch[]> {
  const res = await fetch(DDRAGON_VERSIONS_URL);
  if (!res.ok) throw new Error(`Data Dragon: HTTP ${res.status}`);
  return parseVersions(await res.json(), now);
}

/** `["16.19.1", ...]` → patch `16.19`, para correções pequenas não gerarem outro anúncio. */
export function parseVersions(versions: unknown, now: number): SourcePatch[] {
  const latest = Array.isArray(versions) ? versions[0] : undefined;
  const match = typeof latest === "string" ? /^(\d+)\.(\d+)/.exec(latest) : null;
  if (!match) throw new Error("Data Dragon: unexpected versions.json");
  const patchId = `${match[1]}.${match[2]}`;
  return [{ patchId, title: `Patch ${patchId}`, url: LOL_PATCH_NOTES_URL, contents: null, image: null, publishedAt: now }];
}
