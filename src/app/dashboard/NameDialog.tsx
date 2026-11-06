import { useRef, useState, type FormEvent } from 'react';
import { MAX_FOLDER_NAME_LENGTH, normalizeFolderName } from '@/domain/folder';
import { Button, Dialog, DialogContent } from '@/ui';
import styles from './FolderView.module.css';

/** Diálogo con un campo de nombre (crear y renombrar carpetas). `onSubmit` recibe el nombre normalizado. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  initial = '',
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const name = normalizeFolderName(value);
  // Cada vez que se abre (también desde el padre) el formulario vuelve a su valor inicial.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValue(initial);
      setFailed(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name === '' || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(name);
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
      <DialogContent size="sm" title={title} initialFocus={inputRef}>
        <form className={styles.nameForm} onSubmit={(e) => void submit(e)}>
          <input
            ref={inputRef}
            className={styles.nameInput}
            value={value}
            maxLength={MAX_FOLDER_NAME_LENGTH}
            aria-label="Nombre de la carpeta"
            placeholder="Nombre de la carpeta"
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          {failed ? (
            <p role="alert" className={styles.formError}>
              No se pudo guardar. Comprueba tu conexión e inténtalo de nuevo.
            </p>
          ) : null}
          <div className={styles.formActions}>
            <Button disabled={busy} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={name === ''}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
