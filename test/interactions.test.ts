import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { makeSigner } from "./helpers";

describe("POST /interactions", () => {
  it("answers PING with PONG when the signature is valid", async () => {
    const { send } = await makeSigner();
    const res = await send({ type: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it("rejects a bad signature with 401", async () => {
    const { send, sign } = await makeSigner();
    const other = await makeSigner();
    expect((await send({ type: 1 }, await other.sign(JSON.stringify({ type: 1 })))).status).toBe(401);
    // O corpo assinado é diferente do enviado.
    expect((await send({ type: 1 }, await sign(JSON.stringify({ type: 2 })))).status).toBe(401);
  });

  it("rejects missing or malformed signature headers with 401", async () => {
    const { send } = await makeSigner();
    expect((await send({ type: 1 }, {})).status).toBe(401);
    expect((await send({ type: 1 }, { "X-Signature-Ed25519": "zz", "X-Signature-Timestamp": "1" })).status).toBe(401);
  });

  it("routes commands and components", async () => {
    const { send } = await makeSigner();
    for (const type of [2, 3]) {
      const res = await send({ type, data: { name: "help", custom_id: "x" }, guild_id: "g1" });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { type: number }).type).toBe(4);
    }
  });

  it("returns 404 for other paths and 405 for other methods", async () => {
    const ctx = createExecutionContext();
    expect((await worker.fetch(new Request("https://bot.example/"), env, ctx)).status).toBe(404);
    expect((await worker.fetch(new Request("https://bot.example/interactions"), env, ctx)).status).toBe(405);
  });
});
