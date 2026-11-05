import type { BoardContent } from './board';

// STUB de T0 (firma final). Lo implementa el carril D con su test (`mermaid.test.ts`).

export type MermaidParseResult = { ok: true; value: BoardContent } | { ok: false; error: string; line?: number };

/** Importa un flowchart/graph de Mermaid. Construye con makeNode/makeEdge y valida con validateBoardContent. */
export function parseFlowchart(_src: string): MermaidParseResult {
  throw new Error('parseFlowchart: not implemented (carril D)');
}

/** Exporta el contenido a texto Mermaid (round-trip probado con el fixture). */
export function toFlowchart(_content: BoardContent, _direction: 'LR' | 'TB' = 'LR'): string {
  throw new Error('toFlowchart: not implemented (carril D)');
}
