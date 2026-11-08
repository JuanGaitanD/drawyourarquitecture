import { useEffect, useState } from 'react';
import type { Folder } from '@/domain/folder';
import { folderRepo } from '../services';

/**
 * Carpetas del usuario en vivo. `null` mientras carga. Si la suscripción falla (reglas sin desplegar, sin red) el
 * panel sigue funcionando sin carpetas: `error` avisa y `folders` queda vacío.
 */
export function useMyFolders(uid: string | null): { folders: Folder[] | null; error: Error | null } {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!uid) return;
    return folderRepo.subscribe(
      uid,
      (list) => {
        setError(null);
        setFolders(list);
      },
      (e) => {
        setError(e);
        setFolders([]);
      },
    );
  }, [uid]);
  return { folders, error };
}
