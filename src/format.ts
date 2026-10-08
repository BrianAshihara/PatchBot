// BBCode da Steam → markdown do Discord, e divisão em mensagens do tamanho do Discord (§6).

export const CHUNK_LIMIT = 1900;

/** Tags removidas junto com o conteúdo. */
const DROPPED_WITH_CONTENT = ["img", "previewyoutube", "video"];

const INLINE: Record<string, string> = { b: "**", i: "*", u: "__", strike: "~~" };

export function bbcodeToMarkdown(input: string): string {
  let s = input.replace(/\r\n?/g, "\n");

  // Mídia. Um link que envolve só uma imagem (um banner) sai junto.
  s = s.replace(/\[url=[^\]]*\]\s*\[img\b[^\]]*\][\s\S]*?\[\/img\]\s*\[\/url\]/gi, "");
  for (const tag of DROPPED_WITH_CONTENT) {
    s = s.replace(new RegExp(`\\[${tag}\\b[^\\]]*\\][\\s\\S]*?\\[\\/${tag}\\]`, "gi"), "");
  }
  s = s.replace(/\{STEAM_CLAN(?:_LOC)?_IMAGE\}\S*/g, "");

  // HTML.
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n");
  s = s.replace(/<\/?[a-z][^>]*>/gi, "");
  s = decodeEntities(s);

  // Estilos e links. Os espaços dentro dos marcadores vão para fora, senão o Discord não formata.
  for (const [tag, marker] of Object.entries(INLINE)) {
    s = s.replace(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "gi"), (_, text: string) =>
      wrap(text, marker, marker),
    );
  }
  s = convertBlocks(s);

  // Links por último, para a etapa de blocos não confundir `[texto](href)` com uma tag.
  s = s.replace(/\[url=["']?([^\]"']+)["']?\]([\s\S]*?)\[\/url\]/gi, (_, href: string, text: string) =>
    text.trim() ? wrap(text, "[", `](${href})`) : href,
  );
  s = s.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, "$1");
  s = s.replace(/\\([[\]])/g, "$1");

  return tidy(s)
    .split("\n")
    .map((line) => (/^\s*- /.test(line) ? scannable(line) : line))
    .join("\n");
}

/** Um número com sinal e unidade opcionais, como aparece nas notas: 65, -22%, +2m, 1.5s, 75s. */
const NUM = String.raw`[+\-]?\d[\d.,]*(?:%|m|s|x)?`;
const FROM_TO = new RegExp(
  String.raw`(?:\b(increased|raised|reduced|decreased|lowered|changed)\s+)?\bfrom\s+(${NUM})\s+to\s+(${NUM})(?![\w%/])`,
  "gi",
);

/**
 * Deixa um item fácil de ler (§6): `- Rat King: Damage increased from 65 to 70` → `- **Rat King**: Damage ▲ 65 → 70`.
 * O nome só fica em negrito quando é curto e abre a linha; os números, só quando os dois lados são números.
 */
