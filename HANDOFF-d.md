# HANDOFF-d — carril D · Extras del board

Rama `lane/d-board-extras` (desde `feat/base`, sin push). Gates: `lint`, `typecheck`, `test`, `build` en verde.

## Qué hay

| Pieza                            | Dónde                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseFlowchart` / `toFlowchart` | `src/editors/board/model/mermaid.ts` (+ `mermaid.test.ts`, 53 casos)                                                                                                               |
| `autoLayout`                     | `src/editors/board/model/layout.ts` (+ `layout.test.ts`, 14 casos)                                                                                                                 |
| Plantillas                       | `src/editors/board/model/templates/{web-3-capas,c4-contexto,event-driven}.json`; lista y `instantiateTemplate` en `extras/templates.ts` (test: validan con `validateBoardContent`) |
| `BoardMenu` y diálogos           | `src/editors/board/extras/` (`BoardMenu.tsx`, `MermaidImportDialog`, `MermaidExportDialog`, `TemplatesDialog`, `exportPng.ts`, `files.ts`, `content.ts`)                           |

## Cómo montar `BoardMenu` (para C1)

```tsx
<BoardMenu
  title={project.title} // nombre de los archivos descargados
  viewportRef={editorContainerRef} // el div del editor; dentro se busca `.react-flow__viewport`
  getViewport={() => rf.getViewport()} // opcional: viewport de React Flow para el JSON
  onContentChanged={() => rf.fitView()} // opcional: encuadrar tras importar / plantilla / ordenar
/>
```

Props (`BoardMenuProps`): `title: string` · `viewportRef: RefObject<HTMLElement | null>` · `getViewport?: () => Viewport` (por defecto `{x:0,y:0,zoom:1}`) · `onContentChanged?: () => void` (se llama en el siguiente `requestAnimationFrame` tras aplicar el cambio). Las dos últimas son opcionales: se añadieron al stub, que sigue compilando.

Requisitos de montaje:

- Dentro de `<BoardStoreProvider>` (usa `useBoardStore`/`useBoard`), `ToastProvider` y `TooltipProvider` (ya están en `main.tsx`).
- Solo en el editor, no en el visor (el menú muta el store).
- Es un `<Button size="sm">` «Diagrama» con menú; pensado para la cabecera. `viewportRef` debe contener el `<ReactFlow>` montado.

### Lo que usa del store (contrato)

`useBoard(s => s.nodes.length)`, `getState().nodes/edges`, `toContent(viewport)` y **`replaceAll(nodes, edges)`** para todo: importar, plantillas, ordenar, JSON y «añadir» (nodos existentes + nuevos en una sola llamada, así que cada operación es **un paso de historial**). No usa `addNodes`/`addEdges`, `load` ni `setNodes`.

Si C1 implementa `replaceAll` con `selected` en los nodos, se conserva tal cual; el menú no toca selección.

## Decisiones y desviaciones

1. **Layout por niveles en vez de un grafo compound de dagre.** Dagre no deja holgura (relleno ni cabecera) alrededor de un clúster compound. Cada frame se ordena con sus hijos en su propio grafo dagre; su tamaño es el recuadro de los hijos + 32 px de relleno + 40 px de cabecera; en el nivel superior el frame es un nodo más de ese tamaño. Las aristas que cruzan un frame se asignan al frame del nivel que se ordena. La salida sigue el invariante 4 (hijos relativos, padres primero). `import('@dagrejs/dagre')` dinámico.
2. **`autoLayout` reescribe `sourceHandle`/`targetHandle`** de todas las aristas según el sentido (LR: `r→l`, TB: `b→t`; invertidas si la arista queda hacia atrás). El nivel raíz conserva la esquina superior izquierda previa.
3. **`MermaidParseResult` ampliado** con `direction: 'LR' | 'TB'` en el caso `ok` (TD/TB/BT → TB; LR/RL → LR) para pasarlo a `autoLayout`. Es un superconjunto de la firma del stub. `parseFlowchart` deja posiciones provisionales en rejilla: hay que llamar a `autoLayout` (el menú lo hace).
4. **Gramática extra, además de la del plan**: hexágono `{{t}}`, paralelogramo `[/t/]`, aristas `-.-` y `===`, `;` como separador, texto entre comillas con `<br/>` y `#quot;`. Se ignoran (sin error) `style`, `classDef`, `class`, `linkStyle`, `click` y `direction`. No soportado, con error de línea: `&` y flechas bidireccionales.
5. **`toFlowchart` pierde información**: stickies, textos e iconos salen como formas; solo hay forma para rectángulo, redondeado, elipse, rombo, terminador, cilindro, hexágono y paralelogramo (el resto sale como rectángulo); no se exportan estilos. Los ids legibles (≤ 20 caracteres, válidos en Mermaid) se conservan; los nanoid pasan a `n1, n2…`.
6. **Confirmación al reemplazar**: si el lienzo no está vacío, reemplazar (plantilla, Mermaid o JSON) abre un diálogo de confirmación; «insertar/añadir» no pregunta y coloca lo nuevo bajo lo existente (`placeBelow`). Se ofrece deshacer en el toast.
7. **PNG**: bounds de todos los nodos en absolutas (se aplanan con `toAbsolute` antes de `getNodesBounds`), margen 48 px, lado máximo 4096 px de CSS (a escala 2 = 8192 px reales; más grande se reduce el zoom), `document.fonts.ready`, fondo blanco fijo (el dibujo no cambia con el tema) y se omiten handles y controles de resize. `html-to-image` se carga con `import()` al exportar.
8. **JSON**: máximo 8 MB; `JSON.parse` + `validateBoardContent`; errores en toast.

## Qué necesita de otros carriles / T5

- **C1**: ver «Cómo montar». Si los nodos del store llevan `measured`, el PNG y el ordenado lo aprovechan; si no, usan `width`/`height` (siempre los pone `makeNode`). Si `.react-flow__viewport` cambia de clase, hay que avisar (se busca por ese selector).
- **T5**: probar con el editor real: PNG (que se vean etiquetas de arista y frames), plantilla → deshacer → rehacer, importar Mermaid → deshacer. En esta rama el menú se probó en un banco aislado con un store falso y React Flow sin los nodos propios (menú, diálogos, errores con línea, reemplazo con confirmación, ordenado, JSON y tamaño del PNG: 1752×1472 para el fixture, coincide con los bounds); **no** se vio el PNG renderizado con los nodos de C1.
- Nada fuera de la propiedad del carril se tocó.

## Pendiente / límites conocidos

- Sin tests de componentes (Vitest corre en `node`, sin jsdom): las partes puras (`content.ts`, plantillas, parser, layout) sí tienen test; el menú y los diálogos se probaron a mano.
- Los `.tsx` de `extras/` no tienen prueba de contraste medida; solo usan tokens de `src/ui/tokens.css` (tema claro y oscuro), `:focus-visible` y `prefers-reduced-motion` heredados de las primitivas.
- La miniatura de las plantillas es un SVG de rectángulos (no el render real de los nodos).
