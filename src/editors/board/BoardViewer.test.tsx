// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, TooltipProvider } from '@/ui';
import { BoardViewer } from './BoardViewer';
import { emptyBoard, makeNode } from './model/board';

// La presencia (Firebase) queda fuera de esta prueba.
vi.mock('@/app/hooks', () => ({ usePresence: () => ({ others: [], move: () => undefined }) }));

// D6: un cambio remoto actualiza los nodos sin reconstruir React Flow (que reencuadraría la vista del lector).
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.DOMMatrixReadOnly = class {
    m22 = 1;
    constructor(_t?: string) {}
  } as unknown as typeof DOMMatrixReadOnly;
});

describe('BoardViewer', () => {
  it('conserva el mismo lienzo (sin remontar) cuando llega otro contenido', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const one = { ...emptyBoard(), nodes: [makeNode('sticky', { x: 0, y: 0 }, { label: 'uno' })] };
    const two = { ...one, nodes: [...one.nodes, makeNode('sticky', { x: 300, y: 0 }, { label: 'dos' })] };
    const view = (c: typeof one) => (
      <ThemeProvider>
        <TooltipProvider>
          <BoardViewer content={c} />
        </TooltipProvider>
      </ThemeProvider>
    );
    await act(async () => root.render(view(one)));
    const flow = host.querySelector('.react-flow');
    expect(flow).not.toBeNull();
    await act(async () => root.render(view(two)));
    expect(host.querySelector('.react-flow')).toBe(flow);
    expect(host.querySelectorAll('.react-flow__node')).toHaveLength(2);
    expect(host.querySelector('[aria-label="Encuadrar el diagrama"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
});
