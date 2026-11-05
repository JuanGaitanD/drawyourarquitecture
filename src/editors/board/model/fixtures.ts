import { emptyBoard, makeEdge, makeNode, type BoardContent, type BoardEdge, type BoardNode } from './board';

// Fixture compartido por los tests de todos los carriles (invariante 5). Ids estables y legibles;
// los objetos salen de makeNode/makeEdge y solo se sobrescribe el id.

const withId = <T extends BoardNode | BoardEdge>(x: T, id: string): T => ({ ...x, id });

/**
 * Un frame «backend» en (100, 100) con dos formas hijas (posiciones relativas), un sticky suelto y
 * un texto, unidos por tres aristas (una con etiqueta, una que cruza el frame).
 *
 *   user(icon) ──"HTTPS"──▶ api ──▶ db        (api y db dentro del frame)
 *   note(sticky) y title(text) sueltos
 */
export function fixtureBoard(): BoardContent {
  const frame = withId(makeNode('frame', { x: 100, y: 100 }, { label: 'Backend' }), 'frame');
  const api = withId(
    makeNode('shape', { x: 40, y: 60 }, { label: 'API', shape: 'round_rectangle' }),
    'api',
  );
  const db = withId(makeNode('shape', { x: 280, y: 60 }, { label: 'Base de datos', shape: 'cylinder' }), 'db');
  api.parentId = 'frame';
  db.parentId = 'frame';
  const user = withId(makeNode('icon', { x: -200, y: 120 }, { label: 'Usuario', icon: 'user' }), 'user');
  const note = withId(makeNode('sticky', { x: 100, y: 500 }, { label: 'Revisar límites' }), 'note');
  const title = withId(makeNode('text', { x: 100, y: 40 }, { label: 'Arquitectura' }), 'title');

  return {
    ...emptyBoard(),
    nodes: [frame, api, db, user, note, title],
    edges: [
      withId(makeEdge('user', 'api', { label: 'HTTPS' }), 'e-user-api'),
      withId(makeEdge('api', 'db', { dashed: true }), 'e-api-db'),
      withId(makeEdge('note', 'frame', { path: 'step', sourceHandle: 't', targetHandle: 'b' }), 'e-note-frame'),
    ],
  };
}

export const fixtureNode = (id: string): BoardNode => {
  const n = fixtureBoard().nodes.find((x) => x.id === id);
  if (!n) throw new Error(`El fixture no tiene el nodo ${id}.`);
  return n;
};
