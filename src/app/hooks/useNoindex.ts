import { useEffect } from 'react';

/** Inyecta `<meta name="robots" content="noindex">` mientras la vista pública está montada. */
export function useNoindex(): void {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}
