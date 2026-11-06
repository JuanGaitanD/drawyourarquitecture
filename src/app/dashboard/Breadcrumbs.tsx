import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import type { Folder } from '@/domain/folder';
import styles from './FolderView.module.css';
import { useDropTarget } from './useDragDrop';

/**
 * Migas `Inicio / Universidad / Semestre 5`: cada tramo enlaza; el último es la página actual. Cada tramo es también
 * un destino al arrastrar un proyecto o una carpeta (`folders` valida los destinos).
 */
export function Breadcrumbs({ trail, folders }: { trail: readonly Folder[]; folders: readonly Folder[] }) {
  return (
    <nav aria-label="Ruta de la carpeta">
      <ol className={styles.crumbs}>
        <Crumb target={null} name="Inicio" folders={folders}>
          <Link href="/" className={styles.crumbLink}>
            Inicio
          </Link>
        </Crumb>
        {trail.map((f, i) => (
          <Crumb key={f.id} target={f.id} name={f.name} folders={folders}>
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
          </Crumb>
        ))}
      </ol>
    </nav>
  );
}

function Crumb({
  target,
  name,
  folders,
  children,
}: {
  target: string | null;
  name: string;
  folders: readonly Folder[];
  children: ReactNode;
}) {
  const drop = useDropTarget(target, name, folders);
  return (
    <li className={styles.crumbItem} {...drop}>
      {children}
    </li>
  );
}
