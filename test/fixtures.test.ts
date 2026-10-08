// Respostas reais da Steam gravadas por `npm run record-fixtures`.
import { describe, expect, it } from "vitest";
import { bbcodeToMarkdown, chunk, CHUNK_LIMIT } from "../src/format";
import { getGame } from "../src/sources/registry";
import { parseSteamNews } from "../src/sources/steam";
import cs2 from "./fixtures/steam-cs2.json";
import deadlock from "./fixtures/steam-deadlock.json";
import grandChase from "./fixtures/steam-grand-chase.json";
import marvelRivals from "./fixtures/steam-marvel-rivals.json";

const fixtures = { cs2, deadlock, "grand-chase": grandChase, "marvel-rivals": marvelRivals };

describe.each(Object.entries(fixtures))("fixture %s", (key, data) => {
  const all = parseSteamNews(data, data.appnews.appid);

  it("parses", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all.map((p) => [p.title, p.contents!] as const))("formats %s cleanly", (_, contents) => {
    const md = bbcodeToMarkdown(contents);
    expect(md).not.toMatch(/\[\/|\[\*\]|\[img|\[p[ \]]|\[list|\[h\d|\{STEAM_CLAN|\\\[|<\/?[a-z]+>/i);
    expect(md).not.toMatch(/^\s*(-|#{1,3})\s*$/m);
    for (const part of chunk(md)) expect(part.length).toBeLessThanOrEqual(CHUNK_LIMIT);
  });

});

// Títulos reais vistos na Steam (2026-10), e se o filtro de cada jogo deve mantê-los.
const titles: Record<string, [string, boolean][]> = {
  deadlock: [
    ["Old Gods, New Blood", true],
    ["City Never Sleeps", true],
    ["Mind the Birds!", true],
    ["Minor Update - 10-05-2026", true],
    ["Gameplay Update - 03-06-2026", true],
  ],
  cs2: [
    ["Counter-Strike 2 Update", true],
    ["Rush Hour", false],
    ["Season 5, Armory, and More", false],
    ["IEM Cologne 2026", false],
  ],
  "marvel-rivals": [
    ["Marvel Rivals Version 20261001 Patch Notes", true],
    ["Marvel Rivals Version 20260911 Patch Notes - Season 10 Arrives", true],
    ["Marvel Rivals Version 20260911 Balance Post", true],
    ["Season 10: Butcher's Blasphemy // Dev Vision Vol. 21 | Marvel Rivals", false],
  ],
  "grand-chase": [
    ["[Announcement] 2026. 09. 02 Ereb ‘Awakening’ Update", true],
    ["[Maintenance] (Completed) Scheduled Maintenance Announcement", true],
    ["[Announcement] July 22 PvP Balance Adjustment", true],
    ["[Announcement] Bug Fixes/Improvements", false],
    ["[Announcement] (Completed) Server Maintenance", false],
    ["[Announcement] Sanctions for Violation of Operating Policies: 2026. 09. 30", false],
    ["☕Tomo's Teatime(◡‿◡) #23 — A Sneak Peek", false],
  ],
};

describe.each(Object.entries(titles))("title filter %s", (key, cases) => {
  const source = getGame(key)!.source;
  const filter = source.kind === "steam" ? source.titleFilter : undefined;

  it.each(cases)("%s → %s", (title, kept) => {
    expect(!filter || filter.test(title)).toBe(kept);
  });
});
