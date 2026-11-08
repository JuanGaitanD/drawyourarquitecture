// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, TooltipProvider } from '@/ui';
import { FolderNewButtons } from './FolderNewButtons';

const svc = vi.hoisted(() => ({
  createProject: vi.fn<(type: string, title?: string, folderId?: string | null) => Promise<string>>(),
}));
vi.mock('../services', () => svc);

function setup() {
  const loc = memoryLocation({ path: '/folder/f1', record: true });
  render(
    <Router hook={loc.hook}>
      <TooltipProvider>
        <ToastProvider>
          <FolderNewButtons folderId="f1" folderName="Semestre 5" />
        </ToastProvider>
      </TooltipProvider>
    </Router>,
  );
  return { user: userEvent.setup(), loc };
}

beforeEach(() => svc.createProject.mockReset().mockResolvedValue('p9'));

describe('FolderNewButtons · crear dentro de una carpeta', () => {
  it('son dos botones con texto «Nota» y «Diagrama», sin «+», y nombre accesible descriptivo', () => {
    setup();
    const note = screen.getByRole('button', { name: 'Nueva nota en Semestre 5' });
    const board = screen.getByRole('button', { name: 'Nuevo diagrama en Semestre 5' });
    expect(note.textContent).toBe('Nota');
    expect(board.textContent).toBe('Diagrama');
  });

  it('«Nota» crea con el folderId de la carpeta y abre el editor', async () => {
    const { user, loc } = setup();
    await user.click(screen.getByRole('button', { name: 'Nueva nota en Semestre 5' }));
    expect(svc.createProject).toHaveBeenCalledExactlyOnceWith('note', undefined, 'f1');
    await waitFor(() => expect(loc.history?.at(-1)).toBe('/note/p9'));
  });

  it('«Diagrama» crea un board en la carpeta; si falla, avisa con «Reintentar»', async () => {
    svc.createProject.mockRejectedValueOnce(new Error('sin red'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Nuevo diagrama en Semestre 5' }));
    expect(svc.createProject).toHaveBeenCalledWith('board', undefined, 'f1');
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(svc.createProject).toHaveBeenCalledTimes(2);
  });
});
