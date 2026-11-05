// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { ICONS } from '../model/board';
import { ToastProvider, TooltipProvider } from '@/ui';
import { BoardStoreProvider } from '../store/BoardStoreProvider';
import { createBoardStore } from '../store/boardStore';
import { Toolbar } from './Toolbar';

function setup() {
  const store = createBoardStore();
  render(
    <TooltipProvider>
      <ToastProvider>
        <ReactFlowProvider>
          <BoardStoreProvider store={store}>
            <Toolbar />
          </BoardStoreProvider>
        </ReactFlowProvider>
      </ToastProvider>
    </TooltipProvider>,
  );
  return { store, user: userEvent.setup() };
}

describe('Toolbar del board', () => {
  it('una herramienta simple la activa en el store y queda marcada; las demás no', async () => {
    const { store, user } = setup();
    const select = screen.getByRole('button', { name: 'Seleccionar' });
    expect(select.getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Nota adhesiva' }));

    expect(store.getState().tool).toBe('sticky');
    expect(screen.getByRole('button', { name: 'Nota adhesiva' }).getAttribute('aria-pressed')).toBe('true');
    expect(select.getAttribute('aria-pressed')).toBe('false');
  });

  it('elegir una forma del selector activa la herramienta de forma con esa forma y cierra el selector', async () => {
    const { store, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Formas' }));
    await user.click(await screen.findByRole('button', { name: 'Elipse' }));

    expect(store.getState().tool).toBe('shape');
    expect(store.getState().pendingShape).toBe('ellipse');
    expect(screen.queryByRole('button', { name: 'Elipse' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Formas' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('elegir un icono del selector activa la herramienta de icono con ese icono', async () => {
    const { store, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Iconos de arquitectura' }));
    const popover = await screen.findByRole('dialog', { name: 'Iconos' });
    await user.click(popover.querySelectorAll('button')[2]);

    expect(store.getState().tool).toBe('icon');
    expect(store.getState().pendingIcon).toBe(ICONS[2]);
  });

  it('cambiar de herramienta cancela el origen pendiente del conector', async () => {
    const { store, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Conector' }));
    store.getState().setConnectFrom('a');

    await user.click(screen.getByRole('button', { name: 'Seleccionar' }));

    expect(store.getState().tool).toBe('select');
    expect(store.getState().connectFrom).toBeNull();
  });
});
