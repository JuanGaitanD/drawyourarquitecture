import { nanoid } from 'nanoid';
import { MAX_IMAGE_BYTES } from '@/application/imageOptimize';
import type { BoardContent } from '../model/board';
import { validateBoardContent } from '../model/validate';
import { IMAGE_TYPES, uploadWithRetry } from '../canvas/imageFile';

// Formato de archivo del diagrama: `.dya.json` = contenido + los binarios de sus imágenes en base64. Sin Storage,
// las imágenes viven en Firestore por proyecto: un JSON solo con el contenido dejaría imágenes rotas al importar
// en otro proyecto. El `.json` antiguo (solo `BoardContent`, sin imágenes) se sigue importando. Sin React.

export const DYA_FORMAT = 'dya-board';
export const DYA_VERSION = 1;
/** Tope de un archivo importado con imágenes (el contenido ya pasa por `validateBoardContent`). */
export const MAX_DYA_BYTES = 40 * 1024 * 1024;

export interface DyaImage {
  mimeType: string;
  base64: string;
}
export type DyaImages = Record<string, DyaImage>;

export interface DyaFile {
  format: typeof DYA_FORMAT;
  version: typeof DYA_VERSION;
  content: BoardContent;
  files: DyaImages;
}

/** Ids de archivo de las imágenes del diagrama, sin repetir. */
export function imageFileIds(content: Pick<BoardContent, 'nodes'>): string[] {
  const ids = new Set<string>();
  for (const n of content.nodes) if (n.data.kind === 'image' && n.data.fileId) ids.add(n.data.fileId);
  return [...ids];
}

const CHUNK = 0x8000;
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** Bytes que decodifica un base64 válido (sin decodificarlo). */
const decodedSize = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

/**
 * Arma el archivo con los binarios de las imágenes. Las que no se pueden leer (borradas, sin permiso) no se
 * incluyen y se devuelven en `missing`: el resto del diagrama sí se exporta.
 */
export async function buildDya(
  content: BoardContent,
  load: (fileId: string) => Promise<Blob>,
): Promise<{ file: DyaFile; missing: string[] }> {
  const files: DyaImages = {};
  const missing: string[] = [];
  await Promise.all(
    imageFileIds(content).map(async (id) => {
      try {
        const blob = await load(id);
        files[id] = { mimeType: blob.type, base64: await blobToBase64(blob) };
      } catch {
        missing.push(id);
      }
    }),
  );
  return { file: { format: DYA_FORMAT, version: DYA_VERSION, content, files }, missing };
}

export type ParsedImport =
  | { ok: true; content: BoardContent; files: DyaImages }
  | { ok: false; error: string };

/** Lo que se importa es entrada externa: se valida todo. Admite `.dya.json` y el `.json` antiguo sin imágenes. */
export function parseImport(raw: unknown): ParsedImport {
  const r = raw as Partial<DyaFile> | null;
  if (!r || typeof r !== 'object' || r.format === undefined) {
    const v = validateBoardContent(raw);
    return v.ok ? { ok: true, content: v.value, files: {} } : v;
  }
  if (r.format !== DYA_FORMAT) return { ok: false, error: `Formato no admitido: ${String(r.format)}.` };
  if (r.version !== DYA_VERSION) return { ok: false, error: `Versión no admitida: ${String(r.version)}.` };
  const v = validateBoardContent(r.content);
  if (!v.ok) return v;
  const files: DyaImages = {};
  const entries = r.files && typeof r.files === 'object' ? Object.entries(r.files) : [];
  for (const [id, f] of entries) {
    const img = f as Partial<DyaImage> | null;
    if (!img || typeof img.mimeType !== 'string' || typeof img.base64 !== 'string')
      return { ok: false, error: `La imagen ${id} no es válida.` };
    if (!(IMAGE_TYPES as readonly string[]).includes(img.mimeType))
      return { ok: false, error: `La imagen ${id} no es PNG, JPEG, GIF ni WebP.` };
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(img.base64) || img.base64.length % 4 !== 0)
      return { ok: false, error: `La imagen ${id} no es base64 válido.` };
    if (decodedSize(img.base64) > MAX_IMAGE_BYTES) return { ok: false, error: `La imagen ${id} pesa más de 4 MiB.` };
    files[id] = { mimeType: img.mimeType, base64: img.base64 };
  }
  return { ok: true, content: v.value, files };
}

/**
 * Sube las imágenes que el contenido usa (con reintentos) y devuelve el contenido con los `fileId` nuevos: cada
 * importación usa ids propios, así no pisa los archivos del proyecto ni colisiona con otro diagrama. Si una subida
 * falla, lanza y no se aplica nada. Los nodos cuya imagen no venía en el archivo se dejan como están.
 */
export async function uploadImages(
  content: BoardContent,
  files: DyaImages,
  upload: (fileId: string, blob: Blob) => Promise<void>,
  opts: { newId?: () => string; wait?: (ms: number) => Promise<void> } = {},
): Promise<BoardContent> {
  const newId = opts.newId ?? nanoid;
  const ids = new Map<string, string>();
  for (const old of imageFileIds(content)) {
    const f = files[old];
    if (!f) continue;
    const id = newId();
    await uploadWithRetry((b) => upload(id, b), base64ToBlob(f.base64, f.mimeType), opts.wait);
    ids.set(old, id);
  }
  if (!ids.size) return content;
  return {
    ...content,
    nodes: content.nodes.map((n) =>
      n.data.kind === 'image' && n.data.fileId && ids.has(n.data.fileId)
        ? { ...n, data: { ...n.data, fileId: ids.get(n.data.fileId) } }
        : n,
    ),
  };
}
