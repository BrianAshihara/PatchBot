-- Índice para "os patches mais recentes de um jogo": a detecção (a cada 2 min) e o /status leem só as linhas de
-- que precisam, em vez de todos os patches do jogo. Mantém as linhas lidas por dia constantes enquanto o banco cresce.
CREATE INDEX patches_by_date ON patches (game, published_at DESC);
