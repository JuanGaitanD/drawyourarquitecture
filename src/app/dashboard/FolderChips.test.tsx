// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder } from '@/domain/folder';
import { ToastProvider, TooltipProvider } from '@/ui';
import { FolderChips } from './FolderChips';

// Como ProjectCard.test: los casos de uso salen de `services` y se sustituyen por dobles; no se simula Firebase.
const svc = vi.hoisted(() => ({
  createFolder: vi.fn<(name: string, parentId: string | null) => Promise<string>>(),
  renameFolder: vi.fn<(id: string, name: string) => Promise<void>>(),
  moveFolder: vi.fn<(all: readonly Folder[], id: string, parent: string | null) => Promise<void>>(),
  deleteFolder: vi.fn<(id: string) => Promise<void>>(),
}));
vi.mock('../services', () => svc);

const f = (id: string, name: string, parentId: string | null = null): Folder => ({
  id,
  ownerId: 'u',
  name,
  parentId,
  createdAt: 1,
  updatedAt: 1,
});
// Universidad (2 elementos) ─ Semestre 5 (vacía) ;  Trabajo (vacía)
const folders = [f('uni', 'Universidad'), f('s5', 'Semestre 5', 'uni'), f('job', 'Trabajo')];
const counts = new Map([['uni', 2]]);

function setup(parentId: string | null = null) {
  const user = userEvent.setup();
  render(
    <Router hook={memoryLocation({ path: '/' }).hook}>
      <TooltipProvider>
        <ToastProvider>
          <FolderChips parentId={parentId} folders={folders} counts={counts} />
        </ToastProvider>
      </TooltipProvider>
    </Router>,
  );
  const openMenu = (name: string) =>
    user.click(screen.getByRole('button', { name: `Opciones de la carpeta «${name}»` }));
  return { user, openMenu };
}

beforeEach(() => {
  svc.createFolder.mockReset().mockResolvedValue('nueva');
  svc.renameFolder.mockReset().mockResolvedValue();
  svc.moveFolder.mockReset().mockResolvedValue();
  svc.deleteFolder.mockReset().mockResolvedValue();
});

describe('FolderChips', () => {
  it('muestra solo las carpetas del nivel, con enlace y número de elementos', () => {
    setup(null);
    expect(screen.getByRole('link', { name: /Universidad, 2 elementos/ }).getAttribute('href')).toBe('/folder/uni');
    expect(screen.getByRole('link', { name: /Trabajo, 0 elementos/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Semestre 5/ })).toBeNull();
  });

  it('dentro de una carpeta lista sus subcarpetas', () => {
    setup('uni');
    expect(screen.getByRole('link', { name: /Semestre 5/ }).getAttribute('href')).toBe('/folder/s5');
    expect(screen.queryByRole('link', { name: /Universidad/ })).toBeNull();
  });

  it('«Nueva carpeta» crea con el nombre normalizado bajo la carpeta actual; vacío no deja crear', async () => {
    const { user } = setup('uni');
    await user.click(screen.getByRole('button', { name: 'Nueva carpeta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva carpeta' });
    const create = within(dialog).getByRole('button', { name: 'Crear' });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre de la carpeta' }), '  Redes {Enter}');
    expect(svc.createFolder).toHaveBeenCalledExactlyOnceWith('Redes', 'uni');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Carpeta creada')).toBeTruthy();
  });

  it('Borrar está deshabilitado con contenido y lo explica; en una vacía borra', async () => {
    const { user, openMenu } = setup(null);
    await openMenu('Universidad');
    const blocked = await screen.findByRole('menuitem', { name: 'Borrar' });
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Mueve o borra su contenido primero')).toBeTruthy();
    await user.keyboard('{Escape}');

    await openMenu('Trabajo');
    await user.click(await screen.findByRole('menuitem', { name: 'Borrar' }));
    expect(svc.deleteFolder).toHaveBeenCalledExactlyOnceWith('job');
    expect(await screen.findByText('Carpeta borrada')).toBeTruthy();
  });

  it('Renombrar guarda el nombre nuevo; el mismo nombre no escribe', async () => {
    const { user, openMenu } = setup(null);
    await openMenu('Trabajo');
    await user.click(await screen.findByRole('menuitem', { name: 'Renombrar' }));
    const input = await screen.findByRole('textbox', { name: 'Nombre de la carpeta' });
    await user.clear(input);
    await user.type(input, 'Empleo{Enter}');
    expect(svc.renameFolder).toHaveBeenCalledExactlyOnceWith('job', 'Empleo');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await openMenu('Trabajo');
    await user.click(await screen.findByRole('menuitem', { name: 'Renombrar' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(svc.renameFolder).toHaveBeenCalledTimes(1);
  });
});

describe('Mover una carpeta', () => {
  it('el árbol no ofrece la propia carpeta ni sus descendientes', async () => {
    const { user, openMenu } = setup(null);
    await openMenu('Universidad');
    await user.click(await screen.findByRole('menuitem', { name: 'Mover a…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mover «Universidad»' });
    expect(within(dialog).getByRole('radio', { name: 'Sin carpeta (Inicio)' })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Trabajo' })).toBeTruthy();
    expect(within(dialog).queryByRole('radio', { name: 'Universidad' })).toBeNull();
    expect(within(dialog).queryByRole('radio', { name: 'Semestre 5' })).toBeNull();
  });

  it('elegir destino y pulsar Mover llama al caso de uso; la misma ubicación no deja mover', async () => {
    const { user, openMenu } = setup('uni');
    await openMenu('Semestre 5');
    await user.click(await screen.findByRole('menuitem', { name: 'Mover a…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mover «Semestre 5»' });
    const move = within(dialog).getByRole('button', { name: 'Mover' }) as HTMLButtonElement;
    expect(move.disabled).toBe(true); // ya está bajo «Universidad»
    await user.click(within(dialog).getByRole('radio', { name: 'Trabajo' }));
    expect(move.disabled).toBe(false);
    await user.click(move);
    expect(svc.moveFolder).toHaveBeenCalledExactlyOnceWith(folders, 's5', 'job');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('si mover falla, el diálogo sigue abierto y avisa', async () => {
    svc.moveFolder.mockRejectedValueOnce(new Error('sin red'));
    const { user, openMenu } = setup(null);
    await openMenu('Trabajo');
    await user.click(await screen.findByRole('menuitem', { name: 'Mover a…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Universidad' }));
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }));
    expect(await screen.findByText(/No se pudo mover/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
