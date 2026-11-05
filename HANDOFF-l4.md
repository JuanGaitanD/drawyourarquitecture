# HANDOFF-l4 — carril de deuda L4 · Board

Rama `debt/l4-board` (desde `chore/deuda-tecnica`, sin push). Cierra D10–D16 de `docs/deuda.md`. Lo que sigue son lo medido, las decisiones y lo que T0 debe tener en cuenta al integrar.

## D13 · medición (board de 2 000 nodos y 2 500 aristas, mediana, Node 24, `src/editors/board/perf.test.ts`)

| Operación | Antes (JSON por cambio) | Después | Mejora |
|---|---|---|---|
| Historial · mover un nodo (un `setNodes`) | 6,9 ms | 0,13 ms | ≈ 53× |
| Historial · cambiar la selección | 6,9 ms | 0,14 ms | ≈ 49× |
| Historial · gesto de 20 movimientos (`begin`/`end`) | 18,2 ms | 2,0 ms | ≈ 9× |
| Fusión · `onRemote` (parse del texto incluido) | 102 ms | 23 ms | ≈ 4× |
| Fusión · `onRemote` con 100 pasos de historial | ≈ 7 900 ms | 70 ms | ≈ 110× |
| Fusión · `mergeBoards` | 45 ms | 2,0 ms | ≈ 22× |
| Fusión · `boardSame` (dos textos nuevos, sin memoria) | 89 ms | 19 ms | ≈ 4,7× |

Lo que queda en `onRemote` es sobre todo `JSON.parse` + `validateBoardContent` del texto remoto (inevitable: el contenido viaja como string versionado). El resto es proporcional a lo que cambió, salvo los recorridos lineales baratos (índices por id, `sortParentsFirst` solo si hay altas o cambio de padre).

**Qué cambió**
- `store/boardStore.ts`: `cleanNodes`/`cleanEdges` recuerdan el resultado por objeto (`WeakMap`), así un nodo sin cambios devuelve la misma referencia limpia; `partialize` por store recuerda la última pareja de arrays; la igualdad del historial compara por referencia y solo a fondo (`deepEqual`) lo que difiere. El rebase del historial ante un remoto calcula el diff por id **una vez** (no una por paso: era el 8 s) y no reordena si no hay altas ni cambio de padre.
- `model/merge.ts`: `deepEqual` (sin orden de claves, `undefined` = ausente, atajo por referencia) y `diffById`; `mergeList` compara por id sin serializar. `canon` se conserva (lo usan tests).
- `sync.ts`: `boardSame` por id con `deepEqual` y memoria de las dos últimas lecturas por texto; `reuse` con `deepEqual`; `onRemote` no fusiona nada si el remoto no cambió ningún elemento respecto de `base` (solo viewport o eco de una fusión).
- Quitados los `ponytail:` de `boardStore.ts`, `sync.ts` y `actions.ts`.

**Hallazgo para D17 (L5)**: un board de 2 000 nodos con 2 500 aristas serializa a ≈ 1,1 MB, **por encima del tope de 900 000 bytes** de `encode`. El benchmark serializa con `JSON.stringify` por eso. Hasta que D17 trocee el contenido, un tablero de ese tamaño no se puede guardar (el editor lo avisa con el banner «supera el tamaño máximo»).

El test `perf.test.ts` lleva techos holgados (mover < 3 ms, `onRemote` con historial < 250 ms…): atrapan volver al recorrido con JSON, no variaciones de CI. Las medianas salen con `pnpm exec vitest run src/editors/board/perf.test.ts --reporter=verbose`.

## Decisiones por ítem

