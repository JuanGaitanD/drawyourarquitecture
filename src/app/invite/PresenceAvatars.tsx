import { Tooltip } from '@/ui';
import { usePresence } from '../hooks';
import styles from './PresenceAvatars.module.css';

const MAX = 4;

/** Avatares de quienes están conectados al proyecto (iniciales con su color; sin cursores). */
export function PresenceAvatars({ projectId }: { projectId: string }) {
  const others = usePresence(projectId);
  if (others.length === 0) return null;
  const shown = others.slice(0, MAX);
  const extra = others.length - shown.length;
  return (
    <ul className={styles.list} aria-label="Conectados ahora">
      {shown.map((p) => {
        const name = p.name || 'Alguien';
        return (
          <li key={p.uid}>
            <Tooltip label={`${name} · conectado`}>
              <span
                className={styles.avatar}
                style={{ background: p.color }}
                role="img"
                aria-label={`${name} está conectado`}
              >
                {(p.name.trim().charAt(0) || '?').toUpperCase()}
              </span>
            </Tooltip>
          </li>
        );
      })}
      {extra > 0 ? (
        <li>
          <span className={styles.more} aria-label={`${extra} más conectados`}>
            +{extra}
          </span>
        </li>
      ) : null}
    </ul>
  );
}
