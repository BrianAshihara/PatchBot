import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/index";

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** Um par de chaves Ed25519 fazendo o papel do Discord. */
export async function makeSigner() {
  const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = toHex((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);

  async function sign(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
    const signature = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body));
    return { "X-Signature-Ed25519": toHex(signature), "X-Signature-Timestamp": timestamp };
  }

  /** Manda uma interação assinada ao Worker, esperando qualquer trabalho em `ctx.waitUntil`. */
  async function send(interaction: unknown, headers?: Record<string, string>): Promise<Response> {
    const body = JSON.stringify(interaction);
    const request = new Request<unknown, IncomingRequestCfProperties>("https://bot.example/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(headers ?? (await sign(body))) },
      body,
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, { ...env, DISCORD_PUBLIC_KEY: publicKey }, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  return { publicKey, sign, send };
}
