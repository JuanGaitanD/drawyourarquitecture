import { inviteRepo, presenceAcl, projectRepo } from '../services';

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

/**
 * Dueño con el proyecto abierto: publica el espejo al abrir y de nuevo cada vez que cambian `members` o las
 * invitaciones (D47; un invitado que entra con el espejo aún sin su invitación queda sin presencia hasta entonces).
 * Las publicaciones no se solapan: si hay una en curso, el cambio queda pendiente y se repite al terminar.
 * Devuelve la función que deja de vigilar.
 */
export function keepAclSynced(projectId: string, ownerId: string, isOpen: () => boolean): () => void {
  let running = false;
  let pending = false;
  const publish = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        await syncAclWithRetry(projectId, ownerId, isOpen);
      } while (pending && isOpen());
    } finally {
      running = false;
    }
  };
  return projectRepo.watchAccess(
    projectId,
    () => void publish(),
    (e) => console.error('No se pudo vigilar el acceso del proyecto', e),
  );
}
