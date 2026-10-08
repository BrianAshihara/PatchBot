import { describe, expect, it } from "vitest";
import { bbcodeToMarkdown, chunk, CHUNK_LIMIT } from "../src/format";

describe("bbcodeToMarkdown", () => {
  it("converts headings", () => {
    expect(bbcodeToMarkdown("[h1]Big[/h1][h2] Mid [/h2][h3]Small[/h3][h5]Tiny[/h5]")).toBe(
      "# Big\n\n## Mid\n\n### Small\n\n### Tiny",
    );
  });

  it("converts inline styles, moving inner whitespace out", () => {
    expect(bbcodeToMarkdown("[b]bold[/b] [i]it[/i] [u]under[/u] [b] spaced [/b]!")).toBe(
      "**bold** *it* __under__  **spaced** !",
    );
    expect(bbcodeToMarkdown("a[b] [/b]b")).toBe("a b");
  });

  it("converts links", () => {
    expect(bbcodeToMarkdown("[url=https://x.com/a]the site[/url]")).toBe("[the site](https://x.com/a)");
    expect(bbcodeToMarkdown('[url="https://x.com/a"]q[/url]')).toBe("[q](https://x.com/a)");
    expect(bbcodeToMarkdown("[url]https://x.com[/url]")).toBe("https://x.com");
    expect(bbcodeToMarkdown("[url=https://x.com][/url]")).toBe("https://x.com");
    expect(bbcodeToMarkdown("[list][*][url=https://x.com]q[/url][/list]")).toBe("- [q](https://x.com)");
  });

  it("keeps bracketed text that is not BBCode", () => {
    expect(bbcodeToMarkdown("[PC] Fixed [Hero] Spider-Man [b]x[/b]")).toBe("[PC] Fixed [Hero] Spider-Man **x**");
  });

  it("converts lists, including nested ones and newlines between items", () => {
    const input = "[list]\n[*]One\n[*][b]Two[/b][/*]\n[list][*]Inner[/list]\n[*]\nThree\n[/list]";
    expect(bbcodeToMarkdown(input)).toBe("- One\n- **Two**\n  - Inner\n- Three");
    expect(bbcodeToMarkdown("[olist][*]a[*]b[/olist]")).toBe("- a\n- b");
  });

  it("drops media and unknown tags, keeping text", () => {
    const input =
      "[img]{STEAM_CLAN_IMAGE}/1/a.png[/img]Intro {STEAM_CLAN_IMAGE}/2/b.jpg\n" +
      '[previewyoutube=abc;full][/previewyoutube][img src="x"][/img][video mp4="v"][/video]' +
      "[quote]said[/quote] [spoiler]secret[/spoiler] [color=red]red[/color]";
    expect(bbcodeToMarkdown(input)).toBe("Intro\nsaid secret red");
  });

  it("strips HTML and decodes entities", () => {
    expect(bbcodeToMarkdown("<p>Hello &amp; welcome</p><p>a<br>b &lt;3 &#39;x&#x27;</p>")).toBe(
      "Hello & welcome\na\nb <3 'x'",
    );
    expect(bbcodeToMarkdown("damage < 5 and > 2")).toBe("damage < 5 and > 2");
  });

  it("handles Steam paragraphs and collapses blank lines", () => {
    expect(bbcodeToMarkdown("[p]First[/p][p][/p][p]Second[/p]\r\n\r\n\r\n\r\nThird   ")).toBe(
      "First\n\nSecond\n\nThird",
    );
  });

  it("handles real Steam quirks: escaped brackets, attributes, [p] inside list items", () => {
    expect(
      bbcodeToMarkdown(
        '[p]\\[ MISC ][/p][list][*][p]Fixed A.[/p][/*][*][p]Fixed B.[/p][/*][/list][p align="justify"]Done[/p]',
      ),
    ).toBe("### MISC\n- Fixed A.\n- Fixed B.\n\nDone");
    expect(bbcodeToMarkdown("[b]\\[ General ][/b] {STEAM_CLAN_LOC_IMAGE}/1/a.png ok")).toBe("**[ General ]**  ok");
  });

  it("turns bracketed section labels into headings", () => {
    expect(bbcodeToMarkdown("[p][b]\\[ General ][/b][/p][p]- a[/p][p][b][u]\\[ Heroes ][/u][/b][/p][p]- b[/p]")).toBe(
      "### General\n- a\n\n### Heroes\n- b",
    );
    // Não é um rótulo ocupando a linha inteira: fica como texto.
    expect(bbcodeToMarkdown("[PC] Fixed a crash")).toBe("[PC] Fixed a crash");
  });

  it("drops a banner (link wrapping only an image) but keeps real links", () => {
    expect(
      bbcodeToMarkdown(
        "[url=https://www.playdeadlock.com/oldgods][img]{STEAM_CLAN_IMAGE}/1/a.png[/img][/url]\n\nSix new heroes. View the [url=https://www.playdeadlock.com/oldgods]update page[/url].",
      ),
    ).toBe("Six new heroes. View the [update page](https://www.playdeadlock.com/oldgods).");
  });

  it("makes bullets easy to scan: bold names and number arrows", () => {
    const md = bbcodeToMarkdown(
      [
        "- Rat King: Scrap Grenade - Damage increased from 65 to 70",
        "- Rat King: Scrap Grenade - T2 Damage reduced from 30 to 25",
        "- Apollo: Riposte melee resist reduction increased from -22% to -25%",
        "- Urn give up time reduced from 75s to 60s",
        "- Urn Runner sprint bonus reduced from +2m to 0 (trailing bonus reduced from +7m to +5m)",
        "- Urn spawn time changed from 10/15/20 to 12/18/24",
        "- Cooldown changed from 30 to 25",
        "- Moved from the bridge to under the bridge",
        "- Fixed bugs that were causing troopers to walk too slowly in lane",
        "- Unstable Rift comeback resist max values now scale over the course of the game: see below",
        "Plain line: from 1 to 2",
      ].join("\n"),
    );
    expect(md.split("\n")).toEqual([
      "- **Rat King**: Scrap Grenade - Damage ▲ 65 → 70",
      "- **Rat King**: Scrap Grenade - T2 Damage ▼ 30 → 25",
      "- **Apollo**: Riposte melee resist reduction ▲ -22% → -25%",
      "- Urn give up time ▼ 75s → 60s",
      "- Urn Runner sprint bonus ▼ +2m → 0 (trailing bonus ▼ +7m → +5m)",
      "- Urn spawn time changed from 10/15/20 to 12/18/24",
      "- Cooldown 30 → 25",
      "- Moved from the bridge to under the bridge",
      "- Fixed bugs that were causing troopers to walk too slowly in lane",
      "- Unstable Rift comeback resist max values now scale over the course of the game: see below",
      "Plain line: from 1 to 2",
    ]);
  });

  it("drops headings and bullets left empty", () => {
    expect(bbcodeToMarkdown("[h2][img]x[/img][/h2]Text\n[list][*][img]y[/img][*]ok[/list]")).toBe("Text\n\n- ok");
  });

  it("converts a realistic patch post", () => {
    const input = `[h2]Gameplay[/h2]
[list]
[*]Reduced [b]Haze[/b] damage from 20 to 18
[*]See [url=https://store.steampowered.com]the store[/url]
[/list]

[h2]Bug fixes[/h2]
[list][*]Fixed a crash[/list]`;
    expect(bbcodeToMarkdown(input)).toBe(
      "## Gameplay\n- Reduced **Haze** damage 20 → 18\n- See [the store](https://store.steampowered.com)\n\n## Bug fixes\n- Fixed a crash",
    );
  });
});

