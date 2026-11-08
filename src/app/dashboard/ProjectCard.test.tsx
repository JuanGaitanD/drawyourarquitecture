// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder } from '@/domain/folder';
import type { Project } from '@/domain/project';
import { ToastProvider, TooltipProvider } from '@/ui';
import { ProjectCard } from './ProjectCard';

// Los casos de uso y el repo salen de `services` (la composición con Firebase): aquí se sustituyen por dobles en
// memoria de los puertos. No se simula el SDK de Firebase.
const svc = vi.hoisted(() => ({
  update: vi.fn<(id: string, patch: Record<string, unknown>) => Promise<void>>(),
  setFolder: vi.fn<(id: string, folderId: string | null) => Promise<void>>(),
  duplicateProject: vi.fn<(id: string) => Promise<string>>(),
  deleteProject: vi.fn<(id: string) => Promise<void>>(),
}));
vi.mock('../services', () => ({
  projectRepo: { update: svc.update, setFolder: svc.setFolder },
  duplicateProject: svc.duplicateProject,
  deleteProject: svc.deleteProject,
}));

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  ownerId: 'u1',
  type: 'board',
  title: 'Mi diagrama',
  isPublic: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

function setup(p: Project = project(), folders?: Folder[]) {
  const user = userEvent.setup();
  render(
    <Router hook={memoryLocation({ path: '/' }).hook}>
      <TooltipProvider>
        <ToastProvider>
          <ul>
            <ProjectCard project={p} now={2} folders={folders} />
          </ul>
        </ToastProvider>
      </TooltipProvider>
    </Router>,
  );
  const openMenu = () => user.click(screen.getByRole('button', { name: `Opciones de «${p.title}»` }));
  return { user, openMenu };
}

beforeEach(() => {
  svc.update.mockReset().mockResolvedValue();
  svc.setFolder.mockReset().mockResolvedValue();
  svc.duplicateProject.mockReset().mockResolvedValue('copia');
  svc.deleteProject.mockReset().mockResolvedValue();
});

describe('ProjectCard · menú de la tarjeta', () => {
  it('la tarjeta enlaza al editor de su tipo', () => {
    setup(project({ type: 'note', id: 'n9', title: 'Apuntes' }));
    expect(screen.getByRole('link', { name: /Apuntes/ }).getAttribute('href')).toBe('/note/n9');
  });

  it('Renombrar: Enter guarda el título nuevo normalizado', async () => {
    const { user, openMenu } = setup();
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Renombrar' }));
    const input = await screen.findByRole('textbox', { name: 'Nuevo nombre de «Mi diagrama»' });
    await user.clear(input);
    await user.type(input, '  Otro nombre  {Enter}');

    expect(svc.update).toHaveBeenCalledExactlyOnceWith('p1', { title: 'Otro nombre' });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('Renombrar: Escape cancela y vacío o igual no escriben nada', async () => {
    const { user, openMenu } = setup();
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Renombrar' }));
    const input = await screen.findByRole('textbox');
    await user.type(input, 'x{Escape}');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(svc.update).not.toHaveBeenCalled();

    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Renombrar' }));
    await user.keyboard('{Enter}'); // el campo trae el título actual seleccionado y sin cambios
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('Duplicar: llama al caso de uso y avisa; si falla, avisa con «Reintentar» que lo repite', async () => {
    const { user, openMenu } = setup();
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicar' }));
    expect(await screen.findByText('Copia creada')).toBeTruthy();
    expect(svc.duplicateProject).toHaveBeenCalledExactlyOnceWith('p1');

    svc.duplicateProject.mockRejectedValueOnce(new Error('sin red'));
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicar' }));
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(svc.duplicateProject).toHaveBeenCalledTimes(3);
  });

  it('Compartir con enlace público activa isPublic y avisa', async () => {
    const { user, openMenu } = setup();
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Compartir con enlace público' }));
    expect(svc.update).toHaveBeenCalledExactlyOnceWith('p1', { isPublic: true });
    expect(await screen.findByText('Enlace público activado')).toBeTruthy();
  });

  it('un proyecto público muestra «Público» y su menú permite dejar de compartir', async () => {
    const { user, openMenu } = setup(project({ isPublic: true }));
    expect(screen.getByText('Público')).toBeTruthy();
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Copiar enlace' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: 'Dejar de compartir' }));
    expect(svc.update).toHaveBeenCalledExactlyOnceWith('p1', { isPublic: false });
  });

  it('Borrar pide confirmación: Cancelar no borra y Borrar llama al caso de uso', async () => {
    const { user, openMenu } = setup();
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Borrar…' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Borrar «Mi diagrama»?' });
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(svc.deleteProject).not.toHaveBeenCalled();
    expect(dialog.isConnected).toBe(false);

    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Borrar…' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Borrar' }));
    expect(svc.deleteProject).toHaveBeenCalledExactlyOnceWith('p1');
    expect(await screen.findByText('Proyecto borrado')).toBeTruthy();
  });

  it('si borrar falla, el diálogo sigue abierto y avisa', async () => {
    svc.deleteProject.mockRejectedValueOnce(new Error('sin red'));
    const { user, openMenu } = setup();
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Borrar…' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Borrar' }));

    expect(await screen.findByText('No se pudo borrar')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('el aviso de borrado de un proyecto público menciona el enlace público', async () => {
    const { user, openMenu } = setup(project({ isPublic: true }));
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Borrar…' }));
    expect(await screen.findByText(/su enlace público dejará de funcionar/)).toBeTruthy();
  });
});

