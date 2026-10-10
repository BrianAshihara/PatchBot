import type { SourcePatch } from "./registry";

export const DDRAGON_VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
/** Lista oficial de notas de patch: sempre existe e mostra o patch mais recente no topo. */
export const LOL_PATCH_NOTES_URL = "https://www.leagueoflegends.com/pt-br/news/tags/patch-notes/";
const LOL_NEWS = "https://www.leagueoflegends.com/pt-br/news/game-updates";

/**
 * O Data Dragon numera internamente (16.20) e a Riot anuncia pelo ano (26.20): 16 = temporada 2026.
 * Se a Riot mudar essa relação, só o nome mostrado no anúncio fica errado; a detecção continua funcionando.
 */
const SEASON_OFFSET = 10;

/** Busca o patch atual do LoL no Data Dragon. Uma subrequisição. */
export async function fetchLolPatch(now = Date.now()): Promise<SourcePatch[]> {
  // no-store: nunca usar uma resposta guardada em cache pela Cloudflare.
  const res = await fetch(DDRAGON_VERSIONS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Data Dragon: HTTP ${res.status}`);
  return parseVersions(await res.json(), now);
}

/**
 * `["16.20.1", ...]` → id `16.20` (correções pequenas não geram outro anúncio), anunciado como "Patch 26.20".
 * O link direto para as notas é testado na detecção (`urlCandidates`); se nenhum existir, fica a lista oficial.
 */
export function parseVersions(versions: unknown, now: number): SourcePatch[] {
  const latest = Array.isArray(versions) ? versions[0] : undefined;
  const match = typeof latest === "string" ? /^(\d+)\.(\d+)/.exec(latest) : null;
  if (!match) throw new Error("Data Dragon: unexpected versions.json");
  const [major, minor] = [Number(match[1]), Number(match[2])];
  const season = major + SEASON_OFFSET;
  return [
    {
      patchId: `${major}.${minor}`,
      title: `Patch ${season}.${minor}`,
      url: LOL_PATCH_NOTES_URL,
      // Formato usado desde o 26.4; o 26.1 ao 26.3 usaram o segundo.
      urlCandidates: [
        `${LOL_NEWS}/league-of-legends-patch-${season}-${minor}-notes/`,
        `${LOL_NEWS}/patch-${season}-${minor}-notes/`,
      ],
      contents: null,
      image: null,
      publishedAt: now,
    },
  ];
}
