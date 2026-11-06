import { FolderOpen, FolderX, Search, TriangleAlert, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { path } from '@/domain/folder';
import { Button } from '@/ui';
import { useAuth, useMyFolders, useMyProjects, useSharedProjects } from '../hooks';
import { Shell } from '../shell/Shell';
import { Breadcrumbs } from './Breadcrumbs';
import styles from './Dashboard.module.css';
import { countByTab, filterProjects, itemCounts, projectsIn, type Tab } from './filter';
import { FolderChips } from './FolderChips';
import { FolderNewButtons } from './FolderNewButtons';
import folderStyles from './FolderView.module.css';
import { NewProject } from './NewProject';
import { ProjectCard } from './ProjectCard';
import { SharedProjects } from './SharedProjects';
import { PANEL_ID, ProjectTabs, tabId } from './ProjectTabs';
import { useNow } from './useNow';

const plural = (n: number) => `${n} ${n === 1 ? 'proyecto' : 'proyectos'}`;

/** Panel de Inicio (`folderId` ausente) o de una carpeta (`/folder/:id`). */
export function Dashboard({ folderId = null }: { folderId?: string | null }) {
  const { user } = useAuth();
  const { projects, error, retry } = useMyProjects(user?.uid ?? null);
  const { folders: loadedFolders, error: foldersError } = useMyFolders(user?.uid ?? null);
  const shared = useSharedProjects(user?.uid ?? null);
  const now = useNow();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [shownFolder, setShownFolder] = useState(folderId);
  // Al cambiar de carpeta la búsqueda se limpia (ajuste durante el render, sin efecto).
  if (shownFolder !== folderId) {
    setShownFolder(folderId);
    setQuery('');
  }

  const folders = useMemo(() => loadedFolders ?? [], [loadedFolders]);
  const searching = query.trim() !== '';
  const trail = folderId && loadedFolders ? path(folders, folderId) : null;
  const current = trail?.[trail.length - 1];
  const missing = folderId !== null && loadedFolders !== null && !trail;
  // Con texto, la búsqueda cruza todas las carpetas; sin él, solo lo que hay en esta.
  const scoped = useMemo(
    () => (searching ? (projects ?? []) : projectsIn(projects ?? [], folderId, folders)),
    [projects, folders, folderId, searching],
  );
  const counts = useMemo(() => countByTab(scoped), [scoped]);
  const visible = useMemo(() => filterProjects(scoped, tab, query), [scoped, tab, query]);
  const itemsByFolder = useMemo(() => itemCounts(projects ?? [], folders), [projects, folders]);
  const labelOf = (id: string | null | undefined) =>
    id && searching
      ? path(folders, id)
          ?.map((f) => f.name)
          .join(' / ')
      : undefined;
  const firstName = user?.name.trim().split(/\s+/)[0];

  const empty =
    folderId !== null
      ? {
          title: 'Esta carpeta no tiene proyectos',
          text: 'Crea una nota o un diagrama con los botones de arriba, o mueve aquí proyectos desde su menú.',
        }
      : projects?.length === 0
        ? { title: 'Aún no tienes proyectos', text: 'Crea tu primera nota o diagrama con las tarjetas de arriba.' }
        : { title: 'No hay proyectos sueltos', text: 'Todos tus proyectos están dentro de carpetas.' };

  return (
    <Shell>
      <div className={styles.page}>
        {folderId === null ? (
          <header className={styles.hero}>
            <h1 className={styles.title}>{firstName ? `Hola, ${firstName}` : 'Hola'}</h1>
            <p className={styles.subtitle}>Dibuja una idea o diseña una arquitectura.</p>
          </header>
        ) : trail && current ? (
          <header className={styles.hero}>
            <Breadcrumbs trail={trail} />
            <div className={folderStyles.folderHead}>
              <h1 className={styles.title}>{current.name}</h1>
              <FolderNewButtons folderId={current.id} folderName={current.name} />
            </div>
          </header>
        ) : null}

        {missing ? (
          <Message
            icon={<FolderX size={22} aria-hidden="true" />}
            title="Esta carpeta no existe"
            text="Puede que la hayan borrado o que el enlace no sea correcto."
          >
            <Link href="/" className={folderStyles.crumbLink}>
              Ir a Inicio
            </Link>
          </Message>
        ) : (
          <>
            {folderId === null ? <NewProject /> : null}
            {folderId === null || current ? (
              <FolderChips
                parentId={folderId}
                folders={folders}
                counts={itemsByFolder}
                failed={foldersError !== null}
              />
            ) : null}

            <section aria-labelledby="proyectos-titulo" className={styles.projects}>
              <div className={styles.toolbar}>
                <h2 id="proyectos-titulo" className={styles.heading}>
                  {searching ? 'Todos tus proyectos' : 'Tus proyectos'}
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
                ) : projects === null || (folderId !== null && loadedFolders === null) ? (
                  <div className={styles.grid} aria-busy="true">
                    <p className="sr-only" role="status">
                      Cargando proyectos…
                    </p>
                    {Array.from({ length: 6 }, (_, i) => (
                      <div key={i} className={styles.skeleton} aria-hidden="true" />
                    ))}
                  </div>
                ) : scoped.length === 0 ? (
                  <Message icon={<FolderOpen size={22} aria-hidden="true" />} title={empty.title} text={empty.text} />
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
                        <ProjectCard
                          key={p.id}
                          project={p}
                          now={now}
                          folders={folders}
                          folderLabel={labelOf(p.folderId)}
                        />
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </section>
          </>
        )}

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
