# HANDOFF · C1 — Núcleo del board

Rama `lane/c1-board-core` (desde `feat/base`, sin push). Gates `lint`, `typecheck`, `test` (93) y `build` en verde.

## Lo hecho

| Pieza | Dónde |
|---|---|
| Store por instancia (zustand + zundo), historial por gesto, `removeSelected` atómico | `store/boardStore.ts` (+ test) |
| Reparentar al soltar (centro del nodo → frame, posición convertida) | `store/reparent.ts` (+ test) |
| 6 nodos: `ShapeNode` (las 14 formas en SVG), `TextNode`, `StickyNode`, `FrameNode`, `IconNode`, `ImageNode` | `nodes/` |
| `LabeledEdge` (bezier/recta/escalón, flechas, discontinua, etiqueta editable) | `edges/` |
| `BoardViewer` (solo lectura, store propio) | `BoardViewer.tsx` |
| Canvas: crear con herramienta, conectar, reconectar, mover, redimensionar, reparentar, editar texto, bloquear, imagen | `canvas/BoardCanvas.tsx` |
| `BoardEditor`: carga → validación → hidratación → `useAutosave`, cabecera (volver, título, estado de guardado, compartir, tema, cuenta), avisos de conflicto, borrador y tamaño | `BoardEditor.tsx`, `canvas/EditorChrome.tsx`, `canvas/useEncodedContent.ts` |

Orden de hitos: el store (hito 2) se hizo **antes** de los nodos porque estos lo necesitan (`useBoardStore`); los tres hitos están commiteados en orden.

## Lo que usan los otros carriles

- **Ranuras de C2 y D** en `BoardEditor`: `.slotToolbar` (izquierda, centrada), `.slotStyle` (arriba al centro), `.slotSearch` (arriba a la derecha), `.slotActions` (abajo al centro). Son contenedores `position:absolute` con `pointer-events:none`; sus hijos sí reciben punteros. `BoardMenu` va en la cabecera y recibe `viewportRef` = el contenedor del lienzo (`.stage`, contiene `.react-flow__viewport`). Todo el árbol (cabecera incluida) está dentro de `BoardStoreProvider` y `ReactFlowProvider`, así que C2 y D pueden usar `useBoard` y `useReactFlow`.
- **`useShortcuts(rootRef)`**: el contenedor raíz tiene `tabIndex={-1}`.
- **Superset del contrato del store**: `BoardState` añade `editingId` y `setEditingId(id | null)` (texto en edición de un nodo o arista). `updateNodeData` mezcla `patch.style` con el estilo actual (admite parcial). `removeSelected` borra también los hijos de un frame y las aristas colgantes, en un solo paso, y respeta `locked`.
- **Selección de herramienta**: crear = `store.setTool('shape'|'text'|'sticky'|'frame'|'icon'|'image')` + clic en el lienzo (dentro de un frame también). Tras crear vuelve a `select` y abre la edición de texto. `connector`: muestra los handles y permite arrastrar; el clic origen→destino no está (ver pendientes).
- **Undo/redo**: `store.temporal.getState().undo()/redo()` ya devuelven `selected` y `measured`. Un arrastre, un resize y un borrado son un paso cada uno.
- **Borrar**: el canvas ya procesa `Backspace` y `Delete` con `removeSelected` (un paso); si `useShortcuts` también lo hace, no pasa nada (la segunda llamada no borra).
- **Colores automáticos**: lo dibujado es literal; solo el color *por defecto* de texto suelto, iconos, título de frame y aristas usa tokens (`nodes/colors.ts`) para leerse en tema oscuro. Si el panel de estilo asigna cualquier otro color, se respeta tal cual (pasa a ser literal).
- **Frames** van detrás por CSS (`.react-flow__node-frame { z-index:-1 }` en `canvas/flow.module.css`).
- **Texto suelto** tiene alto automático (`toDisplayNodes` no le pasa `height`).
- **`window.__board`** (solo `import.meta.env.DEV`) expone el store para pruebas manuales.

## Para T0 / A / T5 (fuera de mi propiedad)

1. **Carril A (`Viewer`, `EmbedPage`) y B (`BoardEmbed`)**: para que las imágenes del board se vean en lectura, pasar `files` a `BoardViewer`:
   ```tsx
   <BoardViewer content={content} files={{ load: (fileId) => fileStore.load(id, fileId) }} />
   ```
   (`BoardFiles` se exporta desde `editors/board/nodes`). Sin `files`, la imagen muestra «Imagen no disponible». La firma `BoardViewer({content})` sigue valiendo.
2. **Bundle**: `BoardEditor` importa `@/app/shell/Shell` (`ThemeToggle`, `UserMenu`) para no duplicar la cabecera; permitido por el lint, pero arrastra `Shell` al chunk del editor. Si molesta, moverlos a `ui/` (T5).
3. El 400 `identitytoolkit … /accounts` que sale en consola con emuladores es el login de prueba (el usuario `owner-test` ya existe), no del board.

## Pendientes y límites conocidos

- Conector por clic (origen → destino) sin arrastre: solo está el arrastre desde un handle y el «clic en handle, clic en handle» de React Flow.
- El **viewport** se guarda con el siguiente cambio de contenido (pan/zoom solos no disparan guardado); `useEncodedContent` recalcula 250 ms después del último cambio de nodos/aristas, así que un cambio hecho en los 250 ms anteriores a cerrar la pestaña puede perderse (el resto lo flushea `useAutosave`).
- Plan · hito 2 pide `minimap`, `controls`, cuadrícula y snap 16: están; el snap y la cuadrícula se conmutan con dos botones en `Controls` (la barra de C2 puede replicarlos con `gridOn`/`snapOn`).
- Historial: comparación por JSON (O(n) por cambio). Con tableros de miles de nodos habría que pasar a comparar por referencia (`ponytail` en `boardStore.ts`).
- Los atajos (Enter/F2 para editar con la selección) son solo los mínimos del canvas; el resto es de C2.
- Sin tests de componentes (React/jsdom): la lógica no trivial (store, reparentar, creación, imágenes, trazados) está en funciones puras probadas; el comportamiento de UI se comprobó en Chrome (ver respuesta del carril).
