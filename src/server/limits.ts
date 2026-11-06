import { Timestamp, addDoc, collection, doc, runTransaction, type Firestore } from 'firebase/firestore';
import { ToolError } from './authz';
import type { Identity } from './authz';

// Límite de tasa y auditoría del servidor MCP. Ambos documentos los escribe la persona autenticada (el servidor
// opera como ella) y las reglas (`rateLimits`, `mcpAudit`) fijan qué puede escribir: nada de Admin aquí.

export const RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60_000;
/** Las entradas de auditoría caducan solas con la política TTL de `mcpAudit.expireAt` (docs/mcp.md). */
export const AUDIT_TTL_MS = 30 * 86_400_000;

/**
 * Ventana fija de 1 min por token: la petición nº 61 de la misma ventana lanza 429 con `retryAfter` (segundos
 * hasta que abra la siguiente). ponytail: ventana fija permite ráfagas de 2×60 en el cambio de ventana; deslizante si importara.
 */
export async function consumeRate(db: Firestore, id: Identity, nowMs = Date.now()): Promise<void> {
  const ref = doc(db, 'rateLimits', id.tokenHash);
  const window = Math.floor(nowMs / RATE_WINDOW_MS);
  const allowed = await runTransaction(db, async (tx) => {
    const d = (await tx.get(ref)).data();
    if (!d) {
      tx.set(ref, { uid: id.uid, window, count: 1 });
    } else if (d.window === window) {
      if (d.count >= RATE_LIMIT) return false;
      tx.update(ref, { window, count: d.count + 1 });
    } else {
      tx.update(ref, { window, count: 1 });
    }
    return true;
  });
  if (!allowed) {
    const retryAfter = Math.max(1, Math.ceil(((window + 1) * RATE_WINDOW_MS - nowMs) / 1000));
    throw new ToolError(
      429,
      `Demasiadas peticiones (máximo ${RATE_LIMIT} por minuto por token).`,
      retryAfter,
    );
  }
}

export interface AuditEntry {
  tool: string;
  projectId?: string;
  ok: boolean;
}

/** Registra una llamada a una herramienta en `mcpAudit/{id}`. Nunca rompe la llamada: un fallo solo se anota en el log. */
export async function recordAudit(
  db: Firestore,
  id: Identity,
  e: AuditEntry,
  at = Date.now(),
): Promise<void> {
  try {
    await addDoc(collection(db, 'mcpAudit'), {
      uid: id.uid,
      tokenHash: id.tokenHash,
      tool: e.tool,
      ...(e.projectId ? { projectId: e.projectId } : {}),
      ok: e.ok,
      at,
      expireAt: Timestamp.fromMillis(at + AUDIT_TTL_MS),
    });
  } catch (err) {
    console.error('mcp: no se pudo registrar la auditoría', err);
  }
}
