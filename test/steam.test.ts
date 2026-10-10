import { afterEach, describe, expect, it, vi } from "vitest";
import { GAMES, getGame } from "../src/sources/registry";
import { GAMES as ALL, getGame as find, isMajor } from "../src/sources/games";
import { fetchSteamPatches, firstImage, parseSteamNews, steamNewsUrl } from "../src/sources/steam";

describe("firstImage", () => {
  it("resolves Steam image placeholders in both [img] forms", () => {
    expect(firstImage("hi [img]{STEAM_CLAN_IMAGE}/1/a.png[/img] [img]{STEAM_CLAN_IMAGE}/1/b.png[/img]")).toBe(
      "https://clan.akamai.steamstatic.com/images/1/a.png",
    );
    expect(firstImage('[p][img src="{STEAM_CLAN_LOC_IMAGE}/45164767/x.png"][/img]')).toBe(
      "https://clan.akamai.steamstatic.com/images/45164767/x.png",
    );
    expect(firstImage("[img]https://cdn.example/c.jpg[/img]")).toBe("https://cdn.example/c.jpg");
  });

  it("returns null without a usable picture", () => {
    expect(firstImage("- Fixed a bug")).toBeNull();
    expect(firstImage("[img][/img]")).toBeNull();
    expect(firstImage("[img]http://insecure/x.png[/img]")).toBeNull();
  });
});

describe("isMajor", () => {
  const cases: [string, string, string, boolean][] = [
    ["deadlock", "Old Gods, New Blood", "[url=https://www.playdeadlock.com/oldgods][img]x[/img][/url] The ritual", true],
    ["deadlock", "City Never Sleeps", "[url=https://www.playdeadlock.com/cityneversleeps][img]x[/img][/url]", true],
    ["deadlock", "Gameplay Update - 05-22-2026", "- a", true],
    ["deadlock", "Shop Rework Update", "- a", true],
    ["deadlock", "Six New Heroes", "[img]x[/img] Six", true],
    ["deadlock", "11-21-2025 Update", "x".repeat(18_049), true],
    ["deadlock", "Minor Update - 06-30-2026", "x".repeat(13_164), false],
    ["deadlock", "Mind the Birds!", "[img]x[/img] It was a close contest", false],
    ["deadlock", "Rem Enters The City That Never Sleeps", "The people have spoken, and [url=https://www.playdeadlock.com/oldgods]x[/url]", false],
    ["marvel-rivals", "Marvel Rivals Version 20260911 Patch Notes - Season 10 Arrives", "x", true],
    ["marvel-rivals", "Marvel Rivals Version 20261001 Patch Notes", "x", false],
    ["grand-chase", "[Announcement] 2026. 09. 02 Ereb ‘Awakening’ Update", "x", true],
    ["grand-chase", "[Announcement] Follow-up Actions for the September 2 Update", "x", false],
    ["cs2", "Counter-Strike 2 Update", "x", false],
    ["lol", "Patch 17.1", "", true],
    ["lol", "Patch 16.19", "", false],
    ["lol", "Patch 16.10", "", false],
  ];
  it.each(cases)("%s: %s → %s", (key, title, contents, expected) => {
    expect(isMajor(find(key)!, title, contents)).toBe(expected);
  });

  it("every game has a color", () => {
    for (const g of ALL) expect(g.color).toBeGreaterThan(0);
  });
});

const response = {
  appnews: {
    appid: 730,
    newsitems: [
      { gid: "111", title: "Counter-Strike 2 Update", url: "https://u/111", contents: "[b]Fixed[/b]", date: 1_700_000_000 },
      { gid: "222", title: "Major tournament this weekend", url: "https://u/222", contents: "hype", date: 1_699_000_000 },
    ],
    count: 2,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registry", () => {
  it("has unique keys and finds games", () => {
    expect(new Set(GAMES.map((g) => g.key)).size).toBe(GAMES.length);
    expect(getGame("cs2")?.name).toBe("Counter-Strike 2");
    expect(getGame("nope")).toBeUndefined();
  });
});

describe("steam", () => {
  it("maps items and uses gid as patch id", () => {
    const store = "https://store.steampowered.com/news/app/730/view";
    expect(parseSteamNews(response, 730)).toEqual([
      { patchId: "111", title: "Counter-Strike 2 Update", url: `${store}/111`, contents: "[b]Fixed[/b]", image: null, publishedAt: 1_700_000_000_000 },
      { patchId: "222", title: "Major tournament this weekend", url: `${store}/222`, contents: "hype", image: null, publishedAt: 1_699_000_000_000 },
    ]);
  });

  it("applies the title filter", () => {
    expect(parseSteamNews(response, 730, /update|release notes|patch/i).map((p) => p.patchId)).toEqual(["111"]);
  });

  it("rejects unexpected shapes", () => {
    expect(() => parseSteamNews({}, 730)).toThrow();
  });

  it("fetches the official announcements feed with full text", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(response));
    const patches = await fetchSteamPatches(730);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/[?&]appid=730&count=5&maxlength=0&feeds=steam_community_announcements&_=\d+$/);
    expect(init).toEqual({ cache: "no-store" });
    // Um endereço diferente a cada pedido, para furar o cache da Steam.
    expect(steamNewsUrl(730, 1)).not.toBe(steamNewsUrl(730, 2));
    expect(patches).toHaveLength(2);
  });

  it("throws on HTTP errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
    await expect(fetchSteamPatches(730)).rejects.toThrow("HTTP 503");
  });
});
