import { Stub } from '@/ui/Stub';
import type { NoteContent } from './codec';

// STUB de T0 (firma final). Lo implementa el carril B: <Excalidraw> lazy, hidratación, archivos y embeds.
// Con `readonly` usa viewModeEnabled y también resuelve archivos y embeds.
export interface NoteCanvasProps {
  projectId: string;
  content: NoteContent;
  readonly: boolean;
  onChange?: (content: NoteContent) => void;
}

export function NoteCanvas(_props: NoteCanvasProps) {
  return <Stub name="NoteCanvas" lane="B" />;
}