describe('ProjectCard · mover a carpeta', () => {
  const fo = (id: string, name: string, parentId: string | null = null): Folder => ({
    id,
    ownerId: 'u1',
    name,
    parentId,
    createdAt: 1,
    updatedAt: 1,
  });
  const folders = [fo('uni', 'Universidad'), fo('s5', 'Semestre 5', 'uni')];

  it('sin carpetas disponibles el menú no ofrece «Mover a carpeta…»', async () => {
    const { openMenu } = setup();
    await openMenu();
    await screen.findByRole('menuitem', { name: 'Renombrar' });
    expect(screen.queryByRole('menuitem', { name: 'Mover a carpeta…' })).toBeNull();
  });

  it('el diálogo muestra el árbol con «Sin carpeta (Inicio)» y Mover llama a setFolder', async () => {
    const { user, openMenu } = setup(project(), folders);
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Mover a carpeta…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mover «Mi diagrama»' });
    expect((screen.getByRole('radio', { name: 'Sin carpeta (Inicio)' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Semestre 5' }));
    await user.click(screen.getByRole('button', { name: 'Mover' }));

    expect(svc.setFolder).toHaveBeenCalledExactlyOnceWith('p1', 's5');
    expect(await screen.findByText('Proyecto movido')).toBeTruthy();
    await waitFor(() => expect(dialog.isConnected).toBe(false));
  });

  it('desde una carpeta, «Sin carpeta (Inicio)» lo devuelve a la raíz con null', async () => {
    const { user, openMenu } = setup(project({ folderId: 'uni' }), folders);
    await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: 'Mover a carpeta…' }));
    await screen.findByRole('dialog');
    expect((screen.getByRole('radio', { name: 'Universidad' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Sin carpeta (Inicio)' }));
    await user.click(screen.getByRole('button', { name: 'Mover' }));
    expect(svc.setFolder).toHaveBeenCalledExactlyOnceWith('p1', null);
  });

  it('muestra su carpeta en pequeño cuando recibe la etiqueta', () => {
    render(
      <Router hook={memoryLocation({ path: '/' }).hook}>
        <TooltipProvider>
          <ToastProvider>
            <ul>
              <ProjectCard project={project()} now={2} folderLabel="Universidad / Semestre 5" />
            </ul>
          </ToastProvider>
        </TooltipProvider>
      </Router>,
    );
    expect(screen.getByText('Universidad / Semestre 5')).toBeTruthy();
  });
});
