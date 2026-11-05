import type { ReactNode } from 'react';
import { useAuth } from './hooks';
import { LoginScreen } from './LoginScreen';
import { PageFallback } from './PageFallback';

/** Muestra el contenido solo con sesión; mientras Firebase resuelve la sesión, el fallback de carga. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();
  if (loading) return <PageFallback label="Comprobando sesión…" />;
  if (!user) return <LoginScreen />;
  return <>{children}</>;
}
