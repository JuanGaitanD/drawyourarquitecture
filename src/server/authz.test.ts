import { describe, expect, it } from 'vitest';
import { canRead, canWrite } from './authz';

const base = { ownerId: 'dueño' };

describe('canRead / canWrite', () => {
  it('el dueño lee y escribe', () => {
    expect(canRead(base, 'dueño')).toBe(true);
    expect(canWrite(base, 'dueño')).toBe(true);
  });

  it('un ajeno no accede a un proyecto privado', () => {
    expect(canRead(base, 'x')).toBe(false);
    expect(canWrite(base, 'x')).toBe(false);
    expect(canRead({ ...base, isPublic: false }, 'x')).toBe(false);
  });

  it('público: lectura para cualquiera, escritura no', () => {
    const p = { ...base, isPublic: true };
    expect(canRead(p, 'x')).toBe(true);
    expect(canWrite(p, 'x')).toBe(false);
  });

  it('miembros: viewer lee; editor lee y escribe; un rol desconocido no cuenta', () => {
    const p = { ...base, members: { v: 'viewer', e: 'editor', raro: 'admin' } };
    expect([canRead(p, 'v'), canWrite(p, 'v')]).toEqual([true, false]);
    expect([canRead(p, 'e'), canWrite(p, 'e')]).toEqual([true, true]);
    expect([canRead(p, 'raro'), canWrite(p, 'raro')]).toEqual([false, false]);
    expect(canRead(p, 'otro')).toBe(false);
  });

  it('claves heredadas del prototipo no dan acceso', () => {
    const p = { ...base, members: {} };
    expect(canRead(p, '__proto__')).toBe(false);
    expect(canWrite(p, 'constructor')).toBe(false);
    expect(canRead({ ...base, members: 'editor' }, 'x')).toBe(false);
  });
});
