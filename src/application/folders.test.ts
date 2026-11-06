import { describe, expect, it } from 'vitest';
import type { Folder } from '@/domain/folder';
import { createFolderUseCases } from './folders';
import type { FolderRepo, Identity } from './ports';

function setup(signedIn = true) {
  const calls: unknown[] = [];
  const repo: FolderRepo = {
    subscribe: () => () => undefined,
    async create(f) {
      calls.push(['create', f]);
      return 'n1';
    },
    async rename(id, name) {
      calls.push(['rename', id, name]);
    },
    async move(id, parent) {
      calls.push(['move', id, parent]);
    },
    async remove(id) {
      calls.push(['remove', id]);
    },
  };
  const identity: Identity = {
    current: () => (signedIn ? { uid: 'u', name: 'U' } : null),
    onChange: () => () => undefined,
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  return { calls, uc: createFolderUseCases({ folders: repo, identity, now: () => 5 }) };
}

const f = (id: string, parentId: string | null): Folder => ({ id, ownerId: 'u', name: id, parentId, createdAt: 0, updatedAt: 0 });

describe('createFolderUseCases', () => {
  it('crea con el nombre normalizado, el dueño y la hora', async () => {
    const { uc, calls } = setup();
    await uc.createFolder('  Universidad ', 'p');
    expect(calls).toEqual([['create', { ownerId: 'u', name: 'Universidad', parentId: 'p', createdAt: 5, updatedAt: 5 }]]);
  });
  it('rechaza nombres vacíos y la falta de sesión', async () => {
    await expect(setup().uc.createFolder('   ', null)).rejects.toThrow(/vacío/);
    await expect(setup().uc.renameFolder('a', '')).rejects.toThrow(/vacío/);
    await expect(setup(false).uc.createFolder('x', null)).rejects.toThrow(/sesión/);
  });
  it('moveFolder rechaza ciclos y mueve en lo demás', async () => {
    const { uc, calls } = setup();
    const all = [f('a', null), f('b', 'a')];
    await expect(uc.moveFolder(all, 'a', 'b')).rejects.toThrow();
    expect(calls).toEqual([]);
    await uc.moveFolder(all, 'b', null);
    expect(calls).toEqual([['move', 'b', null]]);
  });
});
