-- Card do anúncio (§6): imagem e destaque de "major update", decididos na detecção a partir do post bruto.
ALTER TABLE patches ADD COLUMN image TEXT;                         -- primeira imagem do post, se houver
ALTER TABLE patches ADD COLUMN major INTEGER NOT NULL DEFAULT 0;   -- 1 = destacado como major update
