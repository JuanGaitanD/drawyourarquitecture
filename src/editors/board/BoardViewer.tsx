import { Stub } from '@/ui/Stub';
import type { BoardContent } from './model/board';

// STUB de T0 (firma final). Lo implementa el carril C1: React Flow de solo lectura con su propio store
// (invariantes 6 y 7: nodesDraggable, nodesConnectable, elementsSelectable y edgesReconnectable en false).
export interface BoardViewerProps {
  content: BoardContent;
}

export function BoardViewer(_props: BoardViewerProps) {
  return <Stub name="BoardViewer" lane="C1" />;
}
