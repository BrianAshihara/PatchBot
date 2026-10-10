// Fluxo do cron (§5): detecta patches novos e depois os entrega.

import {
  deleteDelivery,
  disableGuildStatements,
  getDetectState,
  getPendingDeliveries,
  insertPatch,
  markSeeded,
  queueDeliveries,
  updateDelivery,
  type Delivery,
  type PendingDelivery,
} from "./db";
import { announcement, DiscordError, postMessage, postText, startThread } from "./discord";
import { bbcodeToMarkdown, chunk } from "./format";
import { fetchPatches, GAMES, getGame, isMajor, type Game, type SourcePatch } from "./sources/registry";

/** Limite do projeto por execução do cron (§3): o plano grátis permite 50 subrequisições por invocação. */
export const SUBREQUEST_BUDGET = 40;

/** Uma execução do cron: detecta e depois entrega com o que sobrou do limite. */
export async function runCron(env: Env): Promise<{ detect: DetectResult; deliver: DeliverResult }> {
  const budget = new Budget(SUBREQUEST_BUDGET);
  const detected = await detect(env.DB, GAMES);
  budget.remaining -= detected.subrequests;
  const delivered = await deliver(env.DB, env.DISCORD_TOKEN, budget);
  return { detect: detected, deliver: delivered };
}

export interface DetectResult {
  /** Subrequisições usadas: um fetch por jogo + uma leitura no D1 + uma escrita no D1. */
  subrequests: number;
  seeded: string[];
  failed: string[];
  newPatches: { game: string; patchId: string }[];
}

/**
 * §5.1. Busca em todas as fontes, salva os patches ainda não vistos e enfileira as entregas deles.
 * Um jogo ainda não verificado é registrado em silêncio, para o primeiro deploy não anunciar patches antigos.
 */
export async function detect(db: D1Database, games: readonly Game[]): Promise<DetectResult> {
  const result: DetectResult = { subrequests: games.length + 1, seeded: [], failed: [], newPatches: [] };
  const fetched = await Promise.allSettled(games.map((game) => fetchPatches(game)));
  const state = await getDetectState(
    db,
    games.map((g) => g.key),
  );

  const statements: D1PreparedStatement[] = [];
  for (const [i, game] of games.entries()) {
    const outcome = fetched[i]!;
    if (outcome.status === "rejected") {
      console.error(`detect: source ${game.key} failed`, outcome.reason);
      result.failed.push(game.key);
      continue;
    }
    const knownIds = state.recent.get(game.key)!;
    // Do mais antigo para o mais novo, para as entregas seguirem a ordem de publicação.
    const fresh = outcome.value.filter((p) => !knownIds.has(p.patchId)).sort((a, b) => a.publishedAt - b.publishedAt);

    if (!state.seeded.has(game.key)) {
      // Registro inicial, mesmo sem nada para salvar (todos os posts recentes filtrados). Só o texto do mais novo é
      // convertido (é o que o `/test` posta), o que mantém a primeira execução dentro do limite de CPU.
      result.seeded.push(game.key);
      statements.push(markSeeded(db, game.key));
      fresh.forEach((p, j) => statements.push(insertPatch(db, toRow(game, p, j === fresh.length - 1))));
      continue;
    }

    for (const p of fresh) {
      if (p.urlCandidates) {
        const resolved = await firstExisting(p.urlCandidates);
        result.subrequests += resolved.tried;
        if (resolved.url) p.url = resolved.url;
      }
      statements.push(insertPatch(db, toRow(game, p, true)), queueDeliveries(db, game.key, p.patchId));
      result.newPatches.push({ game: game.key, patchId: p.patchId });
      // Quanto tempo entre a publicação (data informada pela fonte) e a detecção; aparece nos logs da Cloudflare.
      const lagSeconds = Math.round((Date.now() - p.publishedAt) / 1000);
      console.log(JSON.stringify({ event: "new_patch", game: game.key, title: p.title, lagSeconds }));
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
    result.subrequests++;
  }
  return result;
}

/**
 * O primeiro endereço que existe (HEAD com resposta 2xx), em ordem. Só roda para patches novos, então custa no
 * máximo uma subrequisição por candidato a cada patch. Falha de rede conta como "não existe".
 */
async function firstExisting(urls: string[]): Promise<{ url: string | null; tried: number }> {
  let tried = 0;
  for (const url of urls) {
    tried++;
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.ok) return { url, tried };
    } catch {
      // tenta o próximo
    }
  }
  return { url: null, tried };
}

/** Conta as subrequisições (fetch + D1) que ainda restam nesta invocação. */
export class Budget {
  constructor(public remaining: number) {}

  take(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining--;
    return true;
  }
}

export interface DeliverResult {
  /** Entregas terminadas por completo (e removidas) nesta execução. */
  finished: number;
  stoppedBy: "budget" | "rate-limit" | null;
}

/** Máximo de tentativas de entrega com erro de servidor antes de desistir (§5.2). */
const MAX_ATTEMPTS = 5;

