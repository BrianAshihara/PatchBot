// Funções de apoio para ler um anúncio Components V2 nos testes.

interface Node {
  type: number;
  content?: string;
  components?: Node[];
  accessory?: Node;
  items?: { media: { url: string } }[];
  media?: { url: string };
  url?: string;
  label?: string;
  accent_color?: number;
}

/** Todos os nós da mensagem, em profundidade. */
export function nodes(message: { components?: unknown[] }): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    out.push(n);
    n.components?.forEach(walk);
    if (n.accessory) walk(n.accessory);
  };
  (message.components as Node[] | undefined)?.forEach(walk);
  return out;
}

/** Todos os blocos de texto, em ordem. */
export function texts(message: { components?: unknown[] }): string[] {
  return nodes(message)
    .filter((n) => n.type === 10)
    .map((n) => n.content!);
}

/** O bloco das notas (o texto depois do cabeçalho). */
export function notesOf(message: { components?: unknown[] }): string | undefined {
  return texts(message)[1];
}
