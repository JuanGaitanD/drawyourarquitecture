import { describe, expect, it } from 'vitest';
import { makeNode, type BoardContent } from '../model/board';
import { fixtureBoard } from '../model/fixtures';
import {
  DYA_FORMAT,
  DYA_VERSION,
  base64ToBlob,
  blobToBase64,
  MAX_DYA_BYTES,
  buildDya,
  dyaToText,
  imageFileIds,
  parseImport,
  readDya,
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

  it('D27: si la segunda subida falla, borra la primera y la que falló (aunque borrar falle)', async () => {
    const stored = new Set<string>();
    const removed: string[] = [];
    let n = 0;
    const p = uploadImages(
      withImages(),
      {
        'file-a': { mimeType: 'image/png', base64: 'AQID' },
        'file-b': { mimeType: 'image/webp', base64: 'BAUG' },
      },
      async (id) => {
        if (id === 'nuevo-2') throw new Error('sin red');
        stored.add(id);
      },
      {
        newId: () => `nuevo-${++n}`,
        wait: async () => undefined,
        remove: async (id) => {
          removed.push(id);
          if (id === 'nuevo-2') throw new Error('no existe'); // no llegó a subirse: borrar falla y no importa
          stored.delete(id);
        },
      },
    );
    await expect(p).rejects.toThrow('sin red');
    expect(removed.sort()).toEqual(['nuevo-1', 'nuevo-2']);
    expect([...stored]).toEqual([]);
  });

  it('una imagen que no venía en el archivo se deja como estaba', async () => {
    const out = await uploadImages(withImages(), {}, async () => undefined);
    expect(imageFileIds(out).sort()).toEqual(['file-a', 'file-b']);
  });
});

describe('.dya.json · topes de exportación e importación (D35)', () => {
  const MIB = 1024 * 1024;
  /** Una imagen de 4 MiB (el tope por imagen), distinta de las demás. */
  const bigImage = (n: number) => {
    const bytes = new Uint8Array(4 * MIB);
    for (let i = 0; i < bytes.length; i += 4096) bytes[i] = n;
    return new Blob([bytes], { type: 'image/gif' });
  };
  const many = (n: number): BoardContent => ({
    ...fixtureBoard(),
    nodes: [...fixtureBoard().nodes, ...Array.from({ length: n }, (_, i) => image(`i${i}`, `f${i}`))],
  });

  it('el tope es el mismo en las dos direcciones y cubre los GIF de 4 MiB que la app admite', () => {
    expect(MAX_DYA_BYTES).toBeGreaterThanOrEqual(Math.ceil((12 * 4 * MIB * 4) / 3));
  });

  it('un diagrama de 11 GIF de 4 MiB (>40 MiB en base64) se exporta y se vuelve a importar entero', async () => {
    const n = 11;
    const { file } = await buildDya(many(n), async (id) => bigImage(Number(id.slice(1)) + 1));
    const text = dyaToText(file);
    expect(text.length).toBeGreaterThan(40 * MIB);
    const back = await readDya(new File([text], 'grande.dya.json'));
    if (!back.ok) throw new Error(back.error);
    expect(Object.keys(back.files)).toHaveLength(n);
    const blob = base64ToBlob(back.files['f7'].base64, back.files['f7'].mimeType);
    expect(blob.size).toBe(4 * MIB);
    expect(new Uint8Array(await blob.arrayBuffer())[0]).toBe(8);
    // Mueve > 40 MiB por base64: con la suite en paralelo supera los 5 s por defecto.
  }, 30_000);

  it('exportar lo que no se podría importar falla en vez de descargar el archivo', async () => {
    const { file } = await buildDya(withImages(), async () => png([1, 2, 3]));
    expect(() => dyaToText(file, 100)).toThrow(/solo importa archivos de hasta/);
    expect(() => dyaToText(file)).not.toThrow();
  });

  it('importar un archivo por encima del tope avisa con su título y el tope', async () => {
    const r = await readDya(new File(['x'.repeat(2 * MIB + 1)], 'a.json'), 2 * MIB);
    expect(r).toMatchObject({ ok: false, title: 'El archivo es demasiado grande', error: 'El máximo es 2 MiB.' });
  });

  it('readDya distingue un JSON roto de un diagrama inválido', async () => {
    expect(await readDya(new File(['{'], 'roto.json'))).toMatchObject({ ok: false, title: 'No es un JSON válido', error: 'roto.json' });
    expect(await readDya(new File(['{"a":1}'], 'otro.json'))).toMatchObject({ ok: false, title: 'No es un diagrama válido' });
  });
});
