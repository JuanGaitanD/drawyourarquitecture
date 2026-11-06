/** Carpeta de un usuario para organizar sus proyectos. `parentId: null` = primer nivel (Inicio). */
export interface Folder {
  id: string;
  ownerId: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export const MAX_FOLDER_NAME_LENGTH = 40;

/** Recorta y limita el nombre escrito por la persona. Devuelve `''` si no queda nada: quien llama lo rechaza. */
export function normalizeFolderName(raw: string | undefined | null): string {
  return (raw ?? '').trim().slice(0, MAX_FOLDER_NAME_LENGTH);
}

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

/**
 * Carpeta padre efectiva: una carpeta cuyo padre ya no existe cuelga de Inicio, para que nunca quede huérfana e
 * invisible.
 */
function effectiveParent(f: Folder, ids: ReadonlySet<string>): string | null {
  return f.parentId !== null && ids.has(f.parentId) ? f.parentId : null;
}

/** Carpetas que cuelgan directamente de `parentId` (`null` = Inicio), por nombre. */
export function childrenOf(folders: readonly Folder[], parentId: string | null): Folder[] {
  const ids = new Set(folders.map((f) => f.id));
  return folders.filter((f) => effectiveParent(f, ids) === parentId).sort(byName);
}

/** Migas: de la carpeta de primer nivel hasta `id`. `null` si `id` no existe o los datos tienen un ciclo. */
export function path(folders: readonly Folder[], id: string): Folder[] | null {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  for (let cur = byId.get(id); cur; cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) {
    if (out.some((x) => x.id === cur!.id)) return null;
    out.unshift(cur);
  }
  return out.length > 0 ? out : null;
}

/** Ids de todas las carpetas por debajo de `id` (sin incluirla). */
export function descendants(folders: readonly Folder[], id: string): Set<string> {
  const out = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const f of folders) {
      if (f.parentId === cur && !out.has(f.id) && f.id !== id) {
        out.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return out;
}

/** ¿Se puede mover `id` bajo `newParent` (`null` = Inicio)? No a sí misma ni a un descendiente (ciclo). */
export function canMove(folders: readonly Folder[], id: string, newParent: string | null): boolean {
  if (!folders.some((f) => f.id === id)) return false;
  if (newParent === null) return true;
  if (newParent === id || !folders.some((f) => f.id === newParent)) return false;
  return !descendants(folders, id).has(newParent);
}

/** Árbol aplanado en orden de lectura con su profundidad (para el selector de «Mover a…»), sin los ids de `exclude`. */
export function flatTree(
  folders: readonly Folder[],
  exclude: ReadonlySet<string> = new Set(),
): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childrenOf(folders, parentId)) {
      if (exclude.has(f.id)) continue;
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Ruta del panel de una carpeta (`null`/ausente = Inicio). */
export const panelPath = (folderId?: string | null): string => (folderId ? `/folder/${folderId}` : '/');

/** Solo valen como origen las rutas del propio panel (`/` o `/folder/:id`): `history.state` es input externo. */
const PANEL_ORIGIN = /^\/(folder\/[\w-]+)?$/;

/**
 * A dónde vuelve «Volver al panel»: al lugar del panel desde el que se abrió el proyecto (`origin`, de
 * `history.state`) o, sin él (enlace directo, otra pestaña), a la carpeta del proyecto (`folderId`: quien llama
 * solo la pasa si el proyecto es suyo) o a Inicio.
 */
export function backPath(origin: unknown, folderId?: string | null): string {
  return typeof origin === 'string' && PANEL_ORIGIN.test(origin) ? origin : panelPath(folderId);
}
