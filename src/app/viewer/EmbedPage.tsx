import { Stub } from '@/ui/Stub';
import { useNoindex } from '../hooks';

// STUB de T0. Lo sustituye el carril A: /embed/board/:id con BoardViewer a pantalla completa y sin chrome.
// Debe seguir exportando `EmbedPage`.
export function EmbedPage({ id }: { id: string }) {
  useNoindex();
  return <Stub name={`EmbedPage ${id}`} lane="A" />;
}
