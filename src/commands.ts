// Comandos de barra e componentes (§7).

import type {
  APIApplicationCommandInteractionDataOption,
  APIInteraction,
  APIInteractionResponse,
  APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { Budget, advance } from "./cron";
import { getGuild, getGuildGames, getLatestPatch, getLatestPatches, setGuildGames, setupGuild } from "./db";
import { DiscordError, editOriginal, postMessage } from "./discord";
import { GAMES, getGame } from "./sources/registry";

// Valores numéricos dos enums do discord-api-types (os valores deles não carregam no Worker).
export const InteractionType = { Ping: 1, ApplicationCommand: 2, MessageComponent: 3 } as const;
export const ResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  UpdateMessage: 7,
} as const;
/** MessageFlags.Ephemeral */
export const EPHEMERAL = 1 << 6;
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

export const GAMES_SELECT_ID = "games";
/** O `/test` nunca usa mais subrequisições que isto (o plano grátis permite 50 por invocação). */
const TEST_BUDGET = 40;

const REQUIRED_PERMISSIONS =
  "View Channel, Send Messages, Embed Links, Create Public Threads and Send Messages in Threads";

export function json(body: APIInteractionResponse): Response {
  return Response.json(body);
}

export function ephemeral(content: string): Response {
  return json({
    type: ResponseType.ChannelMessageWithSource,
    data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
  });
}

/** Resposta "pensando…", substituída depois com `editOriginal`. */
function deferEphemeral(): Response {
  return json({ type: ResponseType.DeferredChannelMessageWithSource, data: { flags: EPHEMERAL } });
}

/** Encaminha uma interação já verificada. Precisa responder em 3 s; o que chama o Discord vai para `ctx.waitUntil`. */
export async function handleInteraction(interaction: APIInteraction, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (interaction.type === InteractionType.Ping) return json({ type: ResponseType.Pong });
  if (interaction.type !== InteractionType.ApplicationCommand && interaction.type !== InteractionType.MessageComponent) {
    return new Response("Unsupported interaction", { status: 400 });
  }

  const guildId = interaction.guild_id;
  if (!guildId) return ephemeral("This bot only works inside a server.");

  if (interaction.type === InteractionType.MessageComponent) {
    if (!isAdmin(interaction)) return ephemeral("You need the **Manage Server** permission.");
    return handleComponent(interaction, guildId, env);
  }

  const data = interaction.data;
  if (!("name" in data)) return ephemeral("Unknown command.");
  if (data.name === "help") return help();
  if (!isAdmin(interaction)) return ephemeral("You need the **Manage Server** permission.");

  const options = "options" in data ? (data.options ?? []) : [];
  switch (data.name) {
    case "setup":
      return setup(guildId, String(option(options, "channel") ?? ""), interaction.token, env, ctx);
    case "games":
      return games(guildId, env);
    case "status":
      return status(guildId, env);
    case "test":
      return test(guildId, String(option(options, "game") ?? ""), interaction.token, env, ctx);
    default:
      return ephemeral("Unknown command.");
  }
}

/** Gerenciar Servidor, conferido de novo no código (§7); Administrador também vale. */
function isAdmin(interaction: APIInteraction): boolean {
  const perms = BigInt(interaction.member?.permissions ?? "0");
  return (perms & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n;
}

function option(options: APIApplicationCommandInteractionDataOption[], name: string): unknown {
  const found = options.find((o) => o.name === name);
  return found && "value" in found ? found.value : undefined;
}

function help(): Response {
  return ephemeral(
    [
      "**Patch Bot** posts game updates in this server: an announcement with the link, plus a thread with the full patch notes. Nobody is pinged.",
      `Games: ${GAMES.map((g) => g.name).join(", ")}.`,
      "",
      "Admins (Manage Server):",
      "- `/setup` choose the channel",
      "- `/games` choose which games to follow",
      "- `/status` show the current settings",
      "- `/test` post the latest patch of a game now",
    ].join("\n"),
  );
}

/** Só salva depois que a confirmação foi postada, para nunca configurar um canal que o bot não consegue usar. */
function setup(guildId: string, channelId: string, interactionToken: string, env: Env, ctx: ExecutionContext): Response {
  if (!channelId) return ephemeral("Choose a channel.");
  ctx.waitUntil(
    (async () => {
      let reply: string;
      try {
        await postMessage(env.DISCORD_TOKEN, channelId, {
          content: "✅ Patch Bot is set up: game updates will be posted in this channel.",
        });
        await setupGuild(env.DB, guildId, channelId, GAMES.map((g) => g.key));
        reply = `✅ Updates will be posted in <#${channelId}>. Following all games; use \`/games\` to change.`;
      } catch (err) {
        reply = cannotPost(err, channelId);
      }
      await editOriginal(env.DISCORD_TOKEN, env.DISCORD_APPLICATION_ID, interactionToken, reply);
    })(),
  );
  return deferEphemeral();
}

async function games(guildId: string, env: Env): Promise<Response> {
  if (!(await getGuild(env.DB, guildId))) return ephemeral("Run `/setup` first.");
  const followed = new Set(await getGuildGames(env.DB, guildId));
  return json({
    type: ResponseType.ChannelMessageWithSource,
    data: {
      content: "Choose the games this server follows:",
      flags: EPHEMERAL,
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: GAMES_SELECT_ID,
              min_values: 0,
              max_values: GAMES.length,
              placeholder: "No games",
              options: GAMES.map((g) => ({ label: g.name, value: g.key, default: followed.has(g.key) })),
            },
          ],
        },
      ],
    },
  });
}

