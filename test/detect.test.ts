import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detect } from "../src/cron";
import { getPendingDeliveries, setupGuild, type Patch } from "../src/db";
import { GAMES } from "../src/sources/registry";
import cs2 from "./fixtures/steam-cs2.json";
import deadlock from "./fixtures/steam-deadlock.json";
import grandChase from "./fixtures/steam-grand-chase.json";
import marvelRivals from "./fixtures/steam-marvel-rivals.json";

const db = env.DB;
type Fixture = typeof deadlock;

let steam: Record<number, Fixture>;
let lolVersions: string[];
let failing: Set<string>;
/** Páginas de notas do LoL que "existem" no site simulado. */
let lolPages: Set<string>;
let lolChecks: string[];

beforeEach(() => {
  steam = { 1422450: deadlock, 730: cs2, 2767030: marvelRivals, 985810: grandChase } as Record<number, Fixture>;
  lolVersions = ["16.19.1"];
  failing = new Set();
  lolPages = new Set();
  lolChecks = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if ([...failing].some((part) => url.includes(part))) return new Response("down", { status: 500 });
    if (url.includes("ddragon")) return Response.json(lolVersions);
    if (url.includes("leagueoflegends.com")) {
      lolChecks.push(url);
      return new Response(null, { status: [...lolPages].some((p) => url.includes(p)) ? 200 : 404 });
    }
    const appid = Number(new URL(url).searchParams.get("appid"));
    return Response.json(steam[appid]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Coloca um post novo no topo do feed da Steam de um jogo. */
function publish(appid: number, gid: string, title: string, contents: string) {
  const base = steam[appid]!;
  const item = { ...base.appnews.newsitems[0]!, gid, title, contents, date: 2_000_000_000 };
  steam[appid] = { ...base, appnews: { ...base.appnews, newsitems: [item, ...base.appnews.newsitems.slice(0, 4)] } };
}

async function allPatches(): Promise<Patch[]> {
  return (await db.prepare("SELECT * FROM patches ORDER BY game, published_at").all<Patch>()).results;
}

describe("detect", () => {
  it("seeds silently on the first run, converting only the newest body per game", async () => {
    await setupGuild(db, "g1", "c1", GAMES.map((g) => g.key));
    const result = await detect(db, GAMES);

    expect(result.seeded.sort()).toEqual(GAMES.map((g) => g.key).sort());
    expect(result.newPatches).toEqual([]);
    expect(result.subrequests).toBe(GAMES.length + 2);
    expect(await getPendingDeliveries(db, 100)).toEqual([]);

    const patches = await allPatches();
    const deadlockRows = patches.filter((p) => p.game === "deadlock");
    expect(deadlockRows).toHaveLength(5);
    expect(deadlockRows.filter((p) => p.body !== null)).toHaveLength(1);
    expect(deadlockRows.at(-1)!.body).not.toBeNull();
    // Filtros de título aplicados: os posts do CS2 que não são update não são salvos.
    expect(patches.filter((p) => p.game === "cs2").every((p) => /update/i.test(p.title))).toBe(true);
    expect(patches.find((p) => p.game === "lol")).toMatchObject({ patch_id: "16.19", body: null, major: 0 });
    // Posts reais do Deadlock: o lançamento de herói mantém a própria imagem.
    expect(deadlockRows.find((p) => p.title === "Mind the Birds!")?.image).toBe(
      "https://clan.akamai.steamstatic.com/images/45164767/720ba4e0f1b1ed105708f7b15cdfc7ad95bfdb30.png",
    );
    expect(deadlockRows.find((p) => p.title === "City Never Sleeps")?.major).toBe(1);
  });

  it("does nothing when nothing changed", async () => {
    await detect(db, GAMES);
    const before = await allPatches();
    const result = await detect(db, GAMES);
    expect(result).toEqual({ subrequests: GAMES.length + 1, seeded: [], failed: [], newPatches: [] });
    expect(await allPatches()).toEqual(before);
  });

  it("stores a new patch with its converted body and queues it for following guilds", async () => {
    await detect(db, GAMES);
    await setupGuild(db, "fan", "c1", ["deadlock"]);
    await setupGuild(db, "other", "c2", ["cs2"]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    publish(1422450, "999", "Old Gods, New Blood", "[url=https://www.playdeadlock.com/oldgods]Six new heroes[/url]");
    const result = await detect(db, GAMES);

    expect(result.newPatches).toEqual([{ game: "deadlock", patchId: "999" }]);
    expect(result.subrequests).toBe(GAMES.length + 2);
    // O atraso entre a publicação e a detecção vai para o log.
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/"event":"new_patch","game":"deadlock".*"lagSeconds":-?\d+/));
    const pending = await getPendingDeliveries(db, 100);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      guild_id: "fan",
      channel_id: "c1",
      patch_id: "999",
      title: "Old Gods, New Blood",
      url: "https://store.steampowered.com/news/app/1422450/view/999",
      body: "[Six new heroes](https://www.playdeadlock.com/oldgods)",
      major: 1,
      image: null,
    });
  });

  it("ignores new posts rejected by the title filter", async () => {
    await detect(db, GAMES);
    await setupGuild(db, "g1", "c1", ["cs2"]);
    publish(730, "998", "IEM Cologne 2026", "esports");
    expect((await detect(db, GAMES)).newPatches).toEqual([]);
  });

  it("announces a new LoL patch but not build-only bumps", async () => {
    await detect(db, GAMES);
    await setupGuild(db, "g1", "c1", ["lol"]);

    lolVersions = ["16.19.2"];
    expect((await detect(db, GAMES)).newPatches).toEqual([]);

    lolVersions = ["16.20.1"];
    expect((await detect(db, GAMES)).newPatches).toEqual([{ game: "lol", patchId: "16.20" }]);
    expect((await getPendingDeliveries(db, 100))[0]).toMatchObject({ patch_id: "16.20", title: "Patch 26.20", body: null });
  });

  describe("LoL notes link", () => {
    const NEWS = "https://www.leagueoflegends.com/pt-br/news/game-updates";

    async function newLolPatch() {
      await detect(db, GAMES);
      lolChecks = [];
      lolVersions = ["16.20.1"];
      const result = await detect(db, GAMES);
      const row = await db.prepare("SELECT url FROM patches WHERE game = 'lol' AND patch_id = '16.20'").first<{ url: string }>();
      return { result, url: row!.url };
    }

    it("links straight to the notes in the current format, with one extra subrequest", async () => {
      lolPages.add("league-of-legends-patch-26-20-notes");
      const { result, url } = await newLolPatch();
      expect(url).toBe(`${NEWS}/league-of-legends-patch-26-20-notes/`);
      expect(lolChecks).toHaveLength(1);
      expect(result.subrequests).toBe(GAMES.length + 2 + 1);
    });

    it("tries the older format when the current one doesn't exist", async () => {
      lolPages.add("/patch-26-20-notes");
      const { url } = await newLolPatch();
      expect(url).toBe(`${NEWS}/patch-26-20-notes/`);
      expect(lolChecks).toHaveLength(2);
    });

    it("falls back to the official patch notes list when no page exists", async () => {
      const { url } = await newLolPatch();
      expect(url).toBe("https://www.leagueoflegends.com/pt-br/news/tags/patch-notes/");
    });

    it("never checks links while seeding or when nothing changed", async () => {
      await detect(db, GAMES);
      await detect(db, GAMES);
      expect(lolChecks).toEqual([]);
    });
  });

  it("announces the first patch of a game whose recent posts were all filtered out at seeding", async () => {
    await detect(db, GAMES);
    expect((await allPatches()).filter((p) => p.game === "grand-chase")).toEqual([]);
    await setupGuild(db, "g1", "c1", ["grand-chase"]);

    publish(985810, "997", "[Announcement] 2026. 10. 14 Awakening Update", "[b]New[/b] content");
    expect((await detect(db, GAMES)).newPatches).toEqual([{ game: "grand-chase", patchId: "997" }]);
    expect(await getPendingDeliveries(db, 100)).toHaveLength(1);
  });

  it("keeps going when a source fails, and seeds it once it is back", async () => {
    failing.add("appid=730");
    const first = await detect(db, GAMES);
    expect(first.failed).toEqual(["cs2"]);
    expect(first.seeded).not.toContain("cs2");
    expect(first.seeded).toContain("deadlock");

    failing.clear();
    const second = await detect(db, GAMES);
    expect(second.seeded).toEqual(["cs2"]);
    expect(second.newPatches).toEqual([]);
  });
});
