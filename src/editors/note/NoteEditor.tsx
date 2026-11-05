import { Stub } from '@/ui/Stub';

// STUB de T0 (firma final). Lo implementa el carril B: carga, autosave (useAutosave), título, estado de
// guardado, recuperar borrador, compartir y volver. La ruta lo monta con `key={id}`.
export interface NoteEditorProps {
  id: string;
}

export function NoteEditor({ id }: NoteEditorProps) {
  return <Stub name={`NoteEditor ${id}`} lane="B" />;
}
