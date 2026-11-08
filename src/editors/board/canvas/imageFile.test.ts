import { describe, expect, it, vi } from 'vitest';
import { imageProblem, uploadWithRetry } from './imageFile';

describe('imageProblem', () => {
  it('admite PNG/JPEG/GIF/WebP y rechaza SVG', () => {
    expect(imageProblem({ type: 'image/png' })).toBeNull();
    expect(imageProblem({ type: 'image/webp' })).toBeNull();
    expect(imageProblem({ type: 'image/svg+xml' })).toMatch(/PNG/);
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
