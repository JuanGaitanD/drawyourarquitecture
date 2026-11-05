import { Stub } from '@/ui/Stub';

// STUB de T0 (firma final). Lo implementa el carril C1: carga, validación, hidratación, autosave y cabecera,
// con las ranuras de C2 (ui/) y D (extras/). La ruta lo monta con `key={id}`.
export interface BoardEditorProps {
  id: string;
}

export function BoardEditor({ id }: BoardEditorProps) {
  return <Stub name={`BoardEditor ${id}`} lane="C1" />;
}
