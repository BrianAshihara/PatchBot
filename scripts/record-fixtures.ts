// Salva respostas reais da Steam News em test/fixtures/ e mostra os títulos recentes para ajustar os filtros (§2).
// Uso: npm run record-fixtures
// Independente do resto (o Node não resolve os imports sem extensão do Worker); mantenha em dia com src/sources/games.ts.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const STEAM_GAMES: Record<string, number> = {
  deadlock: 1422450,
  cs2: 730,
  "marvel-rivals": 2767030,
  "grand-chase": 985810,
};

const outDir = path.join(import.meta.dirname, "..", "test", "fixtures");
await mkdir(outDir, { recursive: true });

for (const [key, appid] of Object.entries(STEAM_GAMES)) {
  // O mesmo pedido que a produção faz.
  const full = await fetchJson(
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=5&maxlength=0&feeds=steam_community_announcements`,
  );
  const file = path.join(outDir, `steam-${key}.json`);
  await writeFile(file, JSON.stringify(full, null, 2) + "\n");

  // Um histórico maior, sem o texto, só para ver os títulos (não é salvo).
  const history = (await fetchJson(
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=30&maxlength=1&feeds=steam_community_announcements`,
  )) as { appnews: { newsitems: { title: string; date: number }[] } };

  console.log(`\n## ${key} (${appid}) → ${path.relative(process.cwd(), file)}`);
  for (const item of history.appnews.newsitems) {
    console.log(`  ${new Date(item.date * 1000).toISOString().slice(0, 10)}  ${item.title}`);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}
