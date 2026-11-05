import { Users } from 'lucide-react';
import { Link } from 'wouter';
import { roleOf, type Project } from '@/domain/project';
import dash from './Dashboard.module.css';
import styles from './ProjectCard.module.css';
import { formatAbsolute, formatRelative } from './relativeTime';
import { TYPE_META } from './typeMeta';

/** «Compartidos conmigo»: proyectos de otras personas en los que soy editor o viewer. */
export function SharedProjects({ projects, uid, now }: { projects: Project[]; uid: string; now: number }) {
  return (
    <section aria-labelledby="compartidos-titulo" className={dash.projects}>
      <div className={dash.toolbar}>
        <h2 id="compartidos-titulo" className={dash.heading}>
          Compartidos conmigo
        </h2>
      </div>
      <ul className={dash.grid}>
        {projects.map((p) => {
          const { label, Icon } = TYPE_META[p.type];
          const role = roleOf(p, uid) === 'viewer' ? 'Solo lectura' : 'Editor';
          return (
            <li key={p.id} className={`${styles.card} ${styles[p.type]}`}>
              <Link href={`/${p.type}/${p.id}`} className={styles.surface}>
                <span className={styles.preview} aria-hidden="true">
                  <span className={styles.tile}>
                    <Icon size={26} aria-hidden />
                  </span>
                </span>
                <span className={styles.body}>
                  <span className={styles.title}>{p.title}</span>
                  <span className={styles.meta}>
                    <span className={styles.type}>{label}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={new Date(p.updatedAt).toISOString()} title={formatAbsolute(p.updatedAt)}>
                      {formatRelative(p.updatedAt, now)}
                    </time>
                  </span>
                </span>
              </Link>
              <span className={styles.public}>
                <Users size={12} aria-hidden="true" />
                {role}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
