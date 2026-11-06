import { describe, expect, it } from 'vitest';
import type { Project } from '@/domain/project';
import type { Folder } from '@/domain/folder';
import { countByTab, filterProjects, itemCounts, projectsIn } from './filter';
import { formatRelative } from './relativeTime';

const p = (id: string, type: Project['type'], title: string): Project => ({
  id,
  ownerId: 'u',
  type,
  title,
  isPublic: false,
  createdAt: 0,
  updatedAt: 0,
});
const list = [
  p('1', 'note', 'Diseño de la API'),
  p('2', 'board', 'Arquitectura de pagos'),
  p('3', 'board', 'Diseno legado'),
];

describe('filterProjects', () => {
  it('sin filtros devuelve todo y conserva el orden', () => {
    expect(filterProjects(list, 'all', '').map((x) => x.id)).toEqual(['1', '2', '3']);
  });
  it('filtra por tipo', () => {
    expect(filterProjects(list, 'board', '').map((x) => x.id)).toEqual(['2', '3']);
    expect(filterProjects(list, 'note', '').map((x) => x.id)).toEqual(['1']);
  });
  it('busca sin distinguir mayúsculas ni tildes, y combina con el tipo', () => {
    expect(filterProjects(list, 'all', 'DISENO').map((x) => x.id)).toEqual(['1', '3']);
    expect(filterProjects(list, 'board', 'diseño').map((x) => x.id)).toEqual(['3']);
    expect(filterProjects(list, 'all', '   ').length).toBe(3);
    expect(filterProjects(list, 'all', 'zzz')).toEqual([]);
  });
  it('cuenta por tab', () => {
    expect(countByTab(list)).toEqual({ all: 3, note: 1, board: 2 });
  });
});

describe('carpetas en el panel', () => {
  const fo = (id: string, parentId: string | null): Folder => ({ id, ownerId: 'u', name: id, parentId, createdAt: 0, updatedAt: 0 });
  const folders = [fo('uni', null), fo('s5', 'uni')];
  const inFolder = (id: string, folderId: string | null | undefined): Project => ({ ...p(id, 'note', id), folderId });
  const all = [inFolder('a', undefined), inFolder('b', null), inFolder('c', 'uni'), inFolder('d', 's5'), inFolder('e', 'borrada')];

  it('Inicio solo trae los proyectos sin carpeta (o con una carpeta que ya no existe)', () => {
    expect(projectsIn(all, null, folders).map((x) => x.id)).toEqual(['a', 'b', 'e']);
    expect(projectsIn(all, 'uni', folders).map((x) => x.id)).toEqual(['c']);
    expect(projectsIn(all, 's5', folders).map((x) => x.id)).toEqual(['d']);
  });
  it('cuenta proyectos y subcarpetas directos de cada carpeta', () => {
    expect(itemCounts(all, folders)).toEqual(new Map([['uni', 2], ['s5', 1]]));
  });
});

describe('formatRelative', () => {
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);
  const ago = (ms: number) => formatRelative(now - ms, now);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('ahora para menos de 45 s y para fechas futuras', () => {
    expect(ago(10_000)).toBe('ahora');
    expect(ago(-5 * MIN)).toBe('ahora');
  });
  it('minutos, horas y días', () => {
    expect(ago(5 * MIN)).toBe('hace 5 minutos');
    expect(ago(MIN)).toBe('hace 1 minuto');
    expect(ago(3 * HOUR)).toBe('hace 3 horas');
    expect(ago(DAY)).toBe('ayer');
    expect(ago(3 * DAY)).toBe('hace 3 días');
  });
  it('semanas, meses y años', () => {
    expect(ago(14 * DAY)).toBe('hace 2 semanas');
    expect(ago(60 * DAY)).toBe('hace 2 meses');
    expect(ago(400 * DAY)).toBe('el año pasado');
  });
  it('valor no finito', () => {
    expect(formatRelative(Number.NaN, now)).toBe('');
  });
});
