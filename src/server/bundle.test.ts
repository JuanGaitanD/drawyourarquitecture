import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// api/_mcp.mjs se versiona (Vercel no puede compilar src/ por sí solo): si cambia src/server hay que regenerarlo.
describe('api/_mcp.mjs', () => {
  it('está al día con src/server (node scripts/bundle-mcp.mjs)', async () => {
    const script = '../../scripts/bundle-mcp.mjs';
    const { bundleMcp } = (await import(/* @vite-ignore */ script)) as { bundleMcp: () => Promise<string> };
    const committed = readFileSync('api/_mcp.mjs', 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe((await bundleMcp()).replace(/\r\n/g, '\n'));
  });
});
