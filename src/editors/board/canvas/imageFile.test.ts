import { describe, expect, it, vi } from 'vitest';
import { imageProblem, uploadWithRetry } from './imageFile';

describe('imageProblem', () => {
  it('admite PNG/JPEG/GIF/WebP hasta 4 MiB y rechaza SVG y lo grande', () => {
    expect(imageProblem({ type: 'image/png', size: 10 })).toBeNull();
    expect(imageProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG/);
    expect(imageProblem({ type: 'image/webp', size: 4 * 1024 * 1024 + 1 })).toMatch(/4 MiB/);
  });
});

describe('uploadWithRetry', () => {
  const nowait = () => Promise.resolve();
  it('reintenta hasta 3 veces y entonces falla', async () => {
    const up = vi.fn().mockRejectedValue(new Error('red'));
    await expect(uploadWithRetry(up, new Blob(), nowait)).rejects.toThrow('red');
    expect(up).toHaveBeenCalledTimes(4);
  });
  it('se detiene en cuanto sale bien', async () => {
    const up = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    await uploadWithRetry(up, new Blob(), nowait);
    expect(up).toHaveBeenCalledTimes(2);
  });
});
