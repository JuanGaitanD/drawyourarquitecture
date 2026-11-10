import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { MAX_FOLDER_NAME_LENGTH, canMove, childrenOf, flatTree, path, type Folder } from '../domain/folder';
import { ID_RE, ToolError, denied } from './authz';
import type { ProjectDoc, ToolContext, ToolResult } from './tools';

// Carpetas por MCP con el modelo del panel (`domain/folder.ts`, AGENTS.md › Carpetas). Las reglas dan cada carpeta
// solo a su dueño pero no comprueban que un destino (`folderId`, `parentId`) sea una carpeta propia existente, ni
// ciclos, ni que esté vacía al borrar: eso lo hace aquí el servidor, como el panel en el cliente. Igual que allí,
// leer y después escribir no es atómico (límite conocido de HANDOFF.md).

const now = (ctx: ToolContext) => (ctx.now ?? Date.now)();
const NO_FOLDER = 'La carpeta no existe.';

/** Carpetas propias (las reglas solo dejan listar las suyas; sin orderBy: no hace falta índice compuesto). */
export async function loadFolders(ctx: ToolContext): Promise<Folder[]> {
  const snap = await getDocs(query(collection(ctx.db, 'folders'), where('ownerId', '==', ctx.uid)));
  return snap.docs.map((d) => {
    const f = d.data();
    return { ...(f as Folder), id: d.id, parentId: typeof f.parentId === 'string' ? f.parentId : null };
  });
}

/** Destino válido: `null` (Inicio) o una carpeta propia existente. Ajena e inexistente dan el mismo 404. */
export function folderTarget(folders: readonly Folder[], id: string | null): string | null {
  if (id !== null && !folders.some((f) => f.id === id)) throw new ToolError(404, NO_FOLDER);
  return id;
}

/** Ruta legible: «WigiLabs / Aplicativo PMO» (`null` = Inicio). */
export function folderLabel(folders: readonly Folder[], id: string | null): string {
  return (
    (id &&
      path(folders, id)
        ?.map((f) => f.name)
        .join(' / ')) ||
    'Inicio'
  );
}

/** Árbol en orden de lectura con su profundidad. */
export function folderTree(folders: readonly Folder[]): { id: string; name: string; depth: number }[] {
  return flatTree(folders).map(({ folder, depth }) => ({ id: folder.id, name: folder.name, depth }));
}

function folderOf(folders: readonly Folder[], id: string): Folder {
  const f = folders.find((x) => x.id === id);
  if (!f) throw new ToolError(404, NO_FOLDER);
  return f;
}

/** Nombre recortado de 1 a 40. A diferencia del panel no se recorta en silencio: el agente debe saberlo. */
function folderName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_FOLDER_NAME_LENGTH)
    throw new ToolError(
      400,
      `El nombre de la carpeta debe tener de 1 a ${MAX_FOLDER_NAME_LENGTH} caracteres.`,
    );
  return name;
}

const FOLDER_DENIED = 'Sin permiso: tu cuenta no puede crear carpetas o la carpeta no es tuya.';

export const createFolder = denied(
  async (ctx: ToolContext, args: { name: string; parentId?: string }): Promise<ToolResult> => {
    const name = folderName(args.name);
    const folders = await loadFolders(ctx);
    const parentId = folderTarget(folders, args.parentId ?? null);
    const t = now(ctx);
    const ref = doc(collection(ctx.db, 'folders'));
    await setDoc(ref, { ownerId: ctx.uid, name, parentId, createdAt: t, updatedAt: t });
    return {
      text: `Carpeta creada: ${ref.id} («${name}», en ${folderLabel(folders, parentId)}).`,
      data: { folderId: ref.id, name, parentId },
    };
  },
  FOLDER_DENIED,
);

/** Renombra y/o mueve. Mover escribe solo `parentId`: un nombre anterior de más de 40 se conserva (como la regla). */
export const updateFolder = denied(
  async (
    ctx: ToolContext,
    args: { id: string; name?: string; parentId?: string | null },
  ): Promise<ToolResult> => {
    if (args.name === undefined && args.parentId === undefined)
      throw new ToolError(400, 'Indica `name`, `parentId` o ambos.');
    const name = args.name === undefined ? undefined : folderName(args.name);
    const folders = await loadFolders(ctx);
    const folder = folderOf(folders, args.id);
    const patch: { name?: string; parentId?: string | null; updatedAt: number } = { updatedAt: now(ctx) };
    if (name !== undefined) patch.name = name;
    if (args.parentId !== undefined) {
      const parentId = folderTarget(folders, args.parentId);
      if (!canMove(folders, folder.id, parentId))
        throw new ToolError(400, 'Una carpeta no puede ir dentro de sí misma ni de una de sus subcarpetas.');
      patch.parentId = parentId;
    }
    await updateDoc(doc(ctx.db, 'folders', folder.id), patch);
    const parentId = patch.parentId === undefined ? folder.parentId : patch.parentId;
    return {
      text: `Carpeta actualizada: ${folder.id} («${name ?? folder.name}», en ${folderLabel(folders, parentId)}).`,
      data: { folderId: folder.id, name: name ?? folder.name, parentId },
    };
  },
  FOLDER_DENIED,
);

/** Borra solo una carpeta vacía: sin subcarpetas ni proyectos propios dentro (lo que el panel llama «vacía»). */
export const deleteFolder = denied(async (ctx: ToolContext, args: { id: string }): Promise<ToolResult> => {
  const folders = await loadFolders(ctx);
  const folder = folderOf(folders, args.id);
  const inside = await getDocs(
    query(
      collection(ctx.db, 'projects'),
      where('ownerId', '==', ctx.uid),
      where('folderId', '==', folder.id),
      limit(1),
    ),
  );
  if (childrenOf(folders, folder.id).length > 0 || !inside.empty)
    throw new ToolError(409, 'La carpeta no está vacía: mueve o borra antes su contenido.');
  await deleteDoc(doc(ctx.db, 'folders', folder.id));
  return { text: `Carpeta borrada: ${folder.id} («${folder.name}»).`, data: { folderId: folder.id } };
}, FOLDER_DENIED);

/** Mueve un proyecto propio a una carpeta propia o a Inicio (`null`). */
export const moveProject = denied(
  async (ctx: ToolContext, args: { id: string; folderId: string | null }): Promise<ToolResult> => {
    if (!ID_RE.test(args.id)) throw new ToolError(400, 'Id de proyecto no válido.');
    const ref = doc(ctx.db, 'projects', args.id);
    const project = (await getDoc(ref)).data() as ProjectDoc | undefined;
    if (!project) throw new ToolError(404, 'El proyecto no existe.');
    // Explícito: mandar `null` a un proyecto que ya está en Inicio solo cambia `updatedAt`, y eso la rama de editor
    // de las reglas lo deja pasar.
    if (project.ownerId !== ctx.uid)
      throw new ToolError(403, 'Solo el dueño puede mover un proyecto (las carpetas no se comparten).');
    const folders = await loadFolders(ctx);
    const folderId = folderTarget(folders, args.folderId);
    await updateDoc(ref, { folderId, updatedAt: now(ctx) });
    return {
      text: `Proyecto movido: ${args.id} («${project.title}») a ${folderLabel(folders, folderId)}.`,
      data: { id: args.id, folderId },
    };
  },
);
