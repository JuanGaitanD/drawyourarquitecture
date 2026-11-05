import { LoaderCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import type { ProjectType } from '@/domain/project';
import { useToast } from '@/ui';
import { createProject } from '../services';
import styles from './NewProject.module.css';
import { TYPE_META } from './typeMeta';

const TYPES: ProjectType[] = ['note', 'board'];

/** «Nuevo»: una tarjeta por tipo de proyecto. Crea, y entra al editor. */
export function NewProject() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [creating, setCreating] = useState<ProjectType | null>(null);

  async function create(type: ProjectType) {
    setCreating(type);
    try {
      const id = await createProject(type);
      navigate(`/${type}/${id}`);
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

  return (
    <section aria-labelledby="nuevo-titulo">
      <h2 id="nuevo-titulo" className={styles.heading}>
        Nuevo
      </h2>
      <div className={styles.grid}>
        {TYPES.map((type) => {
          const { label, description, Icon } = TYPE_META[type];
          const busy = creating === type;
          return (
            <button
              key={type}
              type="button"
              className={`${styles.card} ${styles[type]}`}
              disabled={creating !== null}
              aria-busy={busy || undefined}
              onClick={() => void create(type)}
            >
              <span className={styles.tile} aria-hidden="true">
                <Icon size={22} aria-hidden />
              </span>
              <span className={styles.text}>
                <span className={styles.title}>{busy ? `Creando ${label.toLowerCase()}…` : label}</span>
                <span className={styles.description}>{description}</span>
              </span>
              <span className={styles.plus} aria-hidden="true">
                {busy ? <LoaderCircle className={styles.spinner} size={18} /> : <Plus size={18} />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
