// Todo o SQL fica aqui. Funções que devolvem D1PreparedStatement são para rodar dentro de um `db.batch`.

export interface Patch {
  game: string;
  patch_id: string;
  title: string;
  url: string;
  body: string | null;
  published_at: number;
  /** Primeira imagem do post (miniatura do anúncio). */
  image: string | null;
  /** 1 = destacado como major update. */
  major: number;
}

export interface Guild {
  guild_id: string;
  channel_id: string;
  enabled: number;
}

export interface Delivery {
  guild_id: string;
  game: string;
  patch_id: string;
  message_id: string | null;
  thread_id: string | null;
  next_chunk: number;
  attempts: number;
}

/** Uma entrega pendente junto com o que é preciso para postá-la. */
export interface PendingDelivery extends Delivery {
  channel_id: string;
  title: string;
  url: string;
  body: string | null;
  published_at: number;
  image: string | null;
  major: number;
}

// ---- patches ----

export interface DetectState {
  /** Jogos já verificados pelo menos uma vez (veja `seeded_games`). */
  seeded: Set<string>;
  /** IDs dos patches salvos mais recentes por jogo. As fontes devolvem no máximo 5 patches, então os 20 últimos bastam. */
  recent: Map<string, Set<string>>;
}

/** Tudo o que a detecção precisa saber, numa única ida ao banco. */
export async function getDetectState(db: D1Database, games: readonly string[]): Promise<DetectState> {
  const [seeded, ...recent] = await db.batch<{ game: string; patch_id: string }>([
    db.prepare("SELECT game FROM seeded_games"),
    ...games.map((game) =>
      db.prepare("SELECT patch_id FROM patches WHERE game = ? ORDER BY published_at DESC LIMIT 20").bind(game),
    ),
  ]);
  return {
    seeded: new Set(seeded!.results.map((r) => r.game)),
    recent: new Map(games.map((game, i) => [game, new Set(recent[i]!.results.map((r) => r.patch_id))])),
  };
}

export function markSeeded(db: D1Database, game: string): D1PreparedStatement {
  return db.prepare("INSERT OR IGNORE INTO seeded_games (game) VALUES (?)").bind(game);
}

export function insertPatch(db: D1Database, p: Patch): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO patches (game, patch_id, title, url, body, published_at, image, major)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(p.game, p.patch_id, p.title, p.url, p.body, p.published_at, p.image, p.major);
}

export async function getLatestPatch(db: D1Database, game: string): Promise<Patch | null> {
  return db
    .prepare("SELECT * FROM patches WHERE game = ? ORDER BY published_at DESC LIMIT 1")
    .bind(game)
    .first<Patch>();
}

/** Último patch de cada jogo, para o `/status`. Uma consulta por jogo, todas no mesmo batch e usando o índice. */
export async function getLatestPatches(db: D1Database, games: readonly string[]): Promise<Patch[]> {
  const results = await db.batch<Patch>(
    games.map((game) =>
      db.prepare("SELECT * FROM patches WHERE game = ? ORDER BY published_at DESC LIMIT 1").bind(game),
    ),
  );
  return results.flatMap((r) => r.results);
}

// ---- guilds ----

export async function getGuild(db: D1Database, guildId: string): Promise<Guild | null> {
  return db.prepare("SELECT * FROM guilds WHERE guild_id = ?").bind(guildId).first<Guild>();
}

/** Salva o canal, ativa o servidor e segue os `games` (usado pelo `/setup`). */
export async function setupGuild(
  db: D1Database,
  guildId: string,
  channelId: string,
  games: readonly string[],
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO guilds (guild_id, channel_id, enabled) VALUES (?, ?, 1)
         ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, enabled = 1`,
      )
      .bind(guildId, channelId),
    ...setGuildGamesStatements(db, guildId, games),
  ]);
}

export async function getGuildGames(db: D1Database, guildId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT game FROM guild_games WHERE guild_id = ? ORDER BY game")
    .bind(guildId)
    .all<{ game: string }>();
  return results.map((r) => r.game);
}

export async function setGuildGames(db: D1Database, guildId: string, games: readonly string[]): Promise<void> {
  await db.batch(setGuildGamesStatements(db, guildId, games));
}

function setGuildGamesStatements(db: D1Database, guildId: string, games: readonly string[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM guild_games WHERE guild_id = ?").bind(guildId),
    ...games.map((game) => db.prepare("INSERT INTO guild_games (guild_id, game) VALUES (?, ?)").bind(guildId, game)),
  ];
}

/** Desativa um servidor e descarta as entregas pendentes dele (o bot perdeu acesso ao canal). */
export function disableGuildStatements(db: D1Database, guildId: string): D1PreparedStatement[] {
  return [
    db.prepare("UPDATE guilds SET enabled = 0 WHERE guild_id = ?").bind(guildId),
    db.prepare("DELETE FROM deliveries WHERE guild_id = ?").bind(guildId),
  ];
}

// ---- deliveries ----

/** Enfileira um patch para cada servidor ativo que segue o jogo dele. */
export function queueDeliveries(db: D1Database, game: string, patchId: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO deliveries (guild_id, game, patch_id)
       SELECT g.guild_id, gg.game, ?
       FROM guilds g JOIN guild_games gg ON gg.guild_id = g.guild_id
       WHERE g.enabled = 1 AND gg.game = ?`,
    )
    .bind(patchId, game);
}

export async function getPendingDeliveries(db: D1Database, limit: number): Promise<PendingDelivery[]> {
  const { results } = await db
    .prepare(
      `SELECT d.*, g.channel_id, p.title, p.url, p.body, p.published_at, p.image, p.major
       FROM deliveries d
       JOIN guilds g ON g.guild_id = d.guild_id AND g.enabled = 1
       JOIN patches p ON p.game = d.game AND p.patch_id = d.patch_id
       ORDER BY p.published_at, d.guild_id
       LIMIT ?`,
    )
    .bind(limit)
    .all<PendingDelivery>();
  return results;
}

export function updateDelivery(db: D1Database, d: Delivery): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE deliveries SET message_id = ?, thread_id = ?, next_chunk = ?, attempts = ?
       WHERE guild_id = ? AND game = ? AND patch_id = ?`,
    )
    .bind(d.message_id, d.thread_id, d.next_chunk, d.attempts, d.guild_id, d.game, d.patch_id);
}

export function deleteDelivery(db: D1Database, d: Pick<Delivery, "guild_id" | "game" | "patch_id">): D1PreparedStatement {
  return db
    .prepare("DELETE FROM deliveries WHERE guild_id = ? AND game = ? AND patch_id = ?")
    .bind(d.guild_id, d.game, d.patch_id);
}
