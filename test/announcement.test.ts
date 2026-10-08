import { describe, expect, it } from "vitest";
import { announcement, CONTINUED_NOTE, MESSAGE_TEXT_LIMIT, type AnnouncedPatch } from "../src/discord";
import { bbcodeToMarkdown } from "../src/format";
import { getGame, type Game } from "../src/sources/registry";
import { parseSteamNews } from "../src/sources/steam";
import { nodes, notesOf, texts } from "./card";
import deadlockFeed from "./fixtures/steam-deadlock.json";

const deadlock = getGame("deadlock")!;
const lol = getGame("lol")!;
const at = 1_700_000_000_000;
const BANNER = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1422450/header.jpg";

function card(game: Game, p: Partial<AnnouncedPatch>) {
  return announcement(game, { title: "Minor Update", url: "https://u", published_at: at, body: null, image: null, major: 0, ...p });
}

describe("announcement card (Components V2)", () => {
  it("is one colored container: header with thumbnail, divider, notes, button", () => {
    const { message, needsThread } = card(deadlock, { body: "- a" });
    expect(needsThread).toBe(false);
    expect(message.flags).toBe(1 << 15);
    expect(message.components).toHaveLength(1);
    expect(message.components[0]).toMatchObject({ type: 17, accent_color: deadlock.color });
    expect(message.components[0]!.components.map((c) => c.type)).toEqual([9, 14, 10, 1]);

    expect(texts(message)).toEqual([
      "-# 🆕 New update · Deadlock\n## [Minor Update](https://u)\n-# Steam · <t:1700000000:f>",
      "- a",
    ]);
    expect(nodes(message).find((n) => n.type === 11)?.media?.url).toBe(BANNER);
    expect(nodes(message).find((n) => n.type === 2)).toMatchObject({ style: 5, label: "Read on Steam", url: "https://u" });
  });

  it("uses the post's own picture as thumbnail", () => {
    const { message } = card(deadlock, { image: "https://img/hero.png" });
    expect(nodes(message).find((n) => n.type === 11)?.media?.url).toBe("https://img/hero.png");
  });

  it("major update: highlighted header and the post's picture big on top", () => {
    const { message } = card(deadlock, { major: 1, image: "https://img/banner.png", body: "- a" });
    const types = message.components[0]!.components.map((c) => c.type);
    expect(types).toEqual([12, 10, 14, 10, 1]);
    expect(nodes(message).find((n) => n.type === 12)?.items).toEqual([{ media: { url: "https://img/banner.png" } }]);
    expect(texts(message)[0]).toContain("🔥 **MAJOR UPDATE** · Deadlock");
  });

  it("major update without its own picture keeps the thumbnail", () => {
    const { message } = card(deadlock, { major: 1 });
    expect(message.components[0]!.components[0]!.type).toBe(9);
  });

  it("escapes brackets in the title link", () => {
    expect(texts(card(deadlock, { title: "[Announcement] Update" }).message)[0]).toContain(
      "## [\\[Announcement\\] Update](https://u)",
    );
  });

  it("LoL: no thumbnail, default text, Riot button", () => {
    const { message, needsThread } = card(lol, { title: "Patch 16.19" });
    expect(needsThread).toBe(false);
    expect(message.components[0]!.components[0]!.type).toBe(10);
    expect(texts(message)[0]).toContain("-# Riot Games · ");
    expect(notesOf(message)).toBe("The new patch is live. Full notes on the official site.");
    expect(nodes(message).find((n) => n.type === 2)?.label).toBe("Read on leagueoflegends.com");
  });

  it("empty notes: header and button only", () => {
    const { message, needsThread } = card(deadlock, { body: "  \n " });
    expect(needsThread).toBe(false);
    expect(texts(message)).toHaveLength(1);
  });

  it("puts notes that fit in whole, up to the message text limit", () => {
    const header = texts(card(deadlock, {}).message)[0]!;
    const notes = "x".repeat(MESSAGE_TEXT_LIMIT - header.length);
    const { message, needsThread } = card(deadlock, { body: notes });
    expect(needsThread).toBe(false);
    expect(notesOf(message)).toBe(notes);
  });

  it("shows the beginning of long notes, cut at a line break, and asks for a thread", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `- line ${i} ${"y".repeat(30)}`);
    const { message, needsThread } = card(deadlock, { body: lines.join("\n") });
    expect(needsThread).toBe(true);
    expect(texts(message).join("").length).toBeLessThanOrEqual(MESSAGE_TEXT_LIMIT);
    const notes = notesOf(message)!;
    expect(notes.endsWith(`\n\n${CONTINUED_NOTE}`)).toBe(true);
    const shown = notes.slice(0, -(CONTINUED_NOTE.length + 2)).split("\n");
    expect(shown).toEqual(lines.slice(0, shown.length));
  });

  it("doesn't end the excerpt on a lonely heading", () => {
    const filler = Array.from({ length: 94 }, (_, i) => `- item ${i} ${"z".repeat(30)}`).join("\n");
    const notes = `${filler}\n\n## Heroes\n${"- buff ".repeat(100)}`;
    const header = texts(card(deadlock, {}).message)[0]!;
    expect(notes.indexOf("## Heroes")).toBeLessThan(MESSAGE_TEXT_LIMIT - header.length - CONTINUED_NOTE.length - 2);
    expect(notesOf(card(deadlock, { body: notes }).message)).not.toContain("## Heroes");
  });

  it("keeps real Steam posts within Discord's limits", () => {
    for (const p of parseSteamNews(deadlockFeed, 1422450)) {
      const { message } = card(deadlock, { title: p.title, body: bbcodeToMarkdown(p.contents!), image: p.image });
      expect(texts(message).join("").length).toBeLessThanOrEqual(MESSAGE_TEXT_LIMIT);
      expect(nodes(message).length).toBeLessThanOrEqual(40);
    }
  });
});
