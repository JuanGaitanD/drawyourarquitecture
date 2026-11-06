import { createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { signCustomToken } from './admin';

describe('custom token firmado sin firebase-admin/auth', () => {
  it('es un JWT RS256 con el formato de createCustomToken y firma válida', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sa = { client_email: 'svc@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
    const token = signCustomToken('u1', sa, 1000);
    const [h, b, s] = token.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(b, 'base64url').toString())).toEqual({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: 1000,
      exp: 4600,
      uid: 'u1',
    });
    expect(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('el servidor empaquetado no carga firebase-admin/auth al arrancar (Vercel no admite su require de jose)', () => {
    const bundle = readFileSync(new URL('../../api/_mcp.mjs', import.meta.url), 'utf8');
    expect(bundle).not.toMatch(/^import .* from "firebase-admin\/auth";$/m);
  });
});
