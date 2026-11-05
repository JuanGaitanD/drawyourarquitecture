import type { Firestore } from 'firebase-admin/firestore';
import { TOKEN_PREFIX, sha256Hex } from '../application/tokens';

// La autorización de los datos NO está aquí: las reglas de Firestore la aplican porque el servidor opera con el
// SDK web autenticado como la persona (userDb.ts). Aquí solo se resuelve quién llama (token → uid) y se traduce
// `permission-denied` a 403.

export type ErrorStatus = 400 | 401 | 403 | 404 | 413 | 429;

/** Error con código HTTP que las herramientas devuelven al cliente MCP como `isError`. */
export class ToolError extends Error {
  readonly status: ErrorStatus;
  /** Segundos hasta poder reintentar (429). */
  readonly retryAfter?: number;
  constructor(status: ErrorStatus, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ToolError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Una regla de Firestore rechazó la operación (también un proyecto inexistente: `resource` nulo = denegado). */
export const isPermissionDenied = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'permission-denied';

export interface Identity {
  uid: string;
  /** sha256 del token: id de `mcpTokens`, clave del límite de tasa y de la auditoría. */
  tokenHash: string;
}

/** Cada llamada MCP no debe costar una escritura: `lastUsedAt` se refresca como mucho una vez por hora. */
const LAST_USED_EVERY_MS = 3_600_000;

/**
 * `Authorization: Bearer dya_…` → uid. Busca el sha256 en `mcpTokens` (con Admin: aún no hay identidad con la
 * que pasar las reglas); sin token, con formato inválido, inexistente o revocado lanza 401. Anota `lastUsedAt`
 * como mucho una vez por hora.
 */
export async function authenticate(db: Firestore, header: string | undefined): Promise<Identity> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m) throw new ToolError(401, 'Falta el encabezado Authorization: Bearer <token>.');
  const token = m[1];
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) throw new ToolError(401, 'Token no válido.');
  const tokenHash = await sha256Hex(token);
  const ref = db.collection('mcpTokens').doc(tokenHash);
  const data = (await ref.get()).data();
  if (!data || data.revoked === true || typeof data.uid !== 'string' || data.uid === '') {
    throw new ToolError(401, 'Token no válido o revocado.');
  }
  const now = Date.now();
  if (typeof data.lastUsedAt !== 'number' || now - data.lastUsedAt >= LAST_USED_EVERY_MS) {
    await ref.update({ lastUsedAt: now }).catch(() => undefined);
  }
  return { uid: data.uid, tokenHash };
}
