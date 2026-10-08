import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Budget, deliver } from "../src/cron";
import { getGuild, getPendingDeliveries, insertPatch, queueDeliveries, setupGuild, type Patch } from "../src/db";
import { chunk } from "../src/format";
import { nodes, notesOf, texts } from "./card";

const db = env.DB;

interface Call {
  method: string;
  path: string;
  body: any;
}

let calls: Call[];
/** Devolve o status de erro para a chamada, ou undefined para ela dar certo. */
let failWith: (call: Call, index: number) => number | undefined;

beforeEach(() => {
  calls = [];
  failWith = () => undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const call = { method: init!.method!, path: new URL(String(input)).pathname, body: JSON.parse(String(init!.body)) };
    calls.push(call);
    const status = failWith(call, calls.length - 1);
    if (status) return new Response(JSON.stringify({ message: "nope" }), { status });
    return Response.json({ id: call.path.endsWith("/threads") ? `thread${calls.length}` : `msg${calls.length}` });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const longBody = Array.from({ length: 120 }, (_, i) => `- change number ${i} ${"x".repeat(40)}`).join("\n");

async function addPatch(p: Partial<Patch> & Pick<Patch, "game" | "patch_id">) {
  const patch: Patch = { title: "Big Update", url: "https://x/p", body: "- fixed", published_at: 1_700_000_000_000, image: null, major: 0, ...p };
  await db.batch([insertPatch(db, patch), queueDeliveries(db, patch.game, patch.patch_id)]);
}

describe("deliver", () => {
  it("posts the announcement, opens a thread and posts every chunk, then removes the delivery", async () => {
    await setupGuild(db, "g1", "chan", ["deadlock"]);
    await addPatch({ game: "deadlock", patch_id: "1", title: "Old Gods, New Blood", body: longBody });
    const chunks = chunk(longBody);
    expect(chunks.length).toBeGreaterThan(2);

    const result = await deliver(db, "tok", new Budget(40));

    expect(result).toEqual({ finished: 1, stoppedBy: null });
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v10/channels/chan/messages",
      "/api/v10/channels/chan/messages/msg1/threads",
      ...chunks.map(() => "/api/v10/channels/thread2/messages"),
    ]);
    const card = calls[0]!.body;
    expect(texts(card)[0]).toBe(
      "-# 🆕 New update · Deadlock\n## [Old Gods, New Blood](https://x/p)\n-# Steam · <t:1700000000:f>",
    );
    expect(nodes(card).find((n) => n.type === 2)).toMatchObject({ style: 5, url: "https://x/p" });
    // Longo demais para o card: ele mostra o começo e a thread recebe tudo.
    expect(notesOf(card)).toMatch(/^- change number 0 /);
    expect(notesOf(card)).toMatch(/Continued in the thread below\.$/);
    expect(texts(card).join("").length).toBeLessThanOrEqual(4000);
    expect(calls[0]!.body.allowed_mentions).toEqual({ parse: [] });
    expect(calls[1]!.body).toEqual({ name: "Deadlock — Old Gods, New Blood" });
    expect(calls.slice(2).map((c) => c.body.content)).toEqual(chunks);
    for (const c of calls) expect(c.body.allowed_mentions ?? { parse: [] }).toEqual({ parse: [] });
    expect(calls[2]!.body.flags).toBe(4);
    expect(await getPendingDeliveries(db, 10)).toEqual([]);
  });

  it("puts notes that fit inside the announcement, without a thread", async () => {
    await setupGuild(db, "g1", "chan", ["cs2"]);
    await addPatch({ game: "cs2", patch_id: "1", title: "Counter-Strike 2 Update", body: "[ MISC ]\n\n- Fixed A\n- Fixed B" });

    expect(await deliver(db, "tok", new Budget(40))).toEqual({ finished: 1, stoppedBy: null });
    expect(calls).toHaveLength(1);
    expect(notesOf(calls[0]!.body)).toBe("[ MISC ]\n\n- Fixed A\n- Fixed B");
  });

  it("posts only the announcement for LoL and for empty notes", async () => {
    await setupGuild(db, "g1", "chan", ["lol", "deadlock"]);
    await addPatch({ game: "lol", patch_id: "16.19", title: "Patch 16.19", body: null });
    await addPatch({ game: "deadlock", patch_id: "2", body: "", published_at: 1_700_000_000_001 });

    expect(await deliver(db, "tok", new Budget(40))).toEqual({ finished: 2, stoppedBy: null });
    expect(calls).toHaveLength(2);
    expect(texts(calls[0]!.body)[0]).toContain("🆕 New update · League of Legends");
    expect(calls.every((c) => !c.path.endsWith("/threads"))).toBe(true);
  });

  it("truncates long thread names to 100 characters", async () => {
    await setupGuild(db, "g1", "chan", ["marvel-rivals"]);
    await addPatch({ game: "marvel-rivals", patch_id: "1", title: "A".repeat(150), body: longBody });
    await deliver(db, "tok", new Budget(40));
    expect(Array.from(calls[1]!.body.name as string)).toHaveLength(100);
  });

  it("stops when the budget runs out and resumes in the next run without reposting", async () => {
    await setupGuild(db, "g1", "chan", ["deadlock"]);
    await addPatch({ game: "deadlock", patch_id: "1", body: longBody });

    // 2 reservadas (leitura + escrita) + 3 chamadas ao Discord: anúncio, thread, primeiro pedaço.
    expect(await deliver(db, "tok", new Budget(5))).toEqual({ finished: 0, stoppedBy: "budget" });
    expect(await getPendingDeliveries(db, 10)).toMatchObject([
      { message_id: "msg1", thread_id: "thread2", next_chunk: 1 },
    ]);

    calls = [];
    expect(await deliver(db, "tok", new Budget(40))).toEqual({ finished: 1, stoppedBy: null });
    expect(calls.map((c) => c.path)).toEqual(chunk(longBody).slice(1).map(() => "/api/v10/channels/thread2/messages"));
  });

  it("does nothing without room for at least one Discord call", async () => {
    await setupGuild(db, "g1", "chan", ["deadlock"]);
    await addPatch({ game: "deadlock", patch_id: "1" });
    expect(await deliver(db, "tok", new Budget(2))).toEqual({ finished: 0, stoppedBy: "budget" });
    expect(calls).toEqual([]);
  });

  it("serves guilds in turn when the budget is short", async () => {
    await setupGuild(db, "g1", "c1", ["cs2"]);
    await setupGuild(db, "g2", "c2", ["cs2"]);
    await addPatch({ game: "cs2", patch_id: "1", body: longBody });
    const perGuild = 2 + chunk(longBody).length;

    // g1 recebe tudo; g2 recebe o anúncio e continua na próxima execução.
    expect(await deliver(db, "tok", new Budget(2 + perGuild + 1))).toEqual({ finished: 1, stoppedBy: "budget" });
    expect(await getPendingDeliveries(db, 10)).toMatchObject([{ guild_id: "g2", thread_id: null }]);
    expect((await getPendingDeliveries(db, 10))[0]!.message_id).not.toBeNull();
  });

  it("stops on 429 and keeps progress", async () => {
    await setupGuild(db, "g1", "chan", ["deadlock"]);
    await addPatch({ game: "deadlock", patch_id: "1", body: longBody });
    failWith = (_, i) => (i === 2 ? 429 : undefined);

    expect(await deliver(db, "tok", new Budget(40))).toEqual({ finished: 0, stoppedBy: "rate-limit" });
    expect(await getPendingDeliveries(db, 10)).toMatchObject([
      { message_id: "msg1", thread_id: "thread2", next_chunk: 0, attempts: 0 },
    ]);
  });

  it("disables the guild and drops its deliveries on 403/404 in the channel", async () => {
    await setupGuild(db, "g1", "chan", ["deadlock", "cs2"]);
    await setupGuild(db, "g2", "other", ["deadlock"]);
    await addPatch({ game: "deadlock", patch_id: "1" });
    await addPatch({ game: "cs2", patch_id: "2", published_at: 1_700_000_000_001 });
    failWith = (call) => (call.path.includes("/chan/") ? 403 : undefined);

    expect(await deliver(db, "tok", new Budget(40))).toEqual({ finished: 1, stoppedBy: null });
    expect((await getGuild(db, "g1"))?.enabled).toBe(0);
    expect((await getGuild(db, "g2"))?.enabled).toBe(1);
    expect(await getPendingDeliveries(db, 10)).toEqual([]);
    // A segunda entrega do g1 foi pulada, não tentada.
    expect(calls.filter((c) => c.path.includes("/chan/"))).toHaveLength(1);
  });

  it("drops only the delivery when the thread is gone", async () => {
    await setupGuild(db, "g1", "chan", ["deadlock"]);
    await addPatch({ game: "deadlock", patch_id: "1", body: longBody });
    failWith = (call) => (call.path.includes("/thread2/") ? 404 : undefined);

    await deliver(db, "tok", new Budget(40));
    expect((await getGuild(db, "g1"))?.enabled).toBe(1);
    expect(await getPendingDeliveries(db, 10)).toEqual([]);
  });

  it("retries server errors and gives up after 5 attempts", async () => {
    await setupGuild(db, "g1", "chan", ["deadlock"]);
    await addPatch({ game: "deadlock", patch_id: "1" });
    failWith = () => 502;

    for (let attempt = 1; attempt <= 4; attempt++) {
      await deliver(db, "tok", new Budget(40));
      expect(await getPendingDeliveries(db, 10)).toMatchObject([{ attempts: attempt }]);
    }
    await deliver(db, "tok", new Budget(40));
    expect(await getPendingDeliveries(db, 10)).toEqual([]);
  });

  it("treats network errors like server errors", async () => {
    await setupGuild(db, "g1", "chan", ["deadlock"]);
    await addPatch({ game: "deadlock", patch_id: "1" });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("network down"));

    await deliver(db, "tok", new Budget(40));
    expect(await getPendingDeliveries(db, 10)).toMatchObject([{ message_id: null, attempts: 1 }]);
  });
});
