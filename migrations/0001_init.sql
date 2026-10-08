-- Todos os patches detectados.
CREATE TABLE patches (
  game         TEXT NOT NULL,
  patch_id     TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  body         TEXT,                 -- notas completas, já em markdown do Discord (NULL no LoL)
  published_at INTEGER NOT NULL,     -- unix em milissegundos
  PRIMARY KEY (game, patch_id)
);

-- Jogos verificados pelo menos uma vez. Até lá, os patches do jogo são salvos em silêncio (seeding).
CREATE TABLE seeded_games (
  game TEXT PRIMARY KEY
);

CREATE TABLE guilds (
  guild_id   TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1
);

-- Jogos que cada servidor segue.
CREATE TABLE guild_games (
  guild_id TEXT NOT NULL,
  game     TEXT NOT NULL,
  PRIMARY KEY (guild_id, game)
);

-- Postagens pendentes, que continuam entre execuções.
CREATE TABLE deliveries (
  guild_id    TEXT NOT NULL,
  game        TEXT NOT NULL,
  patch_id    TEXT NOT NULL,
  message_id  TEXT,                  -- anúncio postado
  thread_id   TEXT,                  -- thread criada
  next_chunk  INTEGER NOT NULL DEFAULT 0,
  attempts    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, game, patch_id)
);
