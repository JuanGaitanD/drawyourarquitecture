import { inviteRepo, presenceAcl } from '../services';

/**
 * Publica en el espejo de presencia el acceso vigente del proyecto, completo y con la versión de Firestore (D33):
 * una instantánea atrasada la descarta el servidor, lo que ya no está en Firestore desaparece del espejo y un fallo
 * se propaga (quien llama lo muestra o lo reintenta). Solo el dueño.
 */
export async function syncAcl(projectId: string, ownerId: string): Promise<void> {
  const snap = await inviteRepo.aclSnapshot(projectId, ownerId);
  await presenceAcl.publish({ ownerId, projectId }, snap);
}

const RETRY_MS = [5_000, 30_000, 120_000];

/**
 * `syncAcl` con reintentos espaciados mientras `isOpen()`. Nunca lanza: devuelve `true` si publicó y `false` si falló
 * definitivamente (el último fallo se registra, no se silencia) o se cerró antes de terminar.
 */
export async function syncAclWithRetry(
  projectId: string,
  ownerId: string,
  isOpen: () => boolean,
): Promise<boolean> {
  for (let i = 0; ; i++) {
    try {
      await syncAcl(projectId, ownerId);
      return true;
    } catch (e) {
      const wait = RETRY_MS[i];
      if (wait === undefined || !isOpen()) {
        console.error('No se pudo sincronizar el espejo de acceso de la presencia', e);
        return false;
      }
      await new Promise((r) => setTimeout(r, wait));
      if (!isOpen()) return false;
    }
  }
}
