import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const QUERY = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemTheme = (): ResolvedTheme =>
  typeof matchMedia === 'function' && matchMedia(QUERY).matches ? 'dark' : 'light';

export const resolveTheme = (p: ThemePreference): ResolvedTheme => (p === 'system' ? systemTheme() : p);

function apply(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

interface ThemeValue {
  /** Lo que eligió la persona. */
  preference: ThemePreference;
  /** Lo que se aplica ahora: es lo que hay que pasar a Excalidraw (`theme`) y a React Flow (`colorMode`). */
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
  /** Alterna claro ↔ oscuro a partir de lo que se ve ahora. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readPreference()));

  useEffect(() => {
    const update = () => {
      const r = resolveTheme(preference);
      setResolved(r);
      apply(r);
    };
    update();
    if (preference !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia(QUERY);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* sin almacenamiento: el cambio vale solo para esta sesión */
    }
    setPref(p);
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      preference,
      resolved,
      setPreference,
      toggle: () => setPreference(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [preference, resolved, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme necesita un <ThemeProvider>.');
  return v;
}
