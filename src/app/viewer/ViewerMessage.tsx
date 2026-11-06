import { EyeOff, WifiOff } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/ui';
import styles from './Viewer.module.css';

interface Props {
  /** `compact` es para el embed: sin enlace al panel, que no tiene sentido dentro de otra página. */
  compact?: boolean;
}

/** Proyecto inexistente o privado (las reglas de Firestore los hacen indistinguibles). */
export function MissingMessage({ compact, text = 'No existe o es privado' }: Props & { text?: string }) {
  return (
    <div className={styles.message} role="status">
      <span className={styles.icon}>
        <EyeOff size={22} aria-hidden="true" />
      </span>
      <h1 className={styles.title}>{text}</h1>
      <p className={styles.text}>
        El enlace puede estar mal escrito, o quien lo compartió ya no lo hace público.
      </p>
      {compact ? null : (
        <Link href="/" className={styles.link}>
          Ir a DYA
        </Link>
      )}
    </div>
  );
}

/** Fallo de red o de lectura: se puede reintentar. */
export function NetworkErrorMessage({ retry }: { retry: () => void }) {
  return (
    <div className={`${styles.message} ${styles.error}`} role="alert">
      <span className={styles.icon}>
        <WifiOff size={22} aria-hidden="true" />
      </span>
      <h1 className={styles.title}>Error de red</h1>
      <p className={styles.text}>No se pudo cargar el proyecto. Comprueba tu conexión y reintenta.</p>
      <Button variant="primary" onClick={retry}>
        Reintentar
      </Button>
    </div>
  );
}
