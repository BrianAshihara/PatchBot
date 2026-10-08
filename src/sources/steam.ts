import type { SourcePatch } from "./registry";

interface SteamNewsItem {
  gid: string;
  title: string;
  contents: string;
  date: number; // unix em segundos
}

interface SteamNewsResponse {
  appnews?: { newsitems?: SteamNewsItem[] };
}

export function steamNewsUrl(appid: number): string {
  return `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=5&maxlength=0&feeds=steam_community_announcements`;
}

/** Busca os anúncios oficiais mais recentes de um app da Steam, mantendo só os posts de patch. Uma subrequisição. */
export async function fetchSteamPatches(appid: number, titleFilter?: RegExp): Promise<SourcePatch[]> {
  const res = await fetch(steamNewsUrl(appid));
  if (!res.ok) throw new Error(`Steam news ${appid}: HTTP ${res.status}`);
  const data = await res.json<SteamNewsResponse>();
  return parseSteamNews(data, appid, titleFilter);
}

/** Página oficial do post na loja (o `url` da API é um link akamaihd que redireciona). */
export function steamPostUrl(appid: number, gid: string): string {
  return `https://store.steampowered.com/news/app/${appid}/view/${gid}`;
}

export function parseSteamNews(data: SteamNewsResponse, appid: number, titleFilter?: RegExp): SourcePatch[] {
  const items = data.appnews?.newsitems;
  if (!Array.isArray(items)) throw new Error("Steam news: unexpected response shape");
  return items
    .filter((item) => !titleFilter || titleFilter.test(item.title))
    .map((item) => ({
      patchId: item.gid,
      title: item.title,
      url: steamPostUrl(appid, item.gid),
      contents: item.contents,
      image: firstImage(item.contents),
      publishedAt: item.date * 1000,
    }));
}

const CLAN_IMAGES = "https://clan.akamai.steamstatic.com/images";

/** Primeiro `[img]…[/img]` ou `[img src="…"]` de um post, com os marcadores `{STEAM_CLAN_IMAGE}` da Steam resolvidos. */
export function firstImage(contents: string): string | null {
  const m = /\[img(?:\s+src=["']([^"']+)["'][^\]]*)?\]([^[]*)/i.exec(contents);
  const raw = (m?.[1] ?? m?.[2] ?? "").trim();
  const url = raw.replace(/^\{STEAM_CLAN(?:_LOC)?_IMAGE\}/, CLAN_IMAGES);
  return /^https:\/\/\S+$/.test(url) ? url : null;
}
