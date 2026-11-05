import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/ui';
import styles from './StatusPage.module.css';

interface State {
  error: Error | null;
}

/** Atrapa fallos de render y de carga de chunks (p. ej. tras un despliegue nuevo) con una salida clara. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error de pantalla:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={styles.page} role="alert">
        <p className={styles.code}>Error</p>
        <h1 className={styles.title}>Algo salió mal</h1>
        <p className={styles.text}>No se pudo mostrar esta pantalla. Recargar suele bastar.</p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Recargar
          </Button>
          <Button onClick={() => window.location.assign('/')}>Ir al panel</Button>
        </div>
      </div>
    );
  }
}