- **D12** (`e1f9b86`): `insertNode(node, edit)` en el store abre un gesto de historial al crear con edición y lo cierra al dejar de editar (`setEditingId`); `NodeLabel` confirma el texto **antes** de salir de la edición. Esc deja la forma sin etiqueta en un solo paso. Si el remoto borra el nodo mientras se escribe, el gesto se cierra (`applyRemote`). Icono e imagen ya eran un paso.
- **D10** (`fccb162`, `afefbac`): herramienta Conector (`L`): clic en el origen (se resalta con borde discontinuo y un aviso arriba) y clic en el destino crea la arista (un paso), con los lados que se miran (`canvas/connect.ts`), y vuelve a «Seleccionar» como el resto de herramientas de creación. Esc cancela primero el origen y después sale de la herramienta; un clic en el vacío cancela el origen; los nodos bloqueados no se conectan. Entrar en el conector limpia la selección. Estado de runtime `connectFrom` (no se guarda ni entra al historial).
- **D11** (`3fac5f0`): pan y zoom recodifican el contenido con 1,5 s de retraso (`useEncodedContent.touchViewport`) y la cola los guarda con su debounce de siempre; no entran al historial. Para que la cola los vea, **`boardSame` ya compara el viewport**, y para que el pan ajeno no ensucie, `sync.onRemote` devuelve (`string | null`) el contenido remoto **con el viewport propio** (el que esta pestaña cargó o escribió por última vez, `onSaved`); `BoardEditor` pasa eso a `acceptRemote`. Sin eso, recibir un pan ajeno dejaría `hasPending()` en verdad y pediría confirmación al cerrar la pestaña. Coste: una escritura por pan o zoom tras 1,5 s + 0,8 s de quietud (cuota: ver «Coste» en `HANDOFF.md`).
- **D16** (`efeb25d`): el título de «Web de 3 capas» pasa de 160 a 288 px de ancho. Los de «C4 · Contexto» y «Event-driven» tenían el mismo defecto (160 px para ≈ 500 px de texto): 560 px. Test que estima el ancho de cada texto suelto de las plantillas.
- **D15** (`531f0dc`): copiar escribe en el portapapeles del sistema el formato propio como *web custom format* (`web application/x-dya+json`) y texto Mermaid (`text/plain`); si el navegador no admite formatos propios (Firefox, Safari) queda solo el Mermaid y se pega exacto en la misma pestaña desde la copia en memoria. Pegar lee primero el formato propio (validado con `validateBoardContent`; nunca se confía en el portapapeles), después la copia en memoria si el sistema no tiene el formato propio porque esta pestaña no pudo escribirlo, y por último texto Mermaid (`parseFlowchart` + `autoLayout`, bajo lo que ya hay). Un texto que no es Mermaid no hace nada. Lo copiado es autocontenido: los raíz con posición absoluta, sin `parentId` colgante y solo con las aristas internas. **Probado en Chrome** entre dos pestañas del mismo contexto con `clipboard-read/write` concedidos.
- **D14** (`7d1137f`): `.dya.json` = `{ format: 'dya-board', version: 1, content, files: { [fileId]: { mimeType, base64 } } }`. Importar valida todo (formato, versión, contenido, tipo MIME, base64 y ≤ 4 MiB por imagen; archivo ≤ 40 MB), **sube las imágenes con reintentos (1-2-4 s, `uploadWithRetry`) antes de aplicar el contenido** y les da `fileId` nuevos (no pisa archivos del proyecto ni colisiona entre diagramas); si una subida falla no se importa nada. El `.json` antiguo sin imágenes sigue importándose. Quitado el aviso «sin imágenes» (menú y toast). «cola de `FileStore`»: el puerto no tiene cola; se usa la subida con reintentos del board, de una en una.

## Límites y lo que no se probó

- **Permiso del portapapeles**: leer con `navigator.clipboard.read()` pide permiso la primera vez que se pega en Chrome. Sin permiso o sin API se pega la copia en memoria. Pegar imágenes entre **proyectos distintos** deja la imagen sin archivo (`fileId` de otro proyecto); la copia no lleva binarios. Pegado probado solo en Chrome.
- **Exportar con imágenes**: las que no se pueden leer se omiten y se avisa con un toast; el contenido sí se exporta. Una subida fallida a mitad deja subidas huérfanas en `files/` (no se borran).
- El benchmark mide el modelo en Node, no el render de React Flow con 2 000 nodos.
- El conector por clic no evita aristas duplicadas entre los mismos nodos (igual que arrastrar).
- Edición de `onRemote` con altas/borrados en historial profundo recorre cada paso (lineal por paso); solo el caso de ediciones sin cambio de padre evita el reordenado.

## Lo que toqué fuera de mi propiedad

Nada fuera de `src/editors/board/**` y de estos dos documentos. `BoardViewer.tsx`, capas de cursores y `presence*` no se tocaron. El punto de subida de imágenes en `canvas` (`placeImage`) solo cambió porque `insert` ahora delega en `store.insertNode`: la línea de `upload` quedó igual.

## Para T0 al integrar

- `BoardEditor.tsx`: `useEncodedContent` devuelve además `touchViewport`; `sync.onRemote` devuelve `string | null` en vez de `boolean` (L2: si tocan la ruta remota, conservar ese contrato y el `acceptRemote(accepted)`).
- `HANDOFF.md` → «Pendientes del board» y «Riesgos y deuda» (conector, viewport, historial O(n), dos pasos por forma, título de la plantilla, JSON sin imágenes) y la decisión 28 («JSON sin imágenes») ya no valen: ver este documento. Las notas de C2 sobre «portapapeles en memoria (por store)» tampoco.
- `docs/mcp.md`/MCP: no hay cambios de formato de `BoardContent`; el `.dya.json` es solo de exportación/importación de la interfaz.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` (con `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`: 36 ficheros, 447 pruebas; una pasada de 6 falló una vez sin identificar la prueba, probablemente un techo de `perf.test.ts` con la máquina cargada por otros carriles, y se aflojaron los dos techos más ajustados) · `pnpm build` · `pnpm test:e2e` (3). Navegador: scripts de Playwright en `.wigi/l4/` (no versionados) contra el dev server en el 5193.
