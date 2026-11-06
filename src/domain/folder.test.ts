import { describe, expect, it } from 'vitest';
import {
  canMove,
  childrenOf,
  descendants,
  flatTree,
  MAX_FOLDER_NAME_LENGTH,
  normalizeFolderName,
  path,
  type Folder,
} from './folder';

const f = (id: string, parentId: string | null, name = id): Folder => ({
  id,
  ownerId: 'u',
  name,
  parentId,
  createdAt: 0,
  updatedAt: 0,
});
// uni ─ s5 ─ redes ;  uni ─ s6 ;  trabajo
const folders = [f('uni', null, 'Universidad'), f('s5', 'uni', 'Semestre 5'), f('redes', 's5', 'Redes'), f('s6', 'uni', 'Semestre 6'), f('job', null, 'Trabajo')];

describe('normalizeFolderName', () => {
  it('recorta, limita a 80 y devuelve vacío si no queda nada', () => {
    expect(normalizeFolderName('  Universidad ')).toBe('Universidad');
    expect(normalizeFolderName('x'.repeat(200))).toHaveLength(MAX_FOLDER_NAME_LENGTH);
    expect(normalizeFolderName('   ')).toBe('');
    expect(normalizeFolderName(undefined)).toBe('');
  });
});

describe('childrenOf', () => {
  it('lista los hijos directos por nombre; null es Inicio', () => {
    expect(childrenOf(folders, null).map((x) => x.id)).toEqual(['job', 'uni']);
    expect(childrenOf(folders, 'uni').map((x) => x.id)).toEqual(['s5', 's6']);
    expect(childrenOf(folders, 'redes')).toEqual([]);
  });
  it('una carpeta con padre inexistente cuelga de Inicio', () => {
    expect(childrenOf([f('a', 'borrada')], null).map((x) => x.id)).toEqual(['a']);
  });
});

describe('path', () => {
  it('va de la carpeta de primer nivel a la pedida', () => {
    expect(path(folders, 'redes')!.map((x) => x.name)).toEqual(['Universidad', 'Semestre 5', 'Redes']);
    expect(path(folders, 'job')!.map((x) => x.id)).toEqual(['job']);
  });
  it('null si no existe o si los datos tienen un ciclo', () => {
    expect(path(folders, 'nada')).toBeNull();
    expect(path([f('a', 'b'), f('b', 'a')], 'a')).toBeNull();
  });
});

describe('descendants y canMove', () => {
  it('descendants incluye hijos y nietos, no la propia carpeta', () => {
    expect([...descendants(folders, 'uni')].sort()).toEqual(['redes', 's5', 's6']);
    expect(descendants(folders, 'redes').size).toBe(0);
  });
  it('impide mover a sí misma, a un descendiente o a un destino inexistente', () => {
    expect(canMove(folders, 'uni', 'uni')).toBe(false);
    expect(canMove(folders, 'uni', 'redes')).toBe(false);
    expect(canMove(folders, 'uni', 'nada')).toBe(false);
    expect(canMove(folders, 'nada', null)).toBe(false);
  });
  it('permite mover a Inicio, a una rama ajena o al mismo padre', () => {
    expect(canMove(folders, 'redes', null)).toBe(true);
    expect(canMove(folders, 's5', 'job')).toBe(true);
    expect(canMove(folders, 's5', 'uni')).toBe(true);
  });
});

describe('flatTree', () => {
  it('aplana con profundidad y puede excluir una rama', () => {
    expect(flatTree(folders).map((x) => `${x.depth}:${x.folder.id}`)).toEqual([
      '0:job',
      '0:uni',
      '1:s5',
      '2:redes',
      '1:s6',
    ]);
    expect(flatTree(folders, new Set(['s5', 'redes'])).map((x) => x.folder.id)).toEqual(['job', 'uni', 's6']);
  });
});
