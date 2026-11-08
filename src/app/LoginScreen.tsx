import { FlaskConical, TriangleAlert } from 'lucide-react';
import { Button } from '@/ui';
import { useAuth } from './hooks';
import { USE_EMULATORS, isFirebaseConfigured } from './services';
import { LogoMark } from './shell/Logo';
import { ThemeToggle } from './shell/Shell';
import styles from './LoginScreen.module.css';

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"
      />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

/** Dibujo decorativo: un mini diagrama de arquitectura con los tokens del tema. */
function Diagram() {
  return (
    <svg className={styles.diagram} viewBox="0 0 320 120" fill="none" aria-hidden="true" focusable="false">
      <g stroke="var(--border-strong)" strokeWidth="1.5" strokeLinecap="round">
        <path d="M86 60h42" />
        <path d="M192 60h42" />
        <path d="M160 36V22h60" strokeDasharray="3 4" />
      </g>
      <g fill="var(--accent)">
        <path d="M128 60l-6-3.5v7zM234 60l-6-3.5v7z" />
      </g>
      <rect
        x="14"
        y="40"
        width="72"
        height="40"
        rx="10"
        fill="var(--surface-raised)"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      <rect
        x="128"
        y="36"
        width="64"
        height="48"
        rx="12"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <ellipse
        cx="270"
        cy="52"
        rx="26"
        ry="8"
        fill="var(--surface-raised)"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      <path
        d="M244 52v16c0 4.4 11.6 8 26 8s26-3.6 26-8V52"
        fill="var(--surface-raised)"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      <ellipse
        cx="270"
        cy="52"
        rx="26"
        ry="8"
        fill="var(--surface-raised)"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      <rect
        x="220"
        y="12"
        width="46"
        height="20"
        rx="6"
        fill="var(--surface-raised)"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      <g fill="var(--text-faint)">
        <rect x="26" y="56" width="36" height="5" rx="2.5" />
        <rect x="26" y="66" width="22" height="4" rx="2" opacity="0.6" />
        <rect x="228" y="19" width="28" height="5" rx="2.5" />
      </g>
      <rect x="140" y="54" width="40" height="5" rx="2.5" fill="var(--accent)" />
      <rect x="140" y="64" width="26" height="4" rx="2" fill="var(--accent)" opacity="0.5" />
    </svg>
  );
}

export function LoginScreen() {
  const { signIn, signingIn, error } = useAuth();
  return (
    <div className={styles.page}>
      <div className={styles.corner}>
        <ThemeToggle />
      </div>
      <main className={styles.card}>
        <Diagram />
        <div className={styles.brand}>
          <LogoMark size={36} />
          <h1 className={styles.title}>DYA</h1>
        </div>
        <p className={styles.lead}>Draw your Architecture: notas libres y diagramas de arquitectura, en un solo lugar.</p>

        {!isFirebaseConfigured ? (
          <div className={styles.notice} role="alert">
            <TriangleAlert size={18} aria-hidden="true" />
            <p>
              Falta configurar Firebase. Copia <code>.env.example</code> a <code>.env</code> y rellena los{' '}
              <code>VITE_FIREBASE_*</code>, o arranca con <code>VITE_USE_EMULATORS=1</code>.
            </p>
          </div>
        ) : null}

        <Button
          variant="primary"
          loading={signingIn}
          disabled={!isFirebaseConfigured}
          icon={USE_EMULATORS ? <FlaskConical size={18} /> : <GoogleG />}
          onClick={() => void signIn()}
          className={styles.cta}
        >
          {USE_EMULATORS ? 'Entrar con la cuenta de prueba' : 'Continuar con Google'}
        </Button>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {USE_EMULATORS ? (
          <p className={styles.hint}>Modo emuladores: nada de esto toca Firebase real.</p>
        ) : null}

        <p className={styles.foot}>Solo el dueño crea y edita. Los enlaces públicos son de solo lectura.</p>
      </main>
    </div>
  );
}
