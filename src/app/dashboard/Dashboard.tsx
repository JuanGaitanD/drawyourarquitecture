import { FolderOpen, Search, TriangleAlert, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/ui';
import { useAuth, useMyProjects, useSharedProjects } from '../hooks';
import { Shell } from '../shell/Shell';
import styles from './Dashboard.module.css';
import { countByTab, filterProjects, type Tab } from './filter';
import { NewProject } from './NewProject';
import { ProjectCard } from './ProjectCard';
import { SharedProjects } from './SharedProjects';
import { PANEL_ID, ProjectTabs, tabId } from './ProjectTabs';
import { useNow } from './useNow';

const plural = (n: number) => `${n} ${n === 1 ? 'proyecto' : 'proyectos'}`;

export function Dashboard() {
  const { user } = useAuth();
  const { projects, error, retry } = useMyProjects(user?.uid ?? null);
  const shared = useSharedProjects(user?.uid ?? null);
  const now = useNow();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => countByTab(projects ?? []), [projects]);
  const visible = useMemo(() => filterProjects(projects ?? [], tab, query), [projects, tab, query]);
  const firstName = user?.name.trim().split(/\s+/)[0];

  return (
    <Shell>
      <div className={styles.page}>
        <header className={styles.hero}>
          <h1 className={styles.title}>{firstName ? `Hola, ${firstName}` : 'Hola'}</h1>
          <p className={styles.subtitle}>Dibuja una idea o diseña una arquitectura.</p>
        </header>

        <NewProject />

        <section aria-labelledby="proyectos-titulo" className={styles.projects}>
          <div className={styles.toolbar}>
            <h2 id="proyectos-titulo" className={styles.heading}>
              Tus proyectos
            </h2>
            {projects && projects.length > 0 ? (
              <div className={styles.controls}>
                <ProjectTabs value={tab} counts={counts} onChange={setTab} />
                <div className={styles.search}>
                  <Search className={styles.searchIcon} size={16} aria-hidden="true" />
                  <input
                    type="search"
                    className={styles.input}
                    placeholder="Buscar por título"
                    aria-label="Buscar proyectos por título"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && query) {
                        e.preventDefault();
                        setQuery('');
                      }
                    }}
                  />
                  {query ? (
                    <button
                      type="button"
                      className={styles.clear}
                      aria-label="Borrar búsqueda"
                      onClick={() => setQuery('')}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(tab)} tabIndex={-1}>
            {error ? (
              <Message
                tone="error"
                icon={<TriangleAlert size={22} aria-hidden="true" />}
                title="No se pudieron cargar tus proyectos"
                text="Comprueba tu conexión e inténtalo de nuevo."
              >
                <Button variant="primary" onClick={retry}>
                  Reintentar
                </Button>
              </Message>
            ) : projects === null ? (
              <div className={styles.grid} aria-busy="true">
                <p className="sr-only" role="status">
                  Cargando proyectos…
                </p>
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className={styles.skeleton} aria-hidden="true" />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <Message
                icon={<FolderOpen size={22} aria-hidden="true" />}
                title="Aún no tienes proyectos"
                text="Crea tu primera nota o diagrama con las tarjetas de arriba."
              />
            ) : visible.length === 0 ? (
              <Message
                icon={<Search size={22} aria-hidden="true" />}
                title="Sin resultados"
                text={
                  query.trim()
                    ? `Ningún proyecto coincide con «${query.trim()}».`
                    : 'No hay proyectos de este tipo.'
                }
              >
                <Button
                  onClick={() => {
                    setQuery('');
                    setTab('all');
                  }}
                >
                  Ver todos
                </Button>
              </Message>
            ) : (
              <>
                <p className="sr-only" role="status">
                  {plural(visible.length)}
                </p>
                <ul className={styles.grid}>
                  {visible.map((p) => (
                    <ProjectCard key={p.id} project={p} now={now} />
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>

        {shared && shared.length > 0 ? <SharedProjects projects={shared} uid={user?.uid ?? ''} now={now} /> : null}
      </div>
    </Shell>
  );
}

function Message({
  icon,
  title,
  text,
  tone,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  tone?: 'error';
  children?: ReactNode;
}) {
  return (
    <div
      className={`${styles.message} ${tone === 'error' ? styles.error : ''}`}
      role={tone === 'error' ? 'alert' : undefined}
    >
      <span className={styles.messageIcon}>{icon}</span>
      <h3 className={styles.messageTitle}>{title}</h3>
      <p className={styles.messageText}>{text}</p>
      {children ? <div className={styles.messageActions}>{children}</div> : null}
    </div>
  );
}
