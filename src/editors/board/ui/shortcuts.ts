import type { ShapeKind } from '../model/board';
import type { Tool } from '../store/boardStore';

// Mapa de teclas → acción, sin React ni DOM real (se prueba en Node). `useShortcuts` lo conecta al editor.
// `Mod` = Ctrl o Cmd. Las teclas con Alt se ignoran: en teclados como el español, AltGr llega como Ctrl+Alt
// y se pisarían caracteres como «]».

export type ShortcutAction =
  | { type: 'tool'; tool: Tool; shape?: ShapeKind }
  | {
      type:
        | 'undo'
        | 'redo'
        | 'copy'
        | 'paste'
        | 'cut'
        | 'duplicate'
        | 'selectAll'
        | 'delete'
        | 'group'
        | 'toggleLock'
        | 'bringToFront'
        | 'sendToBack'
        | 'fitView'
        | 'zoomToSelection'
        | 'toggleGrid'
        | 'search'
        | 'escape';
    }
  | { type: 'nudge'; dx: number; dy: number };

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

const TOOL_KEYS: Record<string, ShortcutAction> = {
  v: { type: 'tool', tool: 'select' },
  h: { type: 'tool', tool: 'hand' },
  r: { type: 'tool', tool: 'shape', shape: 'rectangle' },
  o: { type: 'tool', tool: 'shape', shape: 'ellipse' },
  t: { type: 'tool', tool: 'text' },
  s: { type: 'tool', tool: 'sticky' },
  f: { type: 'tool', tool: 'frame' },
  l: { type: 'tool', tool: 'connector' },
  i: { type: 'tool', tool: 'icon' },
};

const MOD_KEYS: Record<string, ShortcutAction['type']> = {
  c: 'copy',
  v: 'paste',
  x: 'cut',
  d: 'duplicate',
  a: 'selectAll',
  g: 'group',
  l: 'toggleLock',
  f: 'search',
};

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function resolveShortcut(e: KeyLike): ShortcutAction | null {
  if (e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = e.ctrlKey || e.metaKey;

  if (mod) {
    if (key === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
    if (key === 'y') return { type: 'redo' };
    if (e.shiftKey) {
      // Mod+Shift+] / [ : según la distribución, la tecla llega como «]» o «}» (o por su código físico).
      if (key === ']' || key === '}' || e.code === 'BracketRight') return { type: 'bringToFront' };
      if (key === '[' || key === '{' || e.code === 'BracketLeft') return { type: 'sendToBack' };
      return null;
    }
    if (key === "'") return { type: 'toggleGrid' };
    const type = MOD_KEYS[key];
    return type ? ({ type } as ShortcutAction) : null;
  }

  if (key === 'Delete' || key === 'Backspace') return { type: 'delete' };
  if (key === 'Escape') return { type: 'escape' };
  const arrow = ARROWS[key];
  if (arrow) {
    const step = e.shiftKey ? 10 : 1;
    return { type: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
  }
  if (e.shiftKey) {
    // Shift+1 y Shift+2: en US la tecla llega como «!» y «@»; el código físico es fiable en cualquier layout.
    if (e.code === 'Digit1' || key === '1' || key === '!') return { type: 'fitView' };
    if (e.code === 'Digit2' || key === '2' || key === '@') return { type: 'zoomToSelection' };
    return null;
  }
  return TOOL_KEYS[key] ?? null;
}

export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

/** Inputs, textarea, select, contentEditable (o dentro de uno) y composición IME: el editor no atiende atajos. */
export function isShortcutBlocked(target: TargetLike | null, e: Pick<KeyLike, 'isComposing' | 'keyCode'>) {
  if (e.isComposing || e.keyCode === 229) return true;
  if (!target) return false;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return !!target.closest?.('[contenteditable=""],[contenteditable="true"]');
}
