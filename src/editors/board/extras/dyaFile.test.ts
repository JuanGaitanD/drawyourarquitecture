import { describe, expect, it } from 'vitest';
import { makeNode, type BoardContent } from '../model/board';
import { fixtureBoard } from '../model/fixtures';
import {
  DYA_FORMAT,
  DYA_VERSION,
  base64ToBlob,
  blobToBase64,
  buildDya,
  imageFileIds,
  parseImport,
  uploadImages,
} from './dyaFile';

const png = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });
const image = (id: string, fileId: string) => ({ ...makeNode('image', { x: 0, y: 0 }, { fileId, label: 'x' }), id });
const withImages = (): BoardContent => ({
  ...fixtureBoard(),
  nodes: [...fixtureBoard().nodes, image('i1', 'file-a'), image('i2', 'file-b'), image('i3', 'file-a')],
});
const bytesOf = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())];

describe('.dya.json · formato (D14)', () => {
  it('base64 ⇄ blob conserva los bytes y el tipo, también con binarios grandes', async () => {
    const big = Array.from({ length: 100_000 }, (_, i) => i % 256);
    const back = base64ToBlob(await blobToBase64(png(big)), 'image/png');
    expect(back.type).toBe('image/png');
    expect(await bytesOf(back)).toEqual(big);
  });

  it('imageFileIds no repite ids', () => {
    expect(imageFileIds(withImages()).sort()).toEqual(['file-a', 'file-b']);
  });

  it('buildDya incluye los binarios y lista los que no se pueden leer', async () => {
    const { file, missing } = await buildDya(withImages(), async (id) => {
      if (id === 'file-b') throw new Error('borrado');
      return png([1, 2, 3]);
    });
    expect(file).toMatchObject({ format: DYA_FORMAT, version: DYA_VERSION });
    expect(Object.keys(file.files)).toEqual(['file-a']);
    expect(file.files['file-a']).toEqual({ mimeType: 'image/png', base64: 'AQID' });
    expect(missing).toEqual(['file-b']);
  });

  it('un .dya.json exportado se importa igual (ida y vuelta por JSON)', async () => {
    const { file } = await buildDya(withImages(), async () => png([9, 9]));
    const r = parseImport(JSON.parse(JSON.stringify(file)));
    expect(r.ok && Object.keys(r.files).sort()).toEqual(['file-a', 'file-b']);
    expect(r.ok && r.content.nodes).toHaveLength(withImages().nodes.length);
  });

  it('el .json antiguo (solo contenido, sin imágenes) sigue importándose', () => {
    const r = parseImport(JSON.parse(JSON.stringify(fixtureBoard())));
    expect(r.ok && r.files).toEqual({});
    expect(r.ok && r.content.nodes).toHaveLength(fixtureBoard().nodes.length);
  });

  const file = (over: Record<string, unknown>) => ({
    format: DYA_FORMAT,
    version: DYA_VERSION,
    content: fixtureBoard(),
    files: {},
    ...over,
  });
  it.each([
    ['formato desconocido', file({ format: 'otro' }), /Formato/],
    ['versión futura', file({ version: 2 }), /Versión/],
    ['contenido inválido', file({ content: { schemaVersion: 1 } }), /./],
    ['imagen sin base64', file({ files: { a: { mimeType: 'image/png' } } }), /no es válida/],
    ['tipo no admitido', file({ files: { a: { mimeType: 'image/svg+xml', base64: 'AQID' } } }), /PNG, JPEG/],
    ['base64 roto', file({ files: { a: { mimeType: 'image/png', base64: '¡no!' } } }), /base64/],
    [
      'imagen de más de 4 MiB',
      file({ files: { a: { mimeType: 'image/png', base64: 'A'.repeat(6 * 1024 * 1024) } } }),
      /4 MiB/,
    ],
  ])('rechaza %s', (_n, raw, msg) => {
    const r = parseImport(raw);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(msg);
  });

  it('uploadImages sube antes de devolver el contenido, con fileId nuevos y los nodos repetidos al mismo', async () => {
    const uploaded: string[] = [];
    const files = {
      'file-a': { mimeType: 'image/png', base64: 'AQID' },
      'file-b': { mimeType: 'image/webp', base64: 'BAUG' },
    };
    let n = 0;
    const out = await uploadImages(
      withImages(),
      files,
      async (id, blob) => void uploaded.push(`${id}:${blob.type}:${blob.size}`),
      { newId: () => `nuevo-${++n}` },
    );
    expect(uploaded).toEqual(['nuevo-1:image/png:3', 'nuevo-2:image/webp:3']);
    const ids = out.nodes.filter((x) => x.data.kind === 'image').map((x) => x.data.fileId);
    expect(ids).toEqual(['nuevo-1', 'nuevo-2', 'nuevo-1']);
  });

  it('si una subida falla (tras los reintentos) lanza y no devuelve contenido', async () => {
    let tries = 0;
    const p = uploadImages(
      withImages(),
      { 'file-a': { mimeType: 'image/png', base64: 'AQID' } },
      async () => {
        tries++;
        throw new Error('sin red');
      },
      { wait: async () => undefined },
    );
    await expect(p).rejects.toThrow('sin red');
    expect(tries).toBe(4); // 1 intento + 3 reintentos
  });

  it('una imagen que no venía en el archivo se deja como estaba', async () => {
    const out = await uploadImages(withImages(), {}, async () => undefined);
    expect(imageFileIds(out).sort()).toEqual(['file-a', 'file-b']);
  });
});
