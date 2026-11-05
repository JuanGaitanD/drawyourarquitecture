import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './Toast.module.css';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  kind?: ToastKind;
  /** Acción puntual, p. ej. «Reintentar». El toast con acción dura más. */
  action?: { label: string; onClick: () => void };
  /** Milisegundos hasta cerrarse solo; 0 = hasta que la persona lo cierre. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  kind: ToastKind;
}

interface ToastApi {
  toast: (o: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const MAX_VISIBLE = 4;
const DEFAULT_MS = 5000;
const ACTION_MS = 10000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback((o: ToastOptions) => {
    const id = next.current++;
    setItems((xs) => [...xs, { ...o, id, kind: o.kind ?? 'info' }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} role="region" aria-label="Notificaciones">
        {items.map((t) => (
          <ToastView key={t.id} item={t} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ICONS = { info: Info, success: CircleCheck, error: TriangleAlert } as const;

function ToastView({ item, dismiss }: { item: ToastItem; dismiss: (id: number) => void }) {
  const onClose = useCallback(() => dismiss(item.id), [dismiss, item.id]); // estable: no reinicia el temporizador
  const [paused, setPaused] = useState(false);
  const ms = item.duration ?? (item.action ? ACTION_MS : DEFAULT_MS);
  const Icon = ICONS[item.kind];

  useEffect(() => {
    if (paused || ms === 0) return;
    const t = setTimeout(onClose, ms);
    return () => clearTimeout(t);
  }, [paused, ms, onClose]);

  return (
    <div
      className={`${styles.toast} ${styles[item.kind]}`}
      // Los errores interrumpen al lector de pantalla; el resto espera su turno.
      role={item.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className={styles.kindIcon} size={18} aria-hidden="true" />
      <div className={styles.text}>
        <p className={styles.title}>{item.title}</p>
        {item.description ? <p className={styles.description}>{item.description}</p> : null}
      </div>
      {item.action ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            item.action?.onClick();
            onClose();
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button type="button" className={styles.close} aria-label="Cerrar notificación" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast necesita un <ToastProvider>.');
  return v;
}
