import { useEffect, useRef } from 'react';
import type { ContentRecord } from '@/application/ports';
import { contentRepo } from '../services';

/** Escucha los cambios remotos del contenido (`onSnapshot`). El primer evento es el estado actual. */
export function useRemoteContent(id: string, onRemote: (r: ContentRecord) => void): void {
  const ref = useRef(onRemote);
  useEffect(() => {
    ref.current = onRemote;
  }, [onRemote]);
  useEffect(() => contentRepo.subscribe(id, (r) => ref.current(r)), [id]);
}
