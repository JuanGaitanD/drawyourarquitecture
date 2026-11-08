// Tokens personales del servidor MCP (fase 3). Solo Web Crypto: sirve igual en el navegador y en Node.
// El valor del token se muestra una vez; en Firestore solo vive su sha256 (`mcpTokens/{hash}`).

export const TOKEN_PREFIX = 'dya_';
export const MAX_LABEL_LENGTH = 60;

export interface McpTokenRecord {
  /** sha256 en hexadecimal del token: es el id del documento. */
  hash: string;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
  revoked: boolean;
}

/** Entrada de `allowedEmails/{email}`: quien puede crear proyectos además del dueño. */
export interface AllowedEmail {
  /** Correo en minúsculas (también es el id del documento). */
  email: string;
  addedAt: number;
}

/** Correo normalizado (recortado y en minúsculas) o `null` si no tiene forma de correo. Misma forma que las reglas. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** `dya_` + 32 bytes aleatorios en base64url (sin relleno). */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes));
  return TOKEN_PREFIX + b64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
