import { describe, expect, it } from 'vitest';
import { makeEdge, makeNode, type BoardContent, type BoardNode } from './model/board';
import { mergeBoards } from './model/merge';
import { createBoardStore } from './store/boardStore';
import { boardSame, createBoardSync } from './sync';

// D13: historial por referencia y fusión diferencial por id, medidos con un board de 2 000 nodos. Las medianas
// van a la salida (`pnpm exec vitest run src/editors/board/perf.test.ts --reporter=verbose`); las comprobaciones son
// techos holgados (la máquina de CI puede ser lenta): atrapan una vuelta al recorrido completo con JSON, no una décima
// de ms. Antes de D13 (JSON por cambio): mover 7 ms, selección 7 ms, gesto 18 ms, onRemote 102 ms, con 100 pasos de
// historial 7 900 ms, mergeBoards 45 ms, boardSame 89 ms. Después: ver HANDOFF-l4.md.

const N = 2000;
const VIEW = { x: 0, y: 0, zoom: 1 };

function bigBoard(): BoardContent {
  const nodes: BoardNode[] = [];
  for (let i = 0; i < N; i++) {
    const n = makeNode(i % 40 === 0 ? 'frame' : 'shape', { x: (i % 50) * 220, y: Math.floor(i / 50) * 140 }, { label: `Nodo ${i}` });
    nodes.push({ ...n, id: `n${i}`, width: 160, height: 96 });
  }
  const edges = Array.from({ length: 2500 }, (_, i) => ({ ...makeEdge(`n${i % N}`, `n${(i * 7 + 3) % N}`), id: `e${i}` }));
  return { schemaVersion: 1, nodes, edges, viewport: VIEW };
}

// `encode` rechaza más de 900 KB (D17): un board de 2 000 nodos pesa ≈ 1,1 MB, así que aquí se serializa a mano.
const encode = (v: unknown) => JSON.stringify(v);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
function time(runs: number, fn: (i: number) => void): number {
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn(i);
    t.push(performance.now() - t0);
  }
  return median(t);
}
const fmt = (ms: number) => `${ms.toFixed(2)} ms`;

describe(`rendimiento con ${N} nodos (D13)`, () => {
  const base = bigBoard();
  const results: Record<string, string> = {};

  it('historial: un paso de arrastre y un cambio de selección', () => {
    const s = createBoardStore();
    s.getState().load(base);
    const move = time(40, (i) =>
      s.getState().setNodes((ns) => ns.map((n) => (n.id === 'n5' ? { ...n, position: { x: i, y: 0 } } : n))),
    );
    const select = time(40, (i) =>
      s.getState().setNodes((ns) => ns.map((n) => (n.id === 'n7' ? { ...n, selected: i % 2 === 0 } : n))),
    );
    results['historial · mover un nodo'] = fmt(move);
    results['historial · cambiar la selección'] = fmt(select);
    expect(s.temporal.getState().pastStates.length).toBe(40); // los 40 movimientos; la selección no entra
    expect(move).toBeLessThan(3);
    expect(select).toBeLessThan(3);
  });

  it('historial: un gesto de 20 movimientos se cierra en un solo paso', () => {
    const s = createBoardStore();
    s.getState().load(base);
    const gesture = time(10, () => {
      s.getState().beginGesture();
      for (let k = 0; k < 20; k++)
        s.getState().setNodes((ns) => ns.map((n) => (n.id === 'n5' ? { ...n, position: { x: k, y: 1 } } : n)));
      s.getState().endGesture();
    });
    results['historial · gesto de 20 movimientos'] = fmt(gesture);
    expect(gesture).toBeLessThan(12);
  });

  it('fusión: llega un remoto con un nodo cambiado', () => {
    const s = createBoardStore();
    s.getState().load(base);
    const sync = createBoardSync(s, base, 1);
    const remote = (i: number): string =>
      encode({
        ...base,
        nodes: base.nodes.map((n) => (n.id === 'n9' ? { ...n, data: { ...n.data, label: `remoto ${i}` } } : n)),
      });
    const texts = Array.from({ length: 15 }, (_, i) => remote(i));
    const onRemote = time(15, (i) => {
      expect(sync.onRemote({ data: texts[i]!, schemaVersion: 1, revision: i + 2, updatedAt: 0 })).not.toBeNull();
    });
    expect(s.getState().nodes.find((n) => n.id === 'n9')!.data.label).toBe('remoto 14');
    results['fusión · onRemote (parse incluido)'] = fmt(onRemote);
    expect(onRemote).toBeLessThan(100);
  });

  it('fusión: llega un remoto con un nodo cambiado y el historial lleno (100 pasos)', () => {
    const s = createBoardStore();
    s.getState().load(base);
    for (let i = 0; i < 100; i++)
      s.getState().setNodes((ns) => ns.map((n) => (n.id === 'n5' ? { ...n, position: { x: i + 1, y: 0 } } : n)));
    expect(s.temporal.getState().pastStates.length).toBe(100);
    const sync = createBoardSync(s, base, 1);
    const texts = Array.from({ length: 8 }, (_, i) =>
      encode({
        ...base,
        nodes: base.nodes.map((n) => (n.id === 'n9' ? { ...n, data: { ...n.data, label: `r${i}` } } : n)),
      }),
    );
    const onRemote = time(8, (i) => void sync.onRemote({ data: texts[i]!, schemaVersion: 1, revision: i + 2, updatedAt: 0 }));
    results['fusión · onRemote con 100 pasos de historial'] = fmt(onRemote);
    expect(onRemote).toBeLessThan(250); // antes ≈ 7 900 ms: un diff por id y por paso
  });

  it('fusión: mergeBoards y boardSame sobre el board entero', () => {
    const remote = { ...base, nodes: base.nodes.map((n) => (n.id === 'n9' ? { ...n, position: { x: 1, y: 1 } } : n)) };
    const merge = time(15, () => void mergeBoards(base, remote, base));
    // Textos nuevos en cada medida: sin la memoria de la última lectura (peor caso).
    const texts = Array.from({ length: 10 }, (_, i) => [encode({ ...base, viewport: { ...VIEW, x: i } }), encode({ ...remote, viewport: { ...VIEW, x: i } })] as const);
    const same = time(10, (i) => void boardSame(texts[i]![0], texts[i]![1]));
    results['fusión · mergeBoards'] = fmt(merge);
    results['fusión · boardSame (2 textos)'] = fmt(same);
    expect(merge).toBeLessThan(15);
    expect(same).toBeLessThan(60);
  });

  it('resumen', () => {
    console.table(results);
  });
});
