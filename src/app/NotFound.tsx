import { useLocation } from 'wouter';
import { Button } from '@/ui';
import styles from './StatusPage.module.css';

export function NotFound() {
  const [, navigate] = useLocation();
  return (
    <div className={styles.page}>
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>Esta página no existe</h1>
      <p className={styles.text}>El enlace puede estar mal escrito o el proyecto ya no está.</p>
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => navigate('/')}>
          Ir al panel
        </Button>
      </div>
    </div>
  );
}
