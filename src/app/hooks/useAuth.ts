import { useCallback, useEffect, useState } from 'react';
import type { AuthUser } from '@/application/ports';
import { identity } from '../services';

export interface AuthState {
  /** `true` hasta que Firebase resuelve la sesión: no se pinta el acceso antes de saber si hay sesión. */
  loading: boolean;
  user: AuthUser | null;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<{ loading: boolean; user: AuthUser | null }>({ loading: true, user: null });
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => identity.onChange((user) => setSession({ loading: false, user })), []);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    setError(null);
    try {
      await identity.signIn();
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      // Cerrar la ventana de Google no es un error que haya que enseñar.
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setError(code === 'auth/network-request-failed' ? 'No hay conexión con Google. Reintenta.' : 'No se pudo iniciar sesión. Reintenta.');
      }
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(() => identity.signOut(), []);

  return { ...session, signingIn, error, signIn, signOut };
}
