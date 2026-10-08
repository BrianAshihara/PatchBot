import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCron, SUBREQUEST_BUDGET } from "../src/cron";
import { setupGuild } from "../src/db";
import worker from "../src/index";
import { GAMES } from "../src/sources/registry";
import deadlock from "./fixtures/steam-deadlock.json";

let feed: typeof deadlock;
let discordCalls: number;

beforeEach(() => {
  feed = deadlock;
  discordCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("discord.com")) {
      discordCalls++;
      return Response.json({ id: `id${discordCalls}` });
    }
    if (url.includes("ddragon")) return Response.json(["16.19.1"]);
    // Todo jogo da Steam recebe o feed do Deadlock; basta para uma execução completa.
    return Response.json(feed);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cron", () => {
  it("seeds, then delivers a new patch within the subrequest budget", async () => {
    await setupGuild(env.DB, "g1", "chan", GAMES.map((g) => g.key));
    const first = await runCron(env);
    expect(first.detect.seeded).toHaveLength(GAMES.length);
    expect(discordCalls).toBe(0);

    const item = { ...deadlock.appnews.newsitems[0]!, gid: "999", title: "Old Gods, New Blood", date: 2_000_000_000 };
    feed = { ...deadlock, appnews: { ...deadlock.appnews, newsitems: [item, ...deadlock.appnews.newsitems] } };
    const second = await runCron(env);

    // Só o Deadlock não tem filtro de título; os outros jogos recebem o mesmo feed, mas filtram o "Old Gods".
    expect(second.detect.newPatches).toContainEqual({ game: "deadlock", patchId: "999" });
    expect(second.deliver.finished).toBeGreaterThan(0);
    const used = second.detect.subrequests + 2 + discordCalls;
    expect(used).toBeLessThanOrEqual(SUBREQUEST_BUDGET);
  });

  it("is wired to the Worker's scheduled handler", async () => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "*/2 * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
    const { results } = await env.DB.prepare("SELECT game FROM seeded_games ORDER BY game").all<{ game: string }>();
    expect(results.map((r) => r.game)).toEqual(GAMES.map((g) => g.key).sort());
  });
});
