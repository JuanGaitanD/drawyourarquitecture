import type { ProjectType } from '@/domain/project';
import { Button } from '@/ui';
import styles from './FolderView.module.css';
import { TYPE_META } from './typeMeta';
import { useCreateProject } from './useCreateProject';

const TYPES: ProjectType[] = ['note', 'board'];
const ARIA: Record<ProjectType, string> = { note: 'Nueva nota', board: 'Nuevo diagrama' };

/** Dentro de una carpeta no se repiten las tarjetas «Nuevo»: dos botones compactos crean ahí mismo y abren el editor. */
export function FolderNewButtons({ folderId, folderName }: { folderId: string; folderName: string }) {
  const { creating, create } = useCreateProject(folderId);
  return (
    <div className={styles.newButtons} role="group" aria-label={`Crear en «${folderName}»`}>
      {TYPES.map((type) => {
        const { label, Icon } = TYPE_META[type];
        return (
          <Button
            key={type}
            size="sm"
            icon={<Icon size={16} aria-hidden />}
            aria-label={`${ARIA[type]} en ${folderName}`}
            loading={creating === type}
            disabled={creating !== null}
            onClick={() => void create(type)}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
