import { describe, expect, it, vi } from 'vitest';
import {
  ImageTooLargeError,
  MAX_IMAGE_BYTES,
  fitWithin,
  optimizeImage,
  type ImageCodec,
} from './imageOptimize';

const blobOf = (size: number, type: string) => new Blob([new Uint8Array(size)], { type });

/** Doble del navegador: imagen de `w`×`h` que codifica a un blob de `out` bytes y tipo `outType`. */
function codec(w: number, h: number, out: number, outType = 'image/webp') {
  const close = vi.fn();
  const encode = vi.fn<ImageCodec['encode']>(async () => blobOf(out, outType));
  const c: ImageCodec = { decode: async () => ({ width: w, height: h, close }), encode };
  return { c, close, encode };
}

describe('fitWithin', () => {
  it('reduce el lado mayor a 2048 conservando la proporción', () => {
    expect(fitWithin(4096, 1024)).toEqual({ width: 2048, height: 512 });
    expect(fitWithin(1000, 3000)).toEqual({ width: 683, height: 2048 });
  });
  it('no amplía lo pequeño', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('optimizeImage', () => {
  it('usa el WebP si pesa menos y lo pide a 2048 px y calidad 0,82', async () => {
    const { c, encode, close } = codec(4096, 2048, 1000);
    const out = await optimizeImage(blobOf(5000, 'image/png'), c);
    expect(out.type).toBe('image/webp');
    expect(out.size).toBe(1000);
    expect(encode).toHaveBeenCalledWith(expect.anything(), 2048, 1024, 'image/webp', 0.82);
    expect(close).toHaveBeenCalled();
  });

  it('conserva el original si el resultado no pesa menos', async () => {
    const orig = blobOf(1000, 'image/jpeg');
    expect(await optimizeImage(orig, codec(100, 100, 1000).c)).toBe(orig);
    expect(await optimizeImage(orig, codec(100, 100, 2000).c)).toBe(orig);
  });

  it('el GIF se sube tal cual, sin decodificar', async () => {
    const gif = blobOf(1000, 'image/gif');
    const { c, encode } = codec(10, 10, 1);
    expect(await optimizeImage(gif, c)).toBe(gif);
    expect(encode).not.toHaveBeenCalled();
  });

  it('si el navegador no soporta WebP (devuelve otro tipo) usa el original', async () => {
    const orig = blobOf(5000, 'image/png');
    expect(await optimizeImage(orig, codec(10, 10, 10, 'image/png').c)).toBe(orig);
  });

  it('si no se puede decodificar usa el original', async () => {
    const orig = blobOf(5000, 'image/png');
    const c: ImageCodec = { decode: () => Promise.reject(new Error('corrupta')), encode: vi.fn() };
    expect(await optimizeImage(orig, c)).toBe(orig);
  });

  it('admite 4 MiB justos y falla con un error claro por encima', async () => {
    const justo = blobOf(MAX_IMAGE_BYTES, 'image/png');
    expect(await optimizeImage(justo, codec(10, 10, MAX_IMAGE_BYTES + 1).c)).toBe(justo);
    await expect(
      optimizeImage(blobOf(MAX_IMAGE_BYTES + 1, 'image/png'), codec(10, 10, MAX_IMAGE_BYTES + 5).c),
    ).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it('una imagen enorme que optimizada cabe, se sube optimizada', async () => {
    const out = await optimizeImage(blobOf(10 * 1024 * 1024, 'image/png'), codec(8000, 6000, 3_000_000).c);
    expect(out.size).toBe(3_000_000);
  });
});
