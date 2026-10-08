import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  deleteDelivery,
  disableGuildStatements,
  getGuild,
  getGuildGames,
  getDetectState,
  markSeeded,
  getLatestPatch,
  getLatestPatches,
  getPendingDeliveries,
  insertPatch,
  queueDeliveries,
  setGuildGames,
  setupGuild,
  updateDelivery,
  type Patch,
} from "../src/db";

const db = env.DB;

function patch(game: string, patch_id: string, published_at: number): Patch {
  return { game, patch_id, title: `${game} ${patch_id}`, url: `https://x/${patch_id}`, body: "notes", published_at, image: null, major: 0 };
}

describe("db", () => {
  it("stores patches and ignores duplicates", async () => {
    await db.batch([insertPatch(db, patch("cs2", "1", 100)), insertPatch(db, patch("cs2", "2", 200))]);
    await db.batch([insertPatch(db, patch("cs2", "1", 100))]);

    await db.batch([markSeeded(db, "cs2"), markSeeded(db, "cs2")]);
    expect(await getDetectState(db, ["cs2", "deadlock"])).toEqual({
      seeded: new Set(["cs2"]),
      recent: new Map([
        ["cs2", new Set(["1", "2"])],
        ["deadlock", new Set()],
      ]),
    });
    expect((await getLatestPatch(db, "cs2"))?.patch_id).toBe("2");
  });

  it("returns the latest patch per game", async () => {
    await db.batch([
      insertPatch(db, patch("cs2", "1", 100)),
      insertPatch(db, patch("cs2", "2", 200)),
      insertPatch(db, patch("lol", "16.19", 150)),
    ]);
    const latest = await getLatestPatches(db, ["cs2", "lol", "deadlock"]);
    expect(latest.map((p) => [p.game, p.patch_id]).sort()).toEqual([
      ["cs2", "2"],
      ["lol", "16.19"],
    ]);
  });

  it("reads only the rows it needs, however many patches are stored (index patches_by_date)", async () => {
    const many = Array.from({ length: 500 }, (_, i) => insertPatch(db, patch("deadlock", String(i), i)));
    await db.batch(many);

    // Mesmas consultas do getDetectState / getLatestPatch(es), medindo as linhas lidas que o D1 cobra.
    const recent = await db
      .prepare("SELECT patch_id FROM patches WHERE game = ? ORDER BY published_at DESC LIMIT 20")
      .bind("deadlock")
      .all();
    expect(recent.results).toHaveLength(20);
    expect(recent.meta.rows_read).toBeLessThanOrEqual(21);

    const latest = await db
      .prepare("SELECT * FROM patches WHERE game = ? ORDER BY published_at DESC LIMIT 1")
      .bind("deadlock")
      .all();
    expect(latest.meta.rows_read).toBeLessThanOrEqual(2);

    const state = await getDetectState(db, ["deadlock"]);
    expect([...state.recent.get("deadlock")!].slice(0, 3)).toEqual(["499", "498", "497"]);
    expect((await getLatestPatches(db, ["deadlock"]))[0]?.patch_id).toBe("499");
  });

  it("sets up a guild and updates its games", async () => {
    await setupGuild(db, "g1", "c1", ["cs2", "lol"]);
    expect(await getGuild(db, "g1")).toEqual({ guild_id: "g1", channel_id: "c1", enabled: 1 });
    expect(await getGuildGames(db, "g1")).toEqual(["cs2", "lol"]);

    await setGuildGames(db, "g1", ["deadlock"]);
    expect(await getGuildGames(db, "g1")).toEqual(["deadlock"]);

    await setupGuild(db, "g1", "c2", ["cs2"]);
    expect((await getGuild(db, "g1"))?.channel_id).toBe("c2");
  });

  it("queues deliveries only for enabled guilds following the game", async () => {
    await setupGuild(db, "g1", "c1", ["cs2"]);
    await setupGuild(db, "g2", "c2", ["lol"]);
    await setupGuild(db, "g3", "c3", ["cs2"]);
    await db.batch(disableGuildStatements(db, "g3"));

    await db.batch([insertPatch(db, patch("cs2", "9", 900)), queueDeliveries(db, "cs2", "9")]);

    const pending = await getPendingDeliveries(db, 10);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ guild_id: "g1", channel_id: "c1", game: "cs2", patch_id: "9", next_chunk: 0 });
  });

  it("updates and deletes deliveries; disabling a guild drops them", async () => {
    await setupGuild(db, "g1", "c1", ["cs2"]);
    await db.batch([insertPatch(db, patch("cs2", "9", 900)), queueDeliveries(db, "cs2", "9")]);
    const [d] = await getPendingDeliveries(db, 10);

    await db.batch([updateDelivery(db, { ...d!, message_id: "m", thread_id: "t", next_chunk: 2, attempts: 1 })]);
    expect((await getPendingDeliveries(db, 10))[0]).toMatchObject({ message_id: "m", thread_id: "t", next_chunk: 2 });

    await db.batch([deleteDelivery(db, d!)]);
    expect(await getPendingDeliveries(db, 10)).toEqual([]);

    await db.batch([queueDeliveries(db, "cs2", "9")]);
    await db.batch(disableGuildStatements(db, "g1"));
    const { results } = await db.prepare("SELECT * FROM deliveries").all();
    expect(results).toEqual([]);
  });
});
