import { ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import type { Folder } from '@/domain/folder';
import styles from './FolderView.module.css';

/** Migas `Inicio / Universidad / Semestre 5`: cada tramo enlaza; el último es la página actual. */
export function Breadcrumbs({ trail }: { trail: readonly Folder[] }) {
  return (
    <nav aria-label="Ruta de la carpeta">
      <ol className={styles.crumbs}>
        <li>
          <Link href="/" className={styles.crumbLink}>
            Inicio
          </Link>
        </li>
        {trail.map((f, i) => (
          <li key={f.id} className={styles.crumbItem}>
            <ChevronRight size={14} aria-hidden="true" />
            {i === trail.length - 1 ? (
              <span aria-current="page" className={styles.crumbCurrent} title={f.name}>
                {f.name}
              </span>
            ) : (
              <Link href={`/folder/${f.id}`} className={styles.crumbLink} title={f.name}>
                {f.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