async function handleComponent(interaction: APIMessageComponentInteraction, guildId: string, env: Env): Promise<Response> {
  const data = interaction.data;
  if (data.custom_id !== GAMES_SELECT_ID || !("values" in data)) return ephemeral("Unknown action.");
  if (!(await getGuild(env.DB, guildId))) return ephemeral("Run `/setup` first.");

  const selected = data.values.filter((v) => getGame(v));
  await setGuildGames(env.DB, guildId, selected);
  const names = selected.map((k) => getGame(k)!.name);
  return json({
    type: ResponseType.UpdateMessage,
    data: {
      content: names.length ? `✅ Following: ${names.join(", ")}.` : "✅ Not following any game.",
      components: [],
    },
  });
}

async function status(guildId: string, env: Env): Promise<Response> {
  const guild = await getGuild(env.DB, guildId);
  if (!guild) return ephemeral("Not set up yet. Run `/setup`.");
  const [followed, latest] = await Promise.all([getGuildGames(env.DB, guildId), getLatestPatches(env.DB, GAMES.map((g) => g.key))]);
  const latestByGame = new Map(latest.map((p) => [p.game, p]));

  const lines = [
    `**Channel:** <#${guild.channel_id}>`,
    guild.enabled
      ? "**State:** active"
      : "**State:** ⚠️ paused: I lost access to the channel. Fix my permissions and run `/setup` again.",
    `**Following:** ${followed.length ? followed.map((k) => getGame(k)?.name ?? k).join(", ") : "nothing"}`,
    "",
    "**Latest known patches:**",
    ...GAMES.map((g) => {
      const p = latestByGame.get(g.key);
      return p ? `- ${g.name}: [${p.title}](<${p.url}>) (<t:${Math.floor(p.published_at / 1000)}:R>)` : `- ${g.name}: none yet`;
    }),
  ];
  return ephemeral(lines.join("\n"));
}

function test(guildId: string, gameKey: string, interactionToken: string, env: Env, ctx: ExecutionContext): Response {
  const game = getGame(gameKey);
  if (!game) return ephemeral("Unknown game.");
  ctx.waitUntil(
    (async () => {
      const reply = await runTest(guildId, gameKey, game.name, env);
      await editOriginal(env.DISCORD_TOKEN, env.DISCORD_APPLICATION_ID, interactionToken, reply);
    })(),
  );
  return deferEphemeral();
}

async function runTest(guildId: string, gameKey: string, gameName: string, env: Env): Promise<string> {
  const [guild, patch] = await Promise.all([getGuild(env.DB, guildId), getLatestPatch(env.DB, gameKey)]);
  if (!guild) return "Not set up yet. Run `/setup`.";
  if (!patch) return `No ${gameName} patch stored yet. The bot checks every 2 minutes.`;

  // 2 leituras no D1 acima + a edição final desta resposta.
  const budget = new Budget(TEST_BUDGET - 3);
  const state = { ...patch, channel_id: guild.channel_id, message_id: null, thread_id: null, next_chunk: 0 };
  const outcome = await advance(state, env.DISCORD_TOKEN, budget);
  switch (outcome) {
    case "done":
      return `✅ Posted the latest ${gameName} patch in <#${guild.channel_id}>.`;
    case "budget":
      return `✅ Posted the latest ${gameName} patch in <#${guild.channel_id}> (test shows only the first ${state.next_chunk} parts of the notes).`;
    case "disable":
      return `❌ I can't post in <#${guild.channel_id}>. I need: ${REQUIRED_PERMISSIONS}.`;
    default:
      return "❌ Discord didn't accept the post right now. Try again in a minute.";
  }
}

function cannotPost(err: unknown, channelId: string): string {
  if (err instanceof DiscordError && (err.status === 403 || err.status === 404)) {
    return `❌ I can't post in <#${channelId}>. Give me these permissions there: ${REQUIRED_PERMISSIONS}. Nothing was saved.`;
  }
  console.error("setup", err);
  return "❌ Discord didn't accept the post right now. Try again in a minute. Nothing was saved.";
}
