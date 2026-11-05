import type { Firestore } from 'firebase-admin/firestore';
import { TOKEN_PREFIX, sha256Hex } from '../application/tokens';

// Firebase Admin se salta las reglas de Firestore: la autorización vive aquí, en una sola función por
// permiso, y cada herramienta la llama antes de leer o escribir (docs/mcp.md · Seguridad).

export type ErrorStatus = 400 | 401 | 403 | 404 | 413;

/** Error con código HTTP que las herramientas devuelven al cliente MCP como `isError`. */
export class ToolError extends Error {
  readonly status: ErrorStatus;
  constructor(status: ErrorStatus, message: string) {
    super(message);
    this.name = 'ToolError';
    this.status = status;
  }
}

export type MemberRole = 'editor' | 'viewer';

/** Lo mínimo de `projects/{id}` que decide el acceso. `members` es opcional (sin él = solo el dueño). */
export interface ProjectAccess {
  ownerId: string;
  isPublic?: boolean;
  members?: unknown;
}

function roleOf(p: ProjectAccess, uid: string): MemberRole | undefined {
  const m = p.members;
  if (typeof m !== 'object' || m === null || !Object.hasOwn(m, uid)) return undefined;
  const r = (m as Record<string, unknown>)[uid];
  return r === 'editor' || r === 'viewer' ? r : undefined;
}

/** Leer: dueño, miembro (editor o viewer) o proyecto público. */
export function canRead(p: ProjectAccess, uid: string): boolean {
  return p.ownerId === uid || roleOf(p, uid) !== undefined || p.isPublic === true;
}

/** Escribir: dueño o miembro con rol `editor`. */
export function canWrite(p: ProjectAccess, uid: string): boolean {
  return p.ownerId === uid || roleOf(p, uid) === 'editor';
}

/** Crear proyectos: el dueño de la app (`OWNER_UID`) o quien esté en `allowedUsers`. */
export async function canCreate(
  db: Firestore,
  uid: string,
  ownerUid: string | undefined = process.env.OWNER_UID,
): Promise<boolean> {
  if (ownerUid && uid === ownerUid) return true;
  return (await db.collection('allowedUsers').doc(uid).get()).exists;
}

/**
 * `Authorization: Bearer dya_…` → uid. Busca el sha256 en `mcpTokens`; sin token, con formato
 * inválido, inexistente o revocado lanza 401. Anota `lastUsedAt`.
 */
export async function authenticate(db: Firestore, header: string | undefined): Promise<string> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m) throw new ToolError(401, 'Falta el encabezado Authorization: Bearer <token>.');
  const token = m[1];
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) throw new ToolError(401, 'Token no válido.');
  const ref = db.collection('mcpTokens').doc(await sha256Hex(token));
  const snap = await ref.get();
  const data = snap.data();
  if (!data || data.revoked === true || typeof data.uid !== 'string' || data.uid === '') {
    throw new ToolError(401, 'Token no válido o revocado.');
  }
  await ref.update({ lastUsedAt: Date.now() }).catch(() => undefined);
  return data.uid;
}
