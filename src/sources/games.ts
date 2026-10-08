// A lista de jogos suportados (§2). Adicionar um jogo = adicionar uma entrada aqui.
// Sem imports, para os scripts do Node (scripts/register-commands.ts) conseguirem carregar direto.

export type Source =
  | { kind: "steam"; appid: number; titleFilter?: RegExp }
  | { kind: "ddragon" };

export interface Game {
  key: string;
  name: string;
  source: Source;
  /** Cor da barra do card. */
  color: number;
  /** Regra extra de "major update", além da regra de tamanho (veja `isMajor`). */
  major?: (title: string, contents: string) => boolean;
}

export const GAMES: readonly Game[] = [
  {
    key: "deadlock",
    name: "Deadlock",
    // Sem filtro: updates grandes ("Old Gods, New Blood") e lançamentos de herói não têm "update" no título.
    source: { kind: "steam", appid: 1422450 },
    color: 0xc8a165,
    // Updates temáticos grandes começam com um banner que leva à página deles no playdeadlock.com.
    major: (title, contents) =>
      /gameplay update|rework|new heroes/i.test(title) || /^\s*\[url=https?:\/\/(www\.)?playdeadlock\.com\//i.test(contents),
  },
  {
    key: "cs2",
    name: "Counter-Strike 2",
    source: { kind: "steam", appid: 730, titleFilter: /update|release notes|patch/i },
    color: 0xde9b35,
  },
  {
    key: "marvel-rivals",
    name: "Marvel Rivals",
    source: { kind: "steam", appid: 2767030, titleFilter: /patch notes|balance post/i },
    color: 0xe62429,
    major: (title) => /season \d+(\.\d+)? arrives/i.test(title),
  },
  {
    key: "grand-chase",
    name: "Grand Chase Classic",
    // Posts "Bug Fixes/Improvements" são ignorados: saem quase todo dia e em geral só dizem "- will be updated".
    source: { kind: "steam", appid: 985810, titleFilter: /\bupdate\b|scheduled maintenance|balance adjustment/i },
    color: 0x8e5bd6,
    major: (title) => /^\[announcement\] \d{4}\. ?\d{2}\. ?\d{2}\b.*update/i.test(title),
  },
  {
    key: "lol",
    name: "League of Legends",
    source: { kind: "ddragon" },
    color: 0xc89b3c,
    // x.1 abre uma temporada nova.
    major: (title) => /^patch \d+\.1$/i.test(title),
  },
];

/** Notas brutas maiores que isto sempre contam como major update. */
export const MAJOR_SIZE = 15_000;

export function isMajor(game: Game, title: string, contents: string | null): boolean {
  return (contents?.length ?? 0) >= MAJOR_SIZE || (game.major?.(title, contents ?? "") ?? false);
}

export function getGame(key: string): Game | undefined {
  return GAMES.find((g) => g.key === key);
}

/** Imagem pequena do anúncio quando o post não tem nenhuma: o banner do jogo na Steam. */
export function gameImage(game: Game): string | null {
  return game.source.kind === "steam"
    ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.source.appid}/header.jpg`
    : null;
}

export function sourceInfo(game: Game): { site: string; button: string } {
  return game.source.kind === "steam"
    ? { site: "Steam", button: "Read on Steam" }
    : { site: "Riot Games", button: "Read on leagueoflegends.com" };
}
