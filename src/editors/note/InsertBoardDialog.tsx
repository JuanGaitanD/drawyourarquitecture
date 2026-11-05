import { LayoutDashboard, Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth, useMyProjects } from '@/app/hooks';
import { createProject } from '@/app/services';
import { Button, Dialog, DialogContent, useToast } from '@/ui';
import styles from './InsertBoardDialog.module.css';

export interface InsertBoardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Inserta el diagrama elegido en la nota. */
  onPick: (boardId: string) => void;
  /** «Abrir» del aviso tras crear un diagrama nuevo. */
  onOpenBoard: (boardId: string) => void;
}

const dateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });

export function InsertBoardDialog({ open, onOpenChange, onPick, onOpenBoard }: InsertBoardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <Body onClose={() => onOpenChange(false)} onPick={onPick} onOpenBoard={onOpenBoard} /> : null}
    </Dialog>
  );
}

function Body({
  onClose,
  onPick,
  onOpenBoard,
}: {
  onClose: () => void;
  onPick: (id: string) => void;
  onOpenBoard: (id: string) => void;
}) {
  const { user } = useAuth();
  const { projects, error, retry } = useMyProjects(user?.uid ?? null);
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const boards = projects?.filter((p) => p.type === 'board') ?? null;

  const pick = (id: string) => {
    onPick(id);
    onClose();
  };

  const create = async () => {
    setCreating(true);
    try {
      const id = await createProject('board');
      pick(id);
      toast({
        kind: 'success',
        title: 'Diagrama creado e insertado',
        description: 'Está vacío: ábrelo para dibujarlo.',
        action: { label: 'Abrir', onClick: () => onOpenBoard(id) },
      });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'No se pudo crear el diagrama',
        description: e instanceof Error ? e.message : undefined,
      });
      setCreating(false);
    }
  };

  return (
    <DialogContent
      title="Insertar diagrama"
      description="El diagrama se muestra en solo lectura dentro de la nota y sigue siendo el mismo: si lo editas, recarga el embed."
      size="md"
      footer={
        <Button variant="primary" icon={<Plus size={16} />} loading={creating} onClick={() => void create()}>
          Nuevo diagrama
        </Button>
      }
    >
      {error ? (
        <div className={styles.state} role="alert">
          <p>No se pudieron cargar tus diagramas.</p>
          <Button size="sm" onClick={retry}>
            Reintentar
          </Button>
        </div>
      ) : boards === null ? (
        <p className={styles.state} role="status">
          Cargando tus diagramas…
        </p>
      ) : boards.length === 0 ? (
        <p className={styles.state}>Aún no tienes diagramas. Crea uno nuevo para insertarlo.</p>
      ) : (
        <ul className={styles.list} aria-label="Tus diagramas">
          {boards.map((b) => (
            <li key={b.id}>
              <button type="button" className={styles.item} onClick={() => pick(b.id)}>
                <span className={styles.icon} aria-hidden="true">
                  <LayoutDashboard size={18} />
                </span>
                <span className={styles.name}>{b.title}</span>
                <span className={styles.date}>{dateFmt.format(b.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DialogContent>
  );
}
