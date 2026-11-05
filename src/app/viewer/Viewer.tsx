import type { ProjectType } from '@/domain/project';
import { Stub } from '@/ui/Stub';
import { useNoindex } from '../hooks';

// STUB de T0. Lo sustituye el carril A (app/viewer/**): /view/:type/:id sin sesión, con NoteCanvas readonly
// o BoardViewer, y los mensajes «No existe o es privado» y «Error de red, reintentar». Debe seguir
// exportando `Viewer` y llamar a useNoindex().
export function Viewer({ type, id }: { type: ProjectType; id: string }) {
  useNoindex();
  return <Stub name={`Viewer ${type}/${id}`} lane="A" />;
}
