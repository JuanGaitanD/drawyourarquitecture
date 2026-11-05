import { LoaderCircle } from 'lucide-react';
import styles from './PageFallback.module.css';

/** Fallback de carga de pantalla completa (rutas lazy, sesión, proyecto). */
export function PageFallback({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className={styles.page} role="status" aria-live="polite">
      <LoaderCircle className={styles.spinner} size={28} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </div>
  );
}
