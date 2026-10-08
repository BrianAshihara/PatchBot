import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disableGuildStatements, getGuild, getGuildGames, insertPatch, setupGuild } from "../src/db";
import { GAMES } from "../src/sources/registry";
import { notesOf, texts } from "./card";
import { makeSigner } from "./helpers";

const db = env.DB;
const ADMIN = { permissions: "32" };
const MEMBER = { permissions: "0" };

interface Call {
  method: string;
  path: string;
  body: any;
}
let calls: Call[];
let failWith: (call: Call) => number | undefined;
let send: Awaited<ReturnType<typeof makeSigner>>["send"];

beforeEach(async () => {
  calls = [];
  failWith = () => undefined;
  send = (await makeSigner()).send;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const call = { method: init!.method!, path: new URL(String(input)).pathname, body: JSON.parse(String(init!.body)) };
    calls.push(call);
    const status = failWith(call);
    if (status) return new Response("{}", { status });
    return Response.json({ id: `id${calls.length}` });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function command(name: string, options: { name: string; value: string }[] = [], member: object | undefined = ADMIN) {
  return { type: 2, guild_id: "g1", token: "itok", member, data: { name, type: 1, options } };
}

async function reply(interaction: object): Promise<any> {
  const res = await send(interaction);
  expect(res.status).toBe(200);
  return res.json();
}

/** Conteúdo da resposta adiada, como ficou editada depois que o trabalho terminou. */
function editedReply(): string {
  const edit = calls.find((c) => c.method === "PATCH");
  expect(edit?.path).toBe("/api/v10/webhooks/123/itok/messages/@original");
  return edit!.body.content;
}

describe("commands", () => {
  it("/help works for everyone, ephemeral", async () => {
    const r = await reply(command("help", [], MEMBER));
    expect(r.type).toBe(4);
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toContain("Deadlock");
  });

  it("refuses admin commands without Manage Server, accepts Administrator", async () => {
    for (const name of ["setup", "games", "status", "test"]) {
      expect((await reply(command(name, [], MEMBER))).data.content).toContain("Manage Server");
    }
    expect((await reply(command("status", [], { permissions: String(1 << 3) }))).data.content).toContain("/setup");
  });

  it("refuses use outside a server", async () => {
    const r = await reply({ ...command("help"), guild_id: undefined });
    expect(r.data.content).toContain("inside a server");
  });

  describe("/setup", () => {
    it("posts a confirmation, then saves the channel following all games", async () => {
      const r = await reply(command("setup", [{ name: "channel", value: "chan" }]));
      expect(r).toEqual({ type: 5, data: { flags: 64 } });

      expect(calls[0]).toMatchObject({ method: "POST", path: "/api/v10/channels/chan/messages" });
      expect(calls[0]!.body.allowed_mentions).toEqual({ parse: [] });
      expect(editedReply()).toContain("<#chan>");
      expect(await getGuild(db, "g1")).toEqual({ guild_id: "g1", channel_id: "chan", enabled: 1 });
      expect((await getGuildGames(db, "g1")).sort()).toEqual(GAMES.map((g) => g.key).sort());
    });

    it("re-enables a paused server", async () => {
      await setupGuild(db, "g1", "old", ["cs2"]);
      await db.batch(disableGuildStatements(db, "g1"));
      await reply(command("setup", [{ name: "channel", value: "chan" }]));
      expect(await getGuild(db, "g1")).toMatchObject({ channel_id: "chan", enabled: 1 });
    });

    it("saves nothing and explains when the bot can't post there", async () => {
      failWith = (c) => (c.path.includes("/channels/chan/") ? 403 : undefined);
      await reply(command("setup", [{ name: "channel", value: "chan" }]));
      expect(editedReply()).toContain("can't post");
      expect(await getGuild(db, "g1")).toBeNull();
    });
  });

  describe("/games", () => {
    it("asks for /setup first", async () => {
      expect((await reply(command("games"))).data.content).toContain("/setup");
    });

    it("shows a multi-select pre-filled with the followed games", async () => {
      await setupGuild(db, "g1", "chan", ["cs2", "lol"]);
      const r = await reply(command("games"));
      expect(r.data.flags).toBe(64);
      const select = r.data.components[0].components[0];
      expect(select).toMatchObject({ type: 3, custom_id: "games", min_values: 0, max_values: GAMES.length });
      expect(select.options.filter((o: any) => o.default).map((o: any) => o.value)).toEqual(["cs2", "lol"]);
    });

    it("saves the selection, ignoring unknown values", async () => {
      await setupGuild(db, "g1", "chan", ["cs2"]);
      const r = await reply({
        type: 3,
        guild_id: "g1",
        token: "itok",
        member: ADMIN,
        data: { component_type: 3, custom_id: "games", values: ["deadlock", "bogus"] },
      });
      expect(r).toEqual({ type: 7, data: { content: "✅ Following: Deadlock.", components: [] } });
      expect(await getGuildGames(db, "g1")).toEqual(["deadlock"]);
    });

    it("refuses the selection from a non-admin", async () => {
      await setupGuild(db, "g1", "chan", ["cs2"]);
      const r = await reply({
        type: 3,
        guild_id: "g1",
        member: MEMBER,
        data: { component_type: 3, custom_id: "games", values: [] },
      });
      expect(r.data.content).toContain("Manage Server");
      expect(await getGuildGames(db, "g1")).toEqual(["cs2"]);
    });
  });

  describe("/status", () => {
    it("shows channel, state, followed games and latest patches", async () => {
      await setupGuild(db, "g1", "chan", ["deadlock"]);
      await db.batch([
        insertPatch(db, {
          game: "deadlock",
          patch_id: "1",
          title: "Old Gods, New Blood",
          url: "https://x/1",
          body: null,
          published_at: 1_700_000_000_000,
          image: null,
          major: 0,
        }),
      ]);
      const content: string = (await reply(command("status"))).data.content;
      expect(content).toContain("<#chan>");
      expect(content).toContain("active");
      expect(content).toContain("**Following:** Deadlock");
      expect(content).toContain("Deadlock: [Old Gods, New Blood](<https://x/1>) (<t:1700000000:R>)");
      expect(content).toContain("Counter-Strike 2: none yet");
    });

    it("warns when the server is paused", async () => {
      await setupGuild(db, "g1", "chan", ["deadlock"]);
      await db.batch(disableGuildStatements(db, "g1"));
      expect((await reply(command("status"))).data.content).toContain("paused");
    });
  });

  describe("/test", () => {
    const game = [{ name: "game", value: "deadlock" }];

    it("explains when there is no stored patch", async () => {
      await setupGuild(db, "g1", "chan", ["deadlock"]);
      expect(await reply(command("test", game))).toEqual({ type: 5, data: { flags: 64 } });
      expect(editedReply()).toContain("No Deadlock patch stored yet");
    });

    it("posts the latest patch", async () => {
      await setupGuild(db, "g1", "chan", []);
      await db.batch([
        insertPatch(db, { game: "deadlock", patch_id: "1", title: "Old", url: "u", body: "- a", published_at: 1, image: null, major: 0 }),
        insertPatch(db, { game: "deadlock", patch_id: "2", title: "New", url: "u", body: "- b", published_at: 2, image: null, major: 0 }),
      ]);
      await reply(command("test", game));
      const posts = calls.filter((c) => c.method === "POST");
      // Notas curtas cabem no anúncio: sem thread.
      expect(posts.map((c) => c.path)).toEqual(["/api/v10/channels/chan/messages"]);
      expect(texts(posts[0]!.body)[0]).toContain("## [New](u)");
      expect(notesOf(posts[0]!.body)).toBe("- b");
      expect(editedReply()).toContain("✅ Posted");
    });

    it("explains missing permissions", async () => {
      await setupGuild(db, "g1", "chan", []);
      await db.batch([
        insertPatch(db, { game: "deadlock", patch_id: "1", title: "t", url: "u", body: "- a", published_at: 1, image: null, major: 0 }),
      ]);
      failWith = (c) => (c.path.includes("/channels/chan/") ? 403 : undefined);
      await reply(command("test", game));
      expect(editedReply()).toContain("can't post");
      // Uma falha no /test nunca pausa o servidor.
      expect((await getGuild(db, "g1"))?.enabled).toBe(1);
    });
  });
});
