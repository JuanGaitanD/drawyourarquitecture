import { useState } from 'react';
import { useLocation } from 'wouter';
import type { ProjectType } from '@/domain/project';
import { useToast } from '@/ui';
import { createProject } from '../services';

/** Crea un proyecto del tipo dado (en `folderId`, o en Inicio) y entra al editor (`history.state.from` es el lugar del panel al que vuelve «Volver»). `creating` es el tipo en curso. */
export function useCreateProject(folderId?: string | null) {
  const [here, navigate] = useLocation();
  const { toast } = useToast();
  const [creating, setCreating] = useState<ProjectType | null>(null);

  async function create(type: ProjectType) {
    setCreating(type);
    try {
      const id = await createProject(type, undefined, folderId);
      navigate(`/${type}/${id}`, { state: { from: here } });
    } catch {
      toast({
        kind: 'error',
        title: 'No se pudo crear',
        description: 'Comprueba tu conexión e inténtalo de nuevo.',
        action: { label: 'Reintentar', onClick: () => void create(type) },
      });
      setCreating(null);
    }
  }

  return { creating, create };
}
