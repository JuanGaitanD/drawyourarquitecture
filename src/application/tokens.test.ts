import { describe, expect, it } from 'vitest';
import { generateToken, normalizeEmail, sha256Hex } from './tokens';

describe('tokens MCP', () => {
  it('genera dya_ + 32 bytes en base64url, distintos cada vez', () => {
    const a = generateToken();
    expect(a).toMatch(/^dya_[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('sha256Hex da el hash conocido (64 hex)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('normalizeEmail recorta, pasa a minúsculas y rechaza lo que no es un correo', () => {
    expect(normalizeEmail('  Amiga@Example.COM ')).toBe('amiga@example.com');
    for (const bad of ['', 'sin-arroba', 'a@b', 'a b@c.d', 'a@@c.d', `${'x'.repeat(250)}@c.de`]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});
