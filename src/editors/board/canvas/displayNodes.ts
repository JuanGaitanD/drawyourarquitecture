import type { BoardNode } from '../model/board';

/**
 * Lo que se le pasa a React Flow a partir de los nodos del store (que no se modifican):
 * - `locked` bloquea `draggable`, `deletable` y `connectable`, pero sigue siendo seleccionable (así se puede
 *   desbloquear con el candado del nodo, el panel o «Desbloquear todo»);
 * - el texto suelto tiene alto automático: no se le pasa `height`.
 * Solo se recrean los nodos afectados.
 */
export function toDisplayNodes(nodes: readonly BoardNode[]): BoardNode[] {
  return nodes.map((n) => {
    if (n.data.locked) {
      return {
        ...n,
        draggable: false,
        deletable: false,
        connectable: false,
      };
    }
    if (n.data.kind === 'text' && n.height !== undefined) {
      const { height: _h, ...rest } = n;
      return rest as BoardNode;
    }
    return n;
  });
}
