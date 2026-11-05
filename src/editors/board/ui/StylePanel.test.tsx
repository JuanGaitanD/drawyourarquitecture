// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { ToastProvider, TooltipProvider } from '@/ui';
import { makeEdge, makeNode, type BoardEdge, type BoardNode } from '../model/board';
import { BoardStoreProvider } from '../store/BoardStoreProvider';
import { createBoardStore } from '../store/boardStore';
import { FILL_COLORS } from './palette';
import { StylePanel } from './StylePanel';

const sel = <T extends BoardNode | BoardEdge>(x: T, selected = true): T => ({ ...x, selected });

function setup(nodes: BoardNode[], edges: BoardEdge[] = []) {
  const store = createBoardStore();
  store.getState().load({ schemaVersion: 1, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } });
  render(
    <TooltipProvider>
      <ToastProvider>
        <BoardStoreProvider store={store}>
          <StylePanel />
        </BoardStoreProvider>
      </ToastProvider>
    </TooltipProvider>,
  );
  return { store, user: userEvent.setup() };
}

const nodeStyle = (store: ReturnType<typeof createBoardStore>, id: string) =>
  store.getState().nodes.find((n) => n.id === id)?.data.style;

describe('StylePanel', () => {
  it('sin selección no existe', () => {
    setup([makeNode('shape', { x: 0, y: 0 })]);
    expect(screen.queryByRole('toolbar', { name: 'Estilo de la selección' })).toBeNull();
  });

  it('solo ofrece los grupos que admite la selección: una imagen solo admite opacidad', () => {
    setup([sel(makeNode('image', { x: 0, y: 0 }))]);
    expect(screen.getByRole('button', { name: 'Opacidad' })).toBeTruthy();
    for (const name of ['Relleno', 'Borde', 'Texto', 'Línea del conector']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('elegir un color de relleno escribe el estilo solo en los nodos seleccionados', async () => {
    const a = sel(makeNode('shape', { x: 0, y: 0 }));
    const b = makeNode('shape', { x: 200, y: 0 });
    const { store, user } = setup([a, b]);

    await user.click(screen.getByRole('button', { name: 'Relleno' }));
    await user.click(await screen.findByRole('button', { name: 'Rojo' }));

    expect(nodeStyle(store, a.id)?.fill).toBe(FILL_COLORS.find((c) => c.name === 'Rojo')?.value);
    expect(nodeStyle(store, b.id)).toEqual(b.data.style);
  });

  it('la opacidad se guarda como fracción (50 % → 0,5)', async () => {
    const n = sel(makeNode('sticky', { x: 0, y: 0 }));
    const { store, user } = setup([n]);

    await user.click(screen.getByRole('button', { name: 'Opacidad' }));
    await user.click(await screen.findByRole('button', { name: '50 %' }));

    expect(nodeStyle(store, n.id)?.opacity).toBe(0.5);
  });

  it('un cambio de estilo sobre varios nodos es un único paso de deshacer', async () => {
    const a = sel(makeNode('shape', { x: 0, y: 0 }));
    const b = sel(makeNode('shape', { x: 200, y: 0 }));
    const { store, user } = setup([a, b]);

    await user.click(screen.getByRole('button', { name: 'Texto' }));
    const group = await screen.findByRole('group', { name: 'Formato' });
    await user.click(within(group).getByRole('button', { name: 'Negrita' }));
    expect(nodeStyle(store, a.id)?.bold).toBe(true);
    expect(nodeStyle(store, b.id)?.bold).toBe(true);

    act(() => store.temporal.getState().undo());
    expect(nodeStyle(store, a.id)?.bold).toBe(a.data.style.bold);
    expect(nodeStyle(store, b.id)?.bold).toBe(b.data.style.bold);
  });

  it('con un conector seleccionado ofrece su trazado y lo cambia sin tocar nodos', async () => {
    const a = makeNode('shape', { x: 0, y: 0 });
    const b = makeNode('shape', { x: 300, y: 0 });
    const e = sel(makeEdge(a.id, b.id));
    const { store, user } = setup([a, b], [e]);
    expect(screen.queryByRole('button', { name: 'Relleno' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Línea del conector' }));
    await user.click(await screen.findByRole('button', { name: 'Recta' }));

    expect(store.getState().edges[0].data?.path).toBe('straight');
  });

  it('con nodos y conectores seleccionados muestra ambos grupos separados', () => {
    const a = sel(makeNode('shape', { x: 0, y: 0 }));
    const b = makeNode('shape', { x: 300, y: 0 });
    setup([a, b], [sel(makeEdge(a.id, b.id))]);
    expect(screen.getByRole('button', { name: 'Relleno' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Línea del conector' })).toBeTruthy();
    expect(screen.getByRole('separator')).toBeTruthy();
  });
});
