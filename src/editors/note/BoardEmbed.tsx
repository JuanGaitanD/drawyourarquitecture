import { Stub } from '@/ui/Stub';

// STUB de T0 (firma final). Lo implementa el carril B: carga el board una vez y muestra BoardViewer con
// «Abrir» y «Recargar». Si no hay acceso, «Diagrama privado o inexistente». `depth` corta la recursión.
export interface BoardEmbedProps {
  boardId: string;
  depth?: number;
}

export function BoardEmbed(_props: BoardEmbedProps) {
  return <Stub name="BoardEmbed" lane="B" />;
}
