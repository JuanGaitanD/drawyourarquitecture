// Librería de Excalidraw en localStorage (plan · B): es del navegador, no viaja con la nota.
const KEY = 'dya:note-library';

export function readLibrary(): unknown[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function writeLibrary(items: readonly unknown[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* cuota llena o sin almacenamiento: la librería vale solo para esta sesión */
  }
}
