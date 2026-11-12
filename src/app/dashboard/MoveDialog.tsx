import { Folder as FolderIcon, Home } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { flatTree, type Folder } from '@/domain/folder';
import { Button, Dialog, DialogContent } from '@/ui';
import styles from './FolderView.module.css';

/**
 * «Mover a…»: árbol de carpetas (indentado) con «Sin carpeta (Inicio)». `exclude` quita las carpetas que no valen de
 * destino (la propia y sus descendientes). Radios nativos: flechas, espacio y Tab ya funcionan.
 */
export function MoveDialog({
  open,
  onOpenChange,
  title,
  folders,
  exclude,
  current,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  folders: readonly Folder[];
  exclude?: ReadonlySet<string>;
  /** Carpeta actual del elemento (`null` = Inicio): el botón no hace nada si se elige la misma. */
  current: string | null;
  onMove: (target: string | null) => Promise<void>;
}) {
  const [target, setTarget] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const options = flatTree(folders, exclude);
  // Cada vez que se abre (también desde el padre) la selección vuelve a la carpeta actual.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTarget(current);
      setFailed(false);
    }
  }

  async function move() {
    setBusy(true);
    setFailed(false);
    try {
      await onMove(target);
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o);
      }}
    >
      <DialogContent
        size="sm"
        title={title}
        footer={
          <>
            <Button disabled={busy} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" loading={busy} disabled={target === current} onClick={() => void move()}>
              Mover
            </Button>
          </>
        }
      >
        <div role="radiogroup" aria-label="Carpeta de destino" className={styles.tree}>
          <Option checked={target === null} onSelect={() => setTarget(null)} depth={0} icon={<Home size={16} />}>
            Sin carpeta (Inicio)
          </Option>
          {options.map(({ folder, depth }) => (
            <Option
              key={folder.id}
              checked={target === folder.id}
              onSelect={() => setTarget(folder.id)}
              depth={depth + 1}
              icon={<FolderIcon size={16} />}
            >
              {folder.name}
            </Option>
          ))}
        </div>
        {failed ? (
          <p role="alert" className={styles.formError}>
            No se pudo mover. Comprueba tu conexión e inténtalo de nuevo.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Option({
  checked,
  onSelect,
  depth,
  icon,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  depth: number;
  icon: ReactNode;
  children: string;
}) {
  return (
    <label className={styles.option} data-checked={checked || undefined} style={{ paddingInlineStart: `calc(var(--space-3) + ${depth} * var(--space-5))` }}>
      <input type="radio" name="destino" className={styles.radio} checked={checked} onChange={onSelect} />
      <span aria-hidden="true" className={styles.optionIcon}>
        {icon}
      </span>
      <span className={styles.optionName} title={children}>
        {children}
      </span>
    </label>
  );
}