/**
 * §5.2. Avança as entregas pendentes passo a passo (anúncio → thread → um pedaço por vez) até o limite acabar.
 * O progresso é salvo num único batch no fim, então um patch longo continua na próxima execução.
 */
export async function deliver(db: D1Database, token: string, budget: Budget): Promise<DeliverResult> {
  const result: DeliverResult = { finished: 0, stoppedBy: null };
  // Reserva uma leitura + uma escrita final, e deixa espaço para pelo menos uma chamada ao Discord.
  if (budget.remaining < 3) return { ...result, stoppedBy: "budget" };
  budget.remaining -= 2;

  const pending = await getPendingDeliveries(db, budget.remaining);
  const statements: D1PreparedStatement[] = [];
  const disabled = new Set<string>();

  for (const original of pending) {
    if (disabled.has(original.guild_id)) continue;
    const d = { ...original };
    const outcome = await advance(d, token, budget);
    if (outcome !== "done" && outcome !== "budget" && outcome !== "rate-limit") {
      console.error(`deliver ${d.guild_id}/${d.game}/${d.patch_id}: ${outcome}`);
    }

    switch (outcome) {
      case "done":
      case "drop":
        statements.push(deleteDelivery(db, d));
        if (outcome === "done") result.finished++;
        break;
      case "disable":
        disabled.add(d.guild_id);
        statements.push(...disableGuildStatements(db, d.guild_id));
        break;
      case "retry":
        d.attempts++;
        statements.push(d.attempts >= MAX_ATTEMPTS ? deleteDelivery(db, d) : updateDelivery(db, d));
        break;
      default:
        statements.push(updateDelivery(db, d));
    }
    if (outcome === "budget" || outcome === "rate-limit") {
      result.stoppedBy = outcome;
      break;
    }
  }

  if (statements.length > 0) await db.batch(statements);
  return result;
}

/** O que o `advance` precisa para postar um patch, e o progresso que ele atualiza no próprio objeto. */
export type PostState = Pick<
  PendingDelivery,
  | "game"
  | "title"
  | "url"
  | "body"
  | "published_at"
  | "image"
  | "major"
  | "channel_id"
  | "message_id"
  | "thread_id"
  | "next_chunk"
>;

export type AdvanceOutcome = "done" | "budget" | "rate-limit" | "disable" | "drop" | "retry";

/**
 * Posta um patch passo a passo (anúncio → thread → um pedaço por vez) enquanto houver limite, atualizando `d`.
 * Também usado pelo `/test`, com um estado que nunca é salvo.
 */
export async function advance(d: PostState, token: string, budget: Budget): Promise<AdvanceOutcome> {
  // Um jogo removido da lista ainda recebe um card simples.
  const game = getGame(d.game) ?? { key: d.game, name: d.game, source: { kind: "ddragon" as const }, color: 0 };
  const name = game.name;
  const post = announcement(game, d);
  // Notas que cabem no anúncio não precisam de thread.
  const chunks = post.needsThread && d.body ? chunk(d.body) : [];
  try {
    while (true) {
      if (d.message_id !== null && (chunks.length === 0 || d.next_chunk >= chunks.length)) return "done";
      if (!budget.take()) return "budget";
      if (d.message_id === null) {
        const msg = await postMessage(token, d.channel_id, post.message);
        d.message_id = msg.id;
      } else if (d.thread_id === null) {
        const thread = await startThread(token, d.channel_id, d.message_id, `${name} — ${d.title}`);
        d.thread_id = thread.id;
      } else {
        await postText(token, d.thread_id, chunks[d.next_chunk]!);
        d.next_chunk++;
      }
    }
  } catch (err) {
    const outcome = classify(err, d);
    if (outcome !== "rate-limit") console.error(`post ${d.game} in ${d.channel_id}`, err);
    return outcome;
  }
}

/**
 * 429 → para esta execução. 403/404 no canal (anúncio, criação da thread) → o bot perdeu acesso: desativa o
 * servidor. 403/404 dentro da thread (apagada ou trancada por um moderador) → descarta só esta entrega. Qualquer
 * outro erro (5xx, rede) → tenta de novo numa próxima execução.
 */
function classify(err: unknown, d: Pick<Delivery, "thread_id">): "rate-limit" | "disable" | "drop" | "retry" {
  if (!(err instanceof DiscordError)) return "retry";
  if (err.status === 429) return "rate-limit";
  if (err.status === 403 || err.status === 404) return d.thread_id === null ? "disable" : "drop";
  return "retry";
}

function toRow(game: Game, p: SourcePatch, withBody: boolean) {
  return {
    game: game.key,
    patch_id: p.patchId,
    title: p.title,
    url: p.url,
    body: withBody && p.contents !== null ? bbcodeToMarkdown(p.contents) : null,
    published_at: p.publishedAt,
    image: p.image,
    major: isMajor(game, p.title, p.contents) ? 1 : 0,
  };
}
