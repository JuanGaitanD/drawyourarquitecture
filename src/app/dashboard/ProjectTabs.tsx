import { useRef, type KeyboardEvent } from 'react';
import type { Tab } from './filter';
import styles from './ProjectTabs.module.css';
import { TYPE_META } from './typeMeta';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'note', label: TYPE_META.note.plural },
  { id: 'board', label: TYPE_META.board.plural },
];

export const tabId = (t: Tab) => `tab-${t}`;
export const PANEL_ID = 'projects-panel';

/** Tabs con teclado completo: flechas, Inicio y Fin mueven y activan (patrón WAI-ARIA con foco itinerante). */
export function ProjectTabs({
  value,
  counts,
  onChange,
}: {
  value: Tab;
  counts: Record<Tab, number>;
  onChange: (t: Tab) => void;
}) {
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  function onKeyDown(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === value);
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next]!.id;
    onChange(id);
    refs.current[id]?.focus();
  }

  return (
    <div className={styles.tabs} role="tablist" aria-label="Tipo de proyecto" onKeyDown={onKeyDown}>
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          ref={(el) => {
            refs.current[id] = el;
          }}
          id={tabId(id)}
          type="button"
          role="tab"
          aria-selected={value === id}
          aria-controls={PANEL_ID}
          tabIndex={value === id ? 0 : -1}
          className={styles.tab}
          onClick={() => onChange(id)}
        >
          {label}
          <span className={styles.count}>{counts[id]}</span>
        </button>
      ))}
    </div>
  );
}
