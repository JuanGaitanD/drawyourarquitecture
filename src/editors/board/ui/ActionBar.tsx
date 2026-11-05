import { useStore } from 'zustand';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Frame,
  Grid3x3,
  Lock,
  LockOpen,
  Magnet,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@/ui';
import { useBoard, useBoardStore } from '../store/BoardStoreProvider';
import { useBoardActions } from './actions';
import styles from './ActionBar.module.css';
import chrome from './chrome.module.css';
import { kbd } from './keys';
import { useSelectedEdges, useSelectedNodes } from './useSelection';

/**
 * Barra inferior: deshacer/rehacer, duplicar, borrar, orden Z, alinear y distribuir, marco, bloqueo y
 * cuadrícula. Debe montarse dentro de <ReactFlowProvider> y del BoardStoreProvider.
 */
export function ActionBar() {
  const store = useBoardStore();
  const actions = useBoardActions();
  const canUndo = useStore(store.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(store.temporal, (s) => s.futureStates.length > 0);
  const gridOn = useBoard((s) => s.gridOn);
  const snapOn = useBoard((s) => s.snapOn);
  const lockedCount = useBoard((s) => s.nodes.filter((n) => n.data.locked).length);
  const nodes = useSelectedNodes();
  const edges = useSelectedEdges();

  const count = nodes.length;
  const hasSelection = count + edges.length > 0;
  const allLocked = count > 0 && nodes.every((n) => n.data.locked);
  // Los bloqueados no pueden seleccionarse en el lienzo: sin selección, el botón desbloquea todo.
  const unlockMode = count === 0 && lockedCount > 0;
  const lockLabel = unlockMode
    ? `Desbloquear todo (${lockedCount})`
    : allLocked
      ? 'Desbloquear selección'
      : 'Bloquear selección';

  return (
    <div role="toolbar" aria-label="Acciones del diagrama" className={`${chrome.bar} ${styles.bar}`}>
      <IconButton
        label="Deshacer"
        shortcut={kbd('Z', { mod: true })}
        icon={<Undo2 size={20} />}
        disabled={!canUndo}
        tooltipSide="top"
        onClick={actions.undo}
      />
      <IconButton
        label="Rehacer"
        shortcut={kbd('Z', { mod: true, shift: true })}
        icon={<Redo2 size={20} />}
        disabled={!canRedo}
        tooltipSide="top"
        onClick={actions.redo}
      />
      <div className={chrome.divider} role="separator" />
      <IconButton
        label="Duplicar"
        shortcut={kbd('D', { mod: true })}
        icon={<Copy size={20} />}
        disabled={count === 0}
        tooltipSide="top"
        onClick={actions.duplicate}
      />
      <IconButton
        label="Eliminar"
        shortcut="Supr"
        icon={<Trash2 size={20} />}
        disabled={!hasSelection}
        tooltipSide="top"
        onClick={actions.remove}
      />
      <div className={chrome.divider} role="separator" />
      <IconButton
        label="Traer al frente"
        shortcut={kbd(']', { mod: true, shift: true })}
        icon={<ArrowUpToLine size={20} />}
        disabled={count === 0}
        tooltipSide="top"
        onClick={actions.bringToFront}
      />
      <IconButton
        label="Enviar al fondo"
        shortcut={kbd('[', { mod: true, shift: true })}
        icon={<ArrowDownToLine size={20} />}
        disabled={count === 0}
        tooltipSide="top"
        onClick={actions.sendToBack}
      />
      <DropdownMenu>
        <IconButtonMenuTrigger disabled={count < 2} />
        <DropdownMenuContent side="top" align="center">
          <DropdownMenuLabel>Alinear</DropdownMenuLabel>
          <DropdownMenuItem icon={<AlignStartVertical size={16} />} onSelect={() => actions.align('left')}>
            A la izquierda
          </DropdownMenuItem>
          <DropdownMenuItem icon={<AlignCenterVertical size={16} />} onSelect={() => actions.align('center')}>
            Al centro
          </DropdownMenuItem>
          <DropdownMenuItem icon={<AlignEndVertical size={16} />} onSelect={() => actions.align('right')}>
            A la derecha
          </DropdownMenuItem>
          <DropdownMenuItem icon={<AlignStartHorizontal size={16} />} onSelect={() => actions.align('top')}>
            Arriba
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<AlignCenterHorizontal size={16} />}
            onSelect={() => actions.align('middle')}
          >
            Al medio
          </DropdownMenuItem>
          <DropdownMenuItem icon={<AlignEndHorizontal size={16} />} onSelect={() => actions.align('bottom')}>
            Abajo
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Distribuir (3 o más)</DropdownMenuLabel>
          <DropdownMenuItem
            icon={<AlignHorizontalSpaceBetween size={16} />}
            disabled={count < 3}
            onSelect={() => actions.distribute('x')}
          >
            Horizontalmente
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<AlignVerticalSpaceBetween size={16} />}
            disabled={count < 3}
            onSelect={() => actions.distribute('y')}
          >
            Verticalmente
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className={chrome.divider} role="separator" />
      <IconButton
        label="Marco alrededor de la selección"
        shortcut={kbd('G', { mod: true })}
        icon={<Frame size={20} />}
        disabled={count === 0}
        tooltipSide="top"
        onClick={actions.group}
      />
      <IconButton
        label={lockLabel}
        shortcut={kbd('L', { mod: true })}
        icon={allLocked || unlockMode ? <LockOpen size={20} /> : <Lock size={20} />}
        disabled={count === 0 && !unlockMode}
        tooltipSide="top"
        onClick={actions.toggleLock}
      />
      <div className={chrome.divider} role="separator" />
      <IconButton
        label="Cuadrícula"
        shortcut={kbd("'", { mod: true })}
        icon={<Grid3x3 size={20} />}
        pressed={gridOn}
        tooltipSide="top"
        onClick={actions.toggleGrid}
      />
      <IconButton
        label="Ajustar a la cuadrícula"
        icon={<Magnet size={20} />}
        pressed={snapOn}
        tooltipSide="top"
        onClick={actions.toggleSnap}
      />
    </div>
  );
}

function IconButtonMenuTrigger({ disabled }: { disabled: boolean }) {
  return (
    <DropdownMenuTrigger asChild disabled={disabled}>
      <IconButton
        label="Alinear y distribuir"
        icon={<AlignStartVertical size={20} />}
        disabled={disabled}
        tooltipSide="top"
      />
    </DropdownMenuTrigger>
  );
}
