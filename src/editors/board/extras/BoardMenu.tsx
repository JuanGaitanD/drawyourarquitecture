import type { RefObject } from 'react';
import { Stub } from '@/ui/Stub';

// STUB de T0 (firma final). Lo implementa el carril D: Mermaid (importar y exportar), plantillas,
// ordenar automáticamente, PNG y JSON. `viewportRef` apunta al contenedor del editor para exportar el PNG.
export interface BoardMenuProps {
  title: string;
  viewportRef: RefObject<HTMLElement | null>;
}

export function BoardMenu(_props: BoardMenuProps) {
  return <Stub name="BoardMenu" lane="D" />;
}
