import { LoaderCircle, Plus } from 'lucide-react';
import type { ProjectType } from '@/domain/project';
import styles from './NewProject.module.css';
import { TYPE_META } from './typeMeta';
import { useCreateProject } from './useCreateProject';

const TYPES: ProjectType[] = ['note', 'board'];

/** «Nuevo»: una tarjeta por tipo de proyecto. Crea, y entra al editor. */
export function NewProject() {
  const { creating, create } = useCreateProject();

  return (
    <section aria-labelledby="nuevo-titulo">
      <h2 id="nuevo-titulo" className={styles.heading}>
        Nuevo
      </h2>
      <div className={styles.grid}>
        {TYPES.map((type) => {
          const { label, description, Sketch } = TYPE_META[type];
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
              <Sketch size={56} className={styles.sketch} />
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
