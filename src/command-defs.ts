// Definições dos comandos de barra (§7), registradas por scripts/register-commands.ts.
// Os imports usam a extensão `.ts` explícita para o Node conseguir rodar o script direto.

import type { RESTPutAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import { GAMES } from "./sources/games.ts";

/** Gerenciar Servidor. */
export const ADMIN_PERMISSION = "32";

/** Comando de barra, instalado em servidores e usável só dentro de servidores. */
const GUILD_ONLY = { type: 1 as const, contexts: [0], integration_types: [0] };
const ADMIN_ONLY = { ...GUILD_ONLY, default_member_permissions: ADMIN_PERMISSION };

// Valores numéricos de ApplicationCommandOptionType / ChannelType.
const STRING = 3;
const CHANNEL = 7;
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;

export const COMMANDS = [
  {
    name: "setup",
    description: "Choose the channel where game updates are posted",
    ...ADMIN_ONLY,
    options: [
      {
        type: CHANNEL,
        name: "channel",
        description: "Text or announcement channel",
        required: true,
        channel_types: [GUILD_TEXT, GUILD_ANNOUNCEMENT],
      },
    ],
  },
  { name: "games", description: "Choose which games this server follows", ...ADMIN_ONLY },
  { name: "status", description: "Show the channel, followed games and latest known patches", ...ADMIN_ONLY },
  {
    name: "test",
    description: "Post the latest stored patch of a game in the configured channel",
    ...ADMIN_ONLY,
    options: [
      {
        type: STRING,
        name: "game",
        description: "Game to test",
        required: true,
        choices: GAMES.map((g) => ({ name: g.name, value: g.key })),
      },
    ],
  },
  { name: "help", description: "What this bot does", ...GUILD_ONLY },
] satisfies RESTPutAPIApplicationCommandsJSONBody;
