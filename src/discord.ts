// Funções de apoio para a API REST v10 do Discord (fetch puro, sem discord.js).

// Do discord-api-types vêm só os tipos: os valores dele (Routes, enums) são CommonJS e não carregam no Worker.
import type {
  APIComponentInContainer,
  APIContainerComponent,
  APIMessage,
  APIThreadChannel,
  RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { verifyKey } from "discord-interactions";
import { chunk } from "./format";
import { gameImage, sourceInfo, type Game } from "./sources/registry";

/**
 * Confere a assinatura Ed25519 do Discord num pedido de interação. Devolve o corpo bruto se for válida, senão null.
 * O Discord manda assinaturas inválidas de propósito para testar o endpoint; elas precisam receber 401.
 */
export async function verifyInteraction(request: Request, publicKey: string): Promise<string | null> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return null;
  const body = await request.text();
  try {
    return (await verifyKey(body, signature, timestamp, publicKey)) ? body : null;
  } catch {
    return null;
  }
}

const API = "https://discord.com/api/v10";

/** MessageFlags.SuppressEmbeds */
const SUPPRESS_EMBEDS = 1 << 2;

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Discord HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

export async function discordRequest<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://github.com/patch-bot, 0.1.0)",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new DiscordError(res.status, await res.text());
  return res.json<T>();
}

/** Ninguém é mencionado, nunca (§1). */
const NO_MENTIONS = { allowed_mentions: { parse: [] } } satisfies RESTPostAPIChannelMessageJSONBody;

export function postMessage(
  token: string,
  channelId: string,
  message: Omit<RESTPostAPIChannelMessageJSONBody, "allowed_mentions">,
): Promise<APIMessage> {
  return discordRequest(token, "POST", `/channels/${channelId}/messages`, { ...message, ...NO_MENTIONS });
}

/** Um pedaço das notas: texto simples, sem prévia de links, para a thread continuar legível. */
export function postText(token: string, channelId: string, content: string): Promise<APIMessage> {
  return postMessage(token, channelId, { content, flags: SUPPRESS_EMBEDS });
}

export function startThread(token: string, channelId: string, messageId: string, name: string): Promise<APIThreadChannel> {
  return discordRequest(token, "POST", `/channels/${channelId}/messages/${messageId}/threads`, {
    name: truncate(name, 100),
  });
}

/** Substitui a resposta (adiada) de uma interação. */
export function editOriginal(token: string, appId: string, interactionToken: string, content: string): Promise<APIMessage> {
  return discordRequest(token, "PATCH", `/webhooks/${appId}/${interactionToken}/messages/@original`, {
    content,
    ...NO_MENTIONS,
  });
}
/** Limite do Discord para todo o texto de uma mensagem Components V2. */
export const MESSAGE_TEXT_LIMIT = 4000;
export const CONTINUED_NOTE = "-# 🧵 Continued in the thread below.";
/** MessageFlags.IsComponentsV2 */
const IS_COMPONENTS_V2 = 1 << 15;

export interface Announcement {
  /** Mensagem Components V2: um card (container). */
  message: RESTPostAPIChannelMessageJSONBody & { components: APIContainerComponent[] };
  /** As notas não couberam no card: abrir uma thread com as notas completas. */
  needsThread: boolean;
}

export interface AnnouncedPatch {
  title: string;
  url: string;
  published_at: number;
  body: string | null;
  image: string | null;
  major: number;
}

/**
 * O card do anúncio (§6), um container Components V2 com a cor do jogo:
 *   [imagem grande, só em major updates]
 *   -# 🆕 New update · <Jogo>            [miniatura]
 *   ## <Título do patch> (link)
 *   -# Steam · <data no fuso de quem lê>
 *   ───────────
 *   <notas, tamanho normal de texto>
 *   [Read on Steam]
 * Notas que cabem vão inteiras e não precisam de thread; notas longas mostram o começo (cortado numa quebra de
 * linha) e continuam na thread.
 */
export function announcement(game: Game, patch: AnnouncedPatch): Announcement {
  const source = sourceInfo(game);
  const picture = patch.image ?? gameImage(game);
  const bigPicture = patch.major === 1 && patch.image !== null;
  const header = [
    `-# ${patch.major ? "🔥 **MAJOR UPDATE**" : "🆕 New update"} · ${game.name}`,
    `## [${escapeLinkText(truncate(patch.title, 200))}](${patch.url})`,
    `-# ${source.site} · <t:${Math.floor(patch.published_at / 1000)}:f>`,
  ].join("\n");

  const card: APIComponentInContainer[] = [];
  if (bigPicture) card.push({ type: 12, items: [{ media: { url: patch.image! } }] });
  card.push(
    picture && !bigPicture
      ? { type: 9, components: [{ type: 10, content: header }], accessory: { type: 11, media: { url: picture } } }
      : { type: 10, content: header },
  );

  const notes = patch.body === null ? "The new patch is live. Full notes on the official site." : patch.body.trim();
  let needsThread = false;
  if (notes) {
    const room = MESSAGE_TEXT_LIMIT - header.length;
    let text = notes;
    if (notes.length > room) {
      needsThread = true;
      const lines = (chunk(notes, room - CONTINUED_NOTE.length - 2)[0] ?? "").split("\n");
      // Não termina o trecho num título sem nada embaixo.
      while (lines.length > 1 && /^\s*(#{1,3} |$)/.test(lines.at(-1)!)) lines.pop();
      text = `${lines.join("\n")}\n\n${CONTINUED_NOTE}`;
    }
    card.push({ type: 14, divider: true, spacing: 1 }, { type: 10, content: text });
  }
  card.push({ type: 1, components: [{ type: 2, style: 5, label: source.button, url: patch.url }] });

  return {
    message: { flags: IS_COMPONENTS_V2, components: [{ type: 17, accent_color: game.color, components: card }] },
    needsThread,
  };
}

export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max - 1).join("") + "…";
}

function escapeLinkText(s: string): string {
  return s.replace(/([[\]])/g, "\\$1");
}
