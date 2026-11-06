// @vitest-environment jsdom
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder } from '@/domain/folder';
import type { Project } from '@/domain/project';
import { ToastProvider, TooltipProvider } from '@/ui';
import { Breadcrumbs } from './Breadcrumbs';
import { FolderChips } from './FolderChips';
import { ProjectCard } from './ProjectCard';

// Como ProjectCard.test: los casos de uso salen de `services` y se sustituyen por dobles; no se simula Firebase.
const svc = vi.hoisted(() => ({
  setFolder: vi.fn<(id: string, folderId: string | null) => Promise<void>>(),
  moveFolder: vi.fn<(all: readonly Folder[], id: string, parent: string | null) => Promise<void>>(),
}));
vi.mock('../services', () => ({
  projectRepo: { update: vi.fn(), setFolder: svc.setFolder },
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveFolder: svc.moveFolder,
  duplicateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

const f = (id: string, name: string, parentId: string | null = null): Folder => ({
  id,
  ownerId: 'u',
  name,
  parentId,
  createdAt: 1,
  updatedAt: 1,
});
// Universidad ─ Semestre 5 ;  Trabajo
const folders = [f('uni', 'Universidad'), f('s5', 'Semestre 5', 'uni'), f('job', 'Trabajo')];
const project = (id: string, title: string, folderId: string | null = null): Project => ({
  id,
  ownerId: 'u',
  type: 'note',
  title,
  isPublic: false,
  createdAt: 1,
  updatedAt: 1,
  folderId,
});

/** Un panel mínimo: migas de Universidad / Semestre 5, chips del primer nivel y dos tarjetas. */
function setup() {
  render(
    <Router hook={memoryLocation({ path: '/folder/s5' }).hook}>
      <TooltipProvider>
        <ToastProvider>
          <Breadcrumbs trail={[folders[0]!, folders[1]!]} folders={folders} />
          <FolderChips parentId={null} folders={folders} counts={new Map()} />
          <ul>
            <ProjectCard project={project('p1', 'Apuntes')} now={2} folders={folders} />
            <ProjectCard project={project('p2', 'Redes', 'uni')} now={2} folders={folders} />
          </ul>
        </ToastProvider>
      </TooltipProvider>
    </Router>,
  );
}

const dataTransfer = () => ({ setData: vi.fn(), clearData: vi.fn(), effectAllowed: '', dropEffect: '' });
const chips = () => within(screen.getByRole('region', { name: 'Carpetas' }));
const chipLink = (name: RegExp) => chips().getByRole('link', { name });
const chipOf = (name: RegExp) => chipLink(name).closest('li')!;
const crumbOf = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Ruta de la carpeta' })).getByText(name).closest('li')!;

/** Arrastra `source` y lo suelta sobre `target`. Devuelve si el destino aceptó el arrastre (dragover cancelado). */
function dragTo(source: HTMLElement, target: HTMLElement) {
  const dt = dataTransfer();
  fireEvent.dragStart(source, { dataTransfer: dt });
  const over = createEvent.dragOver(target, { dataTransfer: dt });
  fireEvent(target, over);
  const accepted = over.defaultPrevented;
  fireEvent.drop(target, { dataTransfer: dt });
  fireEvent.dragEnd(source, { dataTransfer: dt });
  return accepted;
}

beforeEach(() => {
  svc.setFolder.mockReset().mockResolvedValue();
  svc.moveFolder.mockReset().mockResolvedValue();
});

describe('arrastrar y soltar', () => {
  it('una tarjeta soltada sobre un chip llama a mover con su id y la carpeta, y avisa', async () => {
    setup();
    const card = screen.getByRole('link', { name: /Apuntes/ });
    expect(dragTo(card, chipOf(/^Trabajo/))).toBe(true);
    expect(svc.setFolder).toHaveBeenCalledExactlyOnceWith('p1', 'job');
    expect(await screen.findByText('Movido a Trabajo')).toBeTruthy();
  });

  it('resalta el destino válido mientras se pasa por encima y lo quita al salir', () => {
    setup();
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByRole('link', { name: /Apuntes/ }), { dataTransfer: dt });
    const chip = chipOf(/^Trabajo/);
    fireEvent.dragOver(chip, { dataTransfer: dt });
    expect(chip.getAttribute('data-drop')).toBe('over');
    fireEvent.dragLeave(chip, { dataTransfer: dt, relatedTarget: document.body });
    expect(chip.getAttribute('data-drop')).toBeNull();
  });

  it('una tarjeta soltada sobre una miga (también «Inicio») la mueve allí', () => {
    setup();
    dragTo(screen.getByRole('link', { name: /Apuntes/ }), crumbOf('Universidad'));
    expect(svc.setFolder).toHaveBeenLastCalledWith('p1', 'uni');
    dragTo(screen.getByRole('link', { name: /Redes/ }), crumbOf('Inicio'));
    expect(svc.setFolder).toHaveBeenLastCalledWith('p2', null);
  });

  it('no acepta soltar un proyecto en la carpeta donde ya está', () => {
    setup();
    expect(dragTo(screen.getByRole('link', { name: /Redes/ }), chipOf(/^Universidad/))).toBe(false);
    expect(dragTo(screen.getByRole('link', { name: /Apuntes/ }), crumbOf('Inicio'))).toBe(false);
    expect(svc.setFolder).not.toHaveBeenCalled();
  });

  it('una carpeta soltada sobre otro chip o una miga se mueve dentro', async () => {
    setup();
    dragTo(chipLink(/^Trabajo/), crumbOf('Semestre 5'));
    await waitFor(() => expect(svc.moveFolder).toHaveBeenCalledWith(folders, 'job', 's5'));
  });

  it('rechaza una carpeta sobre sí misma, sobre un descendiente o sobre su padre actual', () => {
    setup();
    const uni = chipLink(/^Universidad/);
    expect(dragTo(uni, chipOf(/^Universidad/))).toBe(false); // ella misma
    expect(dragTo(uni, crumbOf('Semestre 5'))).toBe(false); // un descendiente
    expect(dragTo(uni, crumbOf('Inicio'))).toBe(false); // su padre actual (Inicio)
    expect(svc.moveFolder).not.toHaveBeenCalled();
    expect(chipOf(/^Universidad/).getAttribute('data-drop')).toBeNull();
  });

  it('si falla muestra un error con «Reintentar»', async () => {
    svc.setFolder.mockRejectedValueOnce(new Error('sin red'));
    setup();
    dragTo(screen.getByRole('link', { name: /Apuntes/ }), chipOf(/^Trabajo/));
    expect(await screen.findByText('No se pudo mover')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(svc.setFolder).toHaveBeenCalledTimes(2));
  });

  it('solo el enlace se arrastra: el botón de menú no', () => {
    setup();
    expect(screen.getByRole('link', { name: /Apuntes/ }).getAttribute('draggable')).toBe('true');
    expect(screen.getByRole('button', { name: 'Opciones de «Apuntes»' }).closest('[draggable="true"]')).toBeNull();
    expect(
      chips().getByRole('button', { name: 'Opciones de la carpeta «Trabajo»' }).closest('[draggable="true"]'),
    ).toBeNull();
  });
});
