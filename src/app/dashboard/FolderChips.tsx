import { Ellipsis, Folder as FolderIcon, FolderInput, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { childrenOf, descendants, type Folder } from '@/domain/folder';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  useReturnFocus,
  useToast,
} from '@/ui';
import { createFolder, deleteFolder, moveFolder, renameFolder } from '../services';
import styles from './FolderView.module.css';
import { MoveDialog } from './MoveDialog';
import { NameDialog } from './NameDialog';

const plural = (n: number) => `${n} ${n === 1 ? 'elemento' : 'elementos'}`;

/** «Carpetas»: las subcarpetas de `parentId` (`null` = Inicio) como chips que se ajustan en varias líneas. */
export function FolderChips({
  parentId,
  folders,
  counts,
  failed,
}: {
  parentId: string | null;
  folders: readonly Folder[];
  /** Elementos de cada carpeta (proyectos + subcarpetas), por id. */
  counts: ReadonlyMap<string, number>;
  /** La suscripción a las carpetas falló: el panel sigue con los proyectos. */
  failed?: boolean;
}) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const newRef = useRef<HTMLButtonElement>(null);
  useReturnFocus(creating, newRef);
  const chips = childrenOf(folders, parentId);

  return (
    <section aria-labelledby="carpetas-titulo" className={styles.folders}>
      <h2 id="carpetas-titulo" className={styles.heading}>
        Carpetas
      </h2>
      {failed ? (
        <p role="alert" className={styles.note}>
          No se pudieron cargar las carpetas. Tus proyectos siguen disponibles.
        </p>
      ) : (
        <ul className={styles.chips}>
          {chips.map((f) => (
            <FolderChip key={f.id} folder={f} folders={folders} count={counts.get(f.id) ?? 0} />
          ))}
          <li>
            <button ref={newRef} type="button" className={styles.newChip} onClick={() => setCreating(true)}>
              <FolderPlus size={16} aria-hidden="true" />
              Nueva carpeta
            </button>
          </li>
        </ul>
      )}
      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="Nueva carpeta"
        submitLabel="Crear"
        onSubmit={async (name) => {
          await createFolder(name, parentId);
          toast({ kind: 'success', title: 'Carpeta creada', description: `«${name}»` });
        }}
      />
    </section>
  );
}

function FolderChip({ folder, folders, count }: { folder: Folder; folders: readonly Folder[]; count: number }) {
  const { toast } = useToast();
  const [dialog, setDialog] = useState<'rename' | 'move' | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Los diálogos se abren desde un menú: al cerrarlos el foco vuelve al botón de opciones, no al cuerpo.
  useReturnFocus(dialog !== null, triggerRef);

  async function remove() {
    try {
      await deleteFolder(folder.id);
      toast({ kind: 'success', title: 'Carpeta borrada' });
    } catch {
      toast({
        kind: 'error',
        title: 'No se pudo borrar',
        description: 'Comprueba tu conexión e inténtalo de nuevo.',
        action: { label: 'Reintentar', onClick: () => void remove() },
      });
    }
  }

  return (
    <li className={styles.chip}>
      <Link href={`/folder/${folder.id}`} className={styles.chipLink}>
        <FolderIcon size={16} aria-hidden="true" />
        <span className={styles.chipName}>{folder.name}</span>
        <span className={styles.count} aria-hidden="true">
          {count}
        </span>
        <span className="sr-only">, {plural(count)}</span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            ref={triggerRef}
            label={`Opciones de la carpeta «${folder.name}»`}
            icon={<Ellipsis size={16} />}
            size="sm"
            tooltipSide="bottom"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<Pencil size={16} />} onSelect={() => setDialog('rename')}>
            Renombrar
          </DropdownMenuItem>
          <DropdownMenuItem icon={<FolderInput size={16} />} onSelect={() => setDialog('move')}>
            Mover a…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            danger
            icon={<Trash2 size={16} />}
            disabled={count > 0}
            onSelect={() => void remove()}
          >
            Borrar
          </DropdownMenuItem>
          {count > 0 ? <DropdownMenuLabel>Mueve o borra su contenido primero</DropdownMenuLabel> : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <NameDialog
        open={dialog === 'rename'}
        onOpenChange={(o) => setDialog(o ? 'rename' : null)}
        title={`Renombrar «${folder.name}»`}
        initial={folder.name}
        submitLabel="Guardar"
        onSubmit={(name) => (name === folder.name ? Promise.resolve() : renameFolder(folder.id, name))}
      />
      <MoveDialog
        open={dialog === 'move'}
        onOpenChange={(o) => setDialog(o ? 'move' : null)}
        title={`Mover «${folder.name}»`}
        folders={folders}
        exclude={new Set([folder.id, ...descendants(folders, folder.id)])}
        current={folder.parentId}
        onMove={async (target) => {
          await moveFolder(folders, folder.id, target);
          toast({ kind: 'success', title: 'Carpeta movida' });
        }}
      />
    </li>
  );
}
