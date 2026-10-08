// Registra os comandos de barra no Discord (§7).
//
//   npm run register-commands -- --guild <server id>           # só no servidor de teste, atualiza na hora
//   npm run register-commands                                  # global, todos os servidores (pode demorar a aparecer)
//   npm run register-commands -- --guild <server id> --clear   # remove as cópias do servidor de teste (evita
//                                                              # duplicados quando os globais já existem)
//
// Lê DISCORD_TOKEN e DISCORD_APPLICATION_ID do .dev.vars. Sobrescreve a lista inteira de comandos (PUT em massa),
// então comandos removidos do código também somem do Discord.

import { COMMANDS } from "../src/command-defs.ts";

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
if (!token || !appId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_APPLICATION_ID in .dev.vars");
  process.exit(1);
}

const guildFlag = process.argv.indexOf("--guild");
const guildId = guildFlag === -1 ? undefined : process.argv[guildFlag + 1];
if (guildFlag !== -1 && !guildId) {
  console.error("Usage: npm run register-commands -- --guild <server id>");
  process.exit(1);
}

const clear = process.argv.includes("--clear");
if (clear && !guildId) {
  console.error("--clear only works with --guild (global commands are what the bot uses).");
  process.exit(1);
}

const path = guildId ? `/applications/${appId}/guilds/${guildId}/commands` : `/applications/${appId}/commands`;
const res = await fetch(`https://discord.com/api/v10${path}`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(clear ? [] : COMMANDS),
});

if (!res.ok) {
  console.error(`Discord HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}
if (clear) {
  console.log(`Removed the commands registered in server ${guildId}.`);
  process.exit(0);
}
const registered = (await res.json()) as { name: string }[];
console.log(`Registered ${registered.length} commands ${guildId ? `in server ${guildId}` : "globally"}:`);
for (const c of registered) console.log(`  /${c.name}`);
