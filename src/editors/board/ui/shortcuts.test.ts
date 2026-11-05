import { describe, expect, it } from 'vitest';
import { isShortcutBlocked, resolveShortcut, type KeyLike, type ShortcutAction } from './shortcuts';

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});
const mod = (key: string, extra: Partial<KeyLike> = {}) => k(key, { ctrlKey: true, ...extra });

describe('resolveShortcut', () => {
  it.each([
    ['v', { type: 'tool', tool: 'select' }],
    ['h', { type: 'tool', tool: 'hand' }],
    ['r', { type: 'tool', tool: 'shape', shape: 'rectangle' }],
    ['o', { type: 'tool', tool: 'shape', shape: 'ellipse' }],
    ['t', { type: 'tool', tool: 'text' }],
    ['s', { type: 'tool', tool: 'sticky' }],
    ['f', { type: 'tool', tool: 'frame' }],
    ['l', { type: 'tool', tool: 'connector' }],
    ['i', { type: 'tool', tool: 'icon' }],
  ] as [string, ShortcutAction][])('herramienta %s', (key, accion) => {
    expect(resolveShortcut(k(key))).toEqual(accion);
  });

  it('las letras con Bloq Mayús (key en mayúscula) también cuentan', () => {
    expect(resolveShortcut(k('V'))).toEqual({ type: 'tool', tool: 'select' });
  });

  it.each([
    [mod('z'), 'undo'],
    [mod('z', { shiftKey: true }), 'redo'],
    [mod('y'), 'redo'],
    [mod('y', { shiftKey: true }), 'redo'],
    [k('z', { metaKey: true }), 'undo'],
    [mod('c'), 'copy'],
    [mod('v'), 'paste'],
    [mod('x'), 'cut'],
    [mod('d'), 'duplicate'],
    [mod('a'), 'selectAll'],
    [mod('g'), 'group'],
    [mod('l'), 'toggleLock'],
    [mod('f'), 'search'],
    [mod("'"), 'toggleGrid'],
    [mod(']', { shiftKey: true }), 'bringToFront'],
    [mod('}', { shiftKey: true }), 'bringToFront'],
    [mod('x', { shiftKey: true, code: 'BracketRight' }), 'bringToFront'],
    [mod('[', { shiftKey: true }), 'sendToBack'],
    [mod('{', { shiftKey: true }), 'sendToBack'],
    [k('Delete'), 'delete'],
    [k('Backspace'), 'delete'],
    [k('Escape'), 'escape'],
    [k('1', { shiftKey: true, code: 'Digit1' }), 'fitView'],
    [k('!', { shiftKey: true }), 'fitView'],
    [k('2', { shiftKey: true, code: 'Digit2' }), 'zoomToSelection'],
    [k('@', { shiftKey: true }), 'zoomToSelection'],
  ] as [KeyLike, ShortcutAction['type']][])('%o → %s', (ev, tipo) => {
    expect(resolveShortcut(ev)).toEqual({ type: tipo });
  });

  it('flechas: 1 px, y 10 px con Shift', () => {
    expect(resolveShortcut(k('ArrowLeft'))).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    expect(resolveShortcut(k('ArrowDown'))).toEqual({ type: 'nudge', dx: 0, dy: 1 });
    expect(resolveShortcut(k('ArrowUp', { shiftKey: true }))).toEqual({ type: 'nudge', dx: 0, dy: -10 });
    expect(resolveShortcut(k('ArrowRight', { shiftKey: true }))).toEqual({ type: 'nudge', dx: 10, dy: 0 });
  });

  it('las letras de herramienta no se activan con Mod o Alt (AltGr = Ctrl+Alt)', () => {
    expect(resolveShortcut(mod('r'))).toBeNull();
    expect(resolveShortcut(k('r', { altKey: true }))).toBeNull();
    expect(resolveShortcut(mod(']', { shiftKey: true, altKey: true }))).toBeNull();
    expect(resolveShortcut(mod('c', { altKey: true }))).toBeNull();
  });

  it('teclas sin atajo, o con Shift sin atajo, no hacen nada', () => {
    expect(resolveShortcut(k('q'))).toBeNull();
    expect(resolveShortcut(k('v', { shiftKey: true }))).toBeNull();
    expect(resolveShortcut(k('Enter'))).toBeNull();
    expect(resolveShortcut(mod('g', { shiftKey: true }))).toBeNull();
    expect(resolveShortcut(mod('k'))).toBeNull();
  });
});

describe('isShortcutBlocked', () => {
  const ev = { isComposing: false, keyCode: 65 };
  it('bloquea inputs, textarea y select', () => {
    for (const tagName of ['INPUT', 'textarea', 'Select'])
      expect(isShortcutBlocked({ tagName }, ev)).toBe(true);
  });
  it('bloquea contentEditable y a sus descendientes', () => {
    expect(isShortcutBlocked({ tagName: 'DIV', isContentEditable: true }, ev)).toBe(true);
    expect(isShortcutBlocked({ tagName: 'SPAN', closest: () => ({}) }, ev)).toBe(true);
  });
  it('bloquea durante la composición IME', () => {
    expect(isShortcutBlocked({ tagName: 'DIV' }, { isComposing: true, keyCode: 65 })).toBe(true);
    expect(isShortcutBlocked({ tagName: 'DIV' }, { isComposing: false, keyCode: 229 })).toBe(true);
  });
  it('deja pasar el resto', () => {
    expect(isShortcutBlocked({ tagName: 'DIV', closest: () => null }, ev)).toBe(false);
    expect(isShortcutBlocked({ tagName: 'BUTTON' }, ev)).toBe(false);
    expect(isShortcutBlocked(null, ev)).toBe(false);
  });
});
