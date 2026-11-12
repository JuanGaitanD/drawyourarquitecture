import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { IconButton, Input } from '@/ui';
import { selectOnly } from '../model/ops';
import { useBoard, useBoardStore } from '../store/BoardStoreProvider';
import { motionDuration } from './actions';
import chrome from './chrome.module.css';
import { kbd } from './keys';
import styles from './SearchBox.module.css';
import { SEARCH_EVENT } from './useShortcuts';

/** Minúsculas y sin acentos: «Cola» encuentra «cola» y «Autenticación» encuentra «autenticacion». */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Búsqueda por texto de los nodos. Mod+F (con el editor enfocado) la abre; Enter pasa a la siguiente
 * coincidencia y Mayús+Enter a la anterior, seleccionándola y centrándola con fitView; Esc cierra.
 * Debe montarse dentro de <ReactFlowProvider>.
 */
export function SearchBox() {
  const [open, setOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    if (!open) returnFocus.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, [open]);
  const hide = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus();
  }, []);

  useEffect(() => {
    window.addEventListener(SEARCH_EVENT, show);
    return () => window.removeEventListener(SEARCH_EVENT, show);
  }, [show]);

  if (!open) {
    return (
      <div className={`${chrome.bar} ${styles.box}`}>
        <IconButton
          label="Buscar en el diagrama"
          shortcut={kbd('F', { mod: true })}
          icon={<Search size={20} />}
          tooltipSide="left"
          onClick={show}
        />
      </div>
    );
  }
  return <SearchField onClose={hide} />;
}

function SearchField({ onClose }: { onClose: () => void }) {
  const store = useBoardStore();
  const flow = useReactFlow();
  const nodes = useBoard((s) => s.nodes);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const q = norm(query.trim());
  const matches = useMemo(
    () => (q ? nodes.filter((n) => n.data.label && norm(n.data.label).includes(q)).map((n) => n.id) : []),
    [nodes, q],
  );

  const goTo = (step: 1 | -1) => {
    if (!matches.length) return;
    const next = (index + step + matches.length) % matches.length;
    const id = matches[next];
    setIndex(next);
    store.getState().setNodes((ns) => selectOnly(ns, [id]));
    void flow.fitView({ nodes: [{ id }], padding: 0.6, maxZoom: 1.5, duration: motionDuration() });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      goTo(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      input.current?.select();
    }
  };

  const status = !q
    ? ''
    : matches.length === 0
      ? 'Sin resultados'
      : index < 0
        ? `${matches.length} ${matches.length === 1 ? 'coincidencia' : 'coincidencias'}`
        : `${index + 1} de ${matches.length}`;

  return (
    <div role="search" className={`${chrome.bar} ${styles.box} ${styles.open}`}>
      <span className={styles.field}>
        <Search size={16} className={styles.glyph} aria-hidden="true" />
        <Input
          ref={input}
          type="search"
          size="sm"
          className={styles.input}
          placeholder="Buscar texto…"
          aria-label="Buscar en el diagrama"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </span>
      <span className={styles.status} role="status" aria-live="polite">
        {status}
      </span>
      <IconButton
        size="sm"
        label="Coincidencia anterior"
        shortcut="Shift+Enter"
        icon={<ChevronUp size={16} />}
        disabled={!matches.length}
        onClick={() => goTo(-1)}
      />
      <IconButton
        size="sm"
        label="Coincidencia siguiente"
        shortcut="Enter"
        icon={<ChevronDown size={16} />}
        disabled={!matches.length}
        onClick={() => goTo(1)}
      />
      <IconButton size="sm" label="Cerrar búsqueda" shortcut="Esc" icon={<X size={16} />} onClick={onClose} />
    </div>
  );
}