function scannable(line: string): string {
  const out = line.replace(FROM_TO, (_, verb: string | undefined, from: string, to: string) => {
    const v = verb?.toLowerCase();
    const arrow = v === "increased" || v === "raised" ? "▲ " : v && v !== "changed" ? "▼ " : "";
    return `${arrow}${from} → ${to}`;
  });
  return out.replace(/^(\s*- )([A-Z][\w'’&.\- ]{0,28}[\w.)]):(?=\s)/, (whole, bullet: string, name: string) =>
    name.split(" ").length <= 4 ? `${bullet}**${name}**:` : whole,
  );
}

function wrap(text: string, open: string, close: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return m[2] ? `${m[1]}${open}${m[2]}${close}${m[3]}` : text;
}

/** Tags de BBCode da Steam sem tratamento especial: removidas, mantendo o texto. */
const KNOWN_TAGS = new Set(
  "quote spoiler noparse code color size strike table tr td th hr p expand emoticon sticker carousel"
    .split(" "),
);

/**
 * Títulos, listas e parágrafos. Outras tags são removidas (mantendo o texto) quando são BBCode conhecido ou têm
 * tag de fechamento em algum lugar; qualquer outra coisa entre colchetes, como `[PC]`, é texto e fica.
 */
function convertBlocks(s: string): string {
  let out = "";
  let depth = 0;
  let trimNext = false;
  let last = 0;
  // `\[` é um colchete escapado, nunca uma tag. Atributos: `[url=x]`, `[p align="justify"]`.
  const tagRe = /(?<!\\)\[(\/?)([a-z0-9*]+)(?:[= ][^\]]*)?\]/gi;
  const closed = new Set(Array.from(s.matchAll(/\[\/([a-z0-9*]+)\]/gi), (m) => m[1]!.toLowerCase()));

  const emit = (text: string) => {
    if (trimNext) {
      text = text.replace(/^\s+/, "");
      if (text) trimNext = false;
    }
    out += text;
  };

  for (let m = tagRe.exec(s); m; m = tagRe.exec(s)) {
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    const isList = tag === "list" || tag === "olist" || tag === "*";
    if (tag === "url" || !(isList || /^h[1-6]$/.test(tag) || KNOWN_TAGS.has(tag) || closed.has(tag))) continue;

    emit(s.slice(last, m.index));
    last = tagRe.lastIndex;

    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      if (closing) {
        out += "\n";
      } else {
        out += `\n${"#".repeat(Math.min(Number(heading[1]), 3))} `;
        trimNext = true;
      }
    } else if (tag === "list" || tag === "olist") {
      depth = Math.max(0, depth + (closing ? -1 : 1));
      out += "\n";
    } else if (tag === "*") {
      if (!closing) {
        out += `\n${"  ".repeat(Math.max(0, depth - 1))}- `;
        trimNext = true;
      }
    } else if ((tag === "p" || tag === "hr" || tag === "tr") && !trimNext) {
      // Ignorado logo depois de `- ` / `# `, para `[*][p]texto[/p]` ficar numa linha só.
      out += "\n";
    }
  }
  emit(s.slice(last));
  return out;
}

function tidy(s: string): string {
  return (
    s
      .split("\n")
      .map((line) =>
        line
          .replace(/\s+$/, "")
          .replace(/^(\s*)(#{1,3}|-) +/, "$1$2 ")
          // Uma linha que é só um rótulo entre colchetes ("[ MISC ]" do CS2/Deadlock, talvez em negrito) vira título.
          .replace(/^\s*(?:\*\*|__|\*)*\s*\[\s*([^\][]{1,60}?)\s*\]\s*(?:\*\*|__|\*)*$/, "### $1"),
      )
      // Títulos e itens que ficaram vazios depois de remover o conteúdo.
      .filter((line) => !/^\s*(#{1,3}|-)$/.test(line))
      .join("\n")
      // Sem linhas em branco entre itens seguidos.
      .replace(/^(\s*- .*)\n(?:\n)+(?=\s*- )/gm, "$1\n")
      // Uma linha em branco antes de cada título, nenhuma depois.
      .replace(/\n*^(#{1,3} [^\n]*)\n+/gm, "\n\n$1\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Divide o texto em mensagens de até `limit` caracteres, só em quebras de linha, a não ser que uma linha seja longa demais. */
export function chunk(text: string, limit = CHUNK_LIMIT): string[] {
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.replace(/\n+$/, ""));
    current = "";
  };

  for (const line of text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    flush();
    let rest = line;
    while (rest.length > limit) {
      const cut = splitPoint(rest, limit);
      chunks.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    current = rest;
  }
  flush();
  return chunks;
}

/** Onde cortar uma linha longa demais: último espaço dentro do limite, nunca no meio de um par surrogate. */
function splitPoint(line: string, limit: number): number {
  const space = line.lastIndexOf(" ", limit);
  if (space > limit / 2) return space;
  const code = line.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}
