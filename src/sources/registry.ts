import { fetchLolPatch } from "./ddragon";
import type { Game } from "./games";
import { fetchSteamPatches } from "./steam";

export { GAMES, gameImage, getGame, isMajor, sourceInfo, type Game, type Source } from "./games";

/** Um patch como a fonte devolve, antes da formatação. */
export interface SourcePatch {
  patchId: string;
  title: string;
  url: string;
  /** Notas brutas (BBCode da Steam), ou null quando a fonte não tem o texto completo (LoL). */
  contents: string | null;
  /** Primeira imagem do post, se houver. */
  image: string | null;
  /** Links mais diretos que `url`, em ordem de preferência; a detecção usa o primeiro que existir. */
  urlCandidates?: string[];
  /** Unix em milissegundos. */
  publishedAt: number;
}

/** Últimos patches de um jogo, buscados na fonte dele. Uma subrequisição. */
export function fetchPatches(game: Game): Promise<SourcePatch[]> {
  switch (game.source.kind) {
    case "steam":
      return fetchSteamPatches(game.source.appid, game.source.titleFilter);
    case "ddragon":
      return fetchLolPatch();
  }
}