describe("chunk", () => {
  it("returns a single chunk for short text and none for empty text", () => {
    expect(chunk("a\nb")).toEqual(["a\nb"]);
    expect(chunk("")).toEqual([]);
    expect(chunk("\n \n")).toEqual([]);
  });

  it("splits only at line breaks", () => {
    expect(chunk("aaaa\nbbbb\ncccc", 9)).toEqual(["aaaa\nbbbb", "cccc"]);
    expect(chunk("aaaa\nbbbbb", 9)).toEqual(["aaaa", "bbbbb"]);
  });

  it("splits a single over-long line, preferring spaces", () => {
    expect(chunk("aaaa bbbb cccc", 10)).toEqual(["aaaa bbbb", "cccc"]);
    expect(chunk("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(chunk("x\nabcdefghij\ny", 4)).toEqual(["x", "abcd", "efgh", "ij\ny"]);
  });

  it("never splits a surrogate pair", () => {
    const parts = chunk("abc😀def", 4);
    expect(parts).toEqual(["abc", "😀de", "f"]);
  });

  it("keeps every chunk within the limit and loses no content", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `- line ${i} ${"x".repeat(i % 50)}`);
    const text = lines.join("\n");
    const parts = chunk(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(CHUNK_LIMIT);
    expect(parts.join("\n")).toBe(text);
  });
});
