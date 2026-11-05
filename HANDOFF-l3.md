# HANDOFF · carril L3 (nota e imágenes) — rama `debt/l3-note`

Cierra D8, D9 y D18 de `docs/deuda.md`. Lo que otros carriles o T0 deben saber:

- **Board (D8, pendiente menor)**: `BoardCanvas.placeImage` ya inserta el nodo solo cuando la subida confirma, así que una imagen remota rota no puede pasar en el board. Lo que sigue en memoria es el binario cuando se agotan los reintentos (toast «Reintentar»). Cerrarlo exige guardar en `PendingStore` (`@/application/pendingFiles`) el binario con la posición del nodo y reponerlo al montar `BoardEditor`: se dejó fuera para no tocar `editors/board` mientras trabaja L4. La pieza reutilizable es `indexedDbPendingStore()`.
- **MCP (L1)**: los tombstones de la nota duran 30 días (`isDeleted` sigue viajando en `content.elements`); `read_note` debe seguir ignorándolos.
- **Tests**: `merge.ts` importa Excalidraw, que no carga en el entorno `node` de Vitest (`window is not defined`); la fusión y la reconciliación se comprobaron en Chrome, no hay `merge.test.ts`. Un entorno `jsdom` solo para eso se dejó a T0/L6.
- **Archivos tocados fuera de mi propiedad**: ninguno. `src/application/pendingFiles.ts` es nuevo; la cola sigue en `src/editors/note/files.ts`.
