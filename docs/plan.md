# Plan de implementación v1 (rev. 3) — drawyourarquitecture

Fuentes: `docs/stack.md` (manda en stack y estructura), `docs/architecture.md`, `docs/research/{miro,excalidraw}.md`, `docs/review/stack-gpt.md`.
Revisiones incorporadas: `.wigi/review/ponytail-plan.md` (21), `.wigi/review/gpt-plan.md` (20) y la revisión del stack (GPT-6.1-sol).
**Alcance: amplio por prioridad** (decisión de Juan, 2026-11-05). Timebox de ~4 h 30 min. Cada función tiene criterio de aceptación; lo que no esté listo y probado al cierre sale de v1 entero, sin dejarlo a medias.
Desviación consciente de `stack.md` §Alcance v1 (board mínimo): este plan cubre el alcance amplio por prioridades P0 → P1.

## Alcance

| Prioridad | Board | Resto |
|---|---|---|
| **P0** | lienzo, minimapa, cuadrícula y snap, multiselección, formas (rectángulo, redondeado, elipse, rombo), texto, sticky, conectores (con etiqueta, flechas, reconectar), frame, panel de estilo, alinear, orden Z, borrar, duplicar, deshacer por gesto, copiar/pegar, atajos básicos, guardar, JSON, lectura pública | panel (crear, listar, filtrar, renombrar, borrar, publicar), nota Excalidraw completa con autosave e imágenes, embed de board, reglas, despliegue |
| **P1** | 10 formas más (triángulo, paralelogramo, hexágono, cilindro, nube, documento, terminador, flecha, callout, actor), 15 iconos, imagen, distribuir, bloquear, frame alrededor de la selección, Mermaid (importar y exportar), 3 plantillas, autolayout (dagre), buscar, exportar PNG, atajos completos | duplicar proyecto con imágenes, recuperar borrador |

**Fuera**: tiempo real (fase 2), comentarios, IA, tablas, tarjetas, mind map, PDF, SVG de board, miniaturas, Open Graph dinámico, librerías oficiales AWS/Azure, payload en blob aparte.

## Estructura (de `stack.md`)

```
src/
  app/                       rutas, shell, AuthGate, hooks React (useAuth, useMyProjects, useProject, useAutosave), composición de adaptadores
    dashboard/  viewer/      pantallas del panel y de solo lectura
  domain/                    project.ts, codec.ts (sin React, Firebase ni motores)
  application/               puertos (ProjectRepo, ContentRepo, FileStore, Identity) + casos de uso: createProject, duplicateProject, deleteProject, saveQueue (autosave sin React)
  infrastructure/firebase/   firebase.ts, auth.ts, projects.ts, content.ts, files.ts (únicos que importan el SDK)
  editors/
    note/                    NoteCanvas, NoteEditor, BoardEmbed, codec de nota, files bridge
    board/
      model/                 board.ts, geometry.ts, validate.ts, ops.ts, mermaid.ts, layout.ts, templates/*.json, fixtures (TS puro; solo import type de @xyflow/react)
      store/                 createBoardStore (zustand vanilla + zundo), BoardStoreProvider, useBoard
      canvas/ nodes/ edges/  React Flow
      ui/                    Toolbar, StylePanel, ActionBar, SearchBox, useShortcuts
      extras/                BoardMenu (Mermaid, plantillas, layout, export/import)
      BoardEditor.tsx  BoardViewer.tsx
  ui/                        primitivas sobre Radix (Dialog, DropdownMenu, Popover, Tooltip), Button, IconButton, Toast, tokens.css, theme
tests/rules/  tests/e2e/
```
**Regla de dependencia** (ESLint `no-restricted-imports`): `domain ← application ← infrastructure`; `editors` y `app` consumen `application` y `domain`; solo `app/` conecta `infrastructure/firebase`. `domain/` y `application/` no importan React, Firebase, zustand ni los motores.

## Invariantes (todos los carriles)

1. **Persistencia como string versionado.** `projects/{id}/content/main = { data: string, schemaVersion: 1, revision: number, updatedAt }`. Codec en `domain/codec.ts`: `encode(obj)` (`JSON.stringify` y bytes UTF-8 con `TextEncoder`; si pasan de 900 000 lanza `ContentTooLargeError`) y `decode<T>(s)`. `data` va exento de índices. `ponytail:` por encima de 900 KB, error visible; el contenido troceado como los archivos queda para cuando un board real lo alcance.
2. **Guardado** (`application/saveQueue.ts`, sin React, y `app/hooks/useAutosave.ts`):
   - El editor se monta con `key={id}`. Guardar está **deshabilitado hasta hidratar** con éxito. Si la carga falla: error, reintentar y nunca guardar.
   - Si el string codificado es igual al último guardado, no hay escritura. Debounce de 800 ms y una sola escritura en vuelo; la última gana.
   - Escritura en **transacción**: lee `revision`; si es distinta de la esperada, estado `conflicto` («Otra pestaña guardó: Recargar / Guardar como copia»). Si coincide, escribe `revision+1` y actualiza `projects/{id}.updatedAt`.
   - Borrador `localStorage['draft:'+id] = {data, at, revision}` en cada cambio. Se borra al confirmar. Al cargar, si el borrador es más reciente, se ofrece «Recuperar cambios no guardados».
   - Flush en `visibilitychange` hidden y al desmontar; aviso en `beforeunload` si hay cambios pendientes. Sin conexión, el estado es `sin conexión, borrador local` y se reintenta con `online`.
   - Estados: `guardando | guardado | sin conexión | conflicto | error`.
3. **Archivos** (`FileStore`): **Firestore troceado, sin Storage ni plan Blaze** (decisión de Juan, 2026-11-05).
   - `projects/{id}/files/{fileId} = { mimeType, size, chunks, createdAt }` y `projects/{id}/files/{fileId}/chunks/{i} = { data: Bytes }` (≤ 900 000 bytes por trozo, `Bytes.fromUint8Array`, sin base64). Se escribe con batch y la meta va la última; si hiciera falta, se parte en varios batch (≤ 450 operaciones y ≤ 8 MiB). `load` recompone un `Blob` con el `type` guardado; `remove` borra trozos y meta.
   - **Toda imagen se optimiza antes de subir** (`application/imageOptimize.ts`, en nota y board): `createImageBitmap` → lado mayor ≤ 2048 px → WebP a calidad 0,82 (`OffscreenCanvas`, o `<canvas>` si no existe) → se conserva solo si pesa menos que el original. El GIF se sube tal cual (animación); sin soporte de WebP o con una imagen que no se decodifica, se sube el original. Tope de 4 MiB **después** de optimizar (`ImageTooLargeError`). La copia de un proyecto mueve los bytes ya optimizados, sin recodificar.
   - Descarga solo por `FileStore.load`, que devuelve un `Blob`; no hay URLs públicas.
   - Subida en cola con 3 reintentos (1-2-4 s); los errores se ven en un toast con «Reintentar». El binario sigue en memoria y en el borrador mientras falte.
   - La nota guarda `files: Record<fileId, {mimeType, created}>` (el `mimeType` es el que se guardó, normalmente `image/webp`) y reconstruye `BinaryFileData {id, mimeType, dataURL, created}` con el `type` del `Blob` descargado para pasarlo a `api.addFiles`.
   - Formatos de entrada PNG, JPEG, GIF y WebP; se rechaza SVG.
4. **Coordenadas del board.** Los hijos (`parentId`) guardan su posición relativa al padre y los padres van primero en el array. Sin `extent:'parent'`. Las operaciones geométricas trabajan en absolutas con `toAbsolute` y `toRelative`. Reparentar al soltar se decide por el centro del nodo y convierte la posición.
5. **Discriminantes.** `node.type === node.data.kind` y `edge.type === 'labeled'` (trazado en `data.path`). Handles `t r b l` con `ConnectionMode.Loose`. Nodos y aristas se crean solo con `makeNode` y `makeEdge`, que fijan nanoid, `DEFAULT_SIZE[kind]` y estilo. Fixture compartido: `model/fixtures.ts`.
6. **Store por instancia.** `createBoardStore()` devuelve un store vanilla, inyectado con `BoardStoreProvider`. No hay store global, así que dos pestañas o un embed no comparten estado. Historial de zundo:
   - `partialize` deja solo `nodes` y `edges`, sin `selected`, `dragging`, `measured` ni `resizing`; equality por JSON; límite de 100.
   - `beginGesture` guarda el snapshot y pausa; `endGesture` reanuda y empuja el snapshot (un gesto = un paso).
   - `load` limpia el historial.
7. **Solo lectura explícita.** Con `BoardReadonlyContext` los nodos no editan ni muestran resizer o handles. El visor fija `nodesDraggable`, `nodesConnectable`, `elementsSelectable` y `edgesReconnectable` en false. La nota usa `NoteCanvas readonly` (`viewModeEnabled`), que también resuelve archivos y embeds.
8. **Validación.** `validateBoardContent(x)` rechaza `schemaVersion ≠ 1`, ids duplicados, aristas colgantes, `parentId` inexistente o cíclico, números no finitos, `type ≠ kind` y más de 5 000 nodos o 10 000 aristas. Se aplica a import JSON, plantillas, Mermaid y carga. Importar entra al historial.
9. **Versiones exactas.** Se fijan en T0 con lockfile; `html-to-image@1.11.11`. pnpm con corepack: `packageManager` y `engines.node: 24.x`.
10. **Accesibilidad.** Radix para overlays y menús. `aria-label` y tooltip en los botones de icono. `:focus-visible` con token y contraste AA. `prefers-reduced-motion`. `lang="es"`. Tema `light | dark | system` desde tokens, puenteado a Excalidraw (`theme`) y a React Flow (`colorMode`); los colores del dibujo no cambian con el tema.
11. **Atajos** solo con el editor enfocado. Se ignoran en inputs, textarea, contentEditable y durante la composición IME. Los atajos de un embed no compiten con la nota.

## Contratos (los fija T0; los carriles los consumen tal cual)

```ts
// domain/project.ts
export type ProjectType = 'note' | 'board';
export interface Project { id: string; ownerId: string; type: ProjectType; title: string; isPublic: boolean; createdAt: number; updatedAt: number }

// application/ports.ts
export interface ContentRecord { data: string; schemaVersion: 1; revision: number; updatedAt: number }
export interface ContentRepo { load(id: string): Promise<ContentRecord | null>; save(id: string, data: string, expectedRevision: number): Promise<{ revision: number } | { conflict: true }> }
export interface ProjectRepo { listMine(uid: string, cb: (p: Project[]) => void, onError: (e: Error) => void): () => void; get(id: string): Promise<Project | null>; create(p: Omit<Project,'id'>, initialData: string): Promise<string>; update(id: string, patch: Partial<Pick<Project,'title'|'isPublic'>>): Promise<void>; remove(id: string): Promise<void> }
export interface FileStore { upload(projectId: string, fileId: string, blob: Blob): Promise<void>; load(projectId: string, fileId: string): Promise<Blob>; list(projectId: string): Promise<string[]>; remove(projectId: string, fileId: string): Promise<void> }
export interface Identity { current(): { uid: string; name: string; photo?: string } | null; onChange(cb): () => void; signIn(): Promise<void>; signOut(): Promise<void> }
// application/projects.ts: createProject(type, title?) · duplicateProject(id) (copia archivos y luego el contenido) · deleteProject(id) (archivos → content → proyecto)
// application/saveQueue.ts: createSaveQueue(repo, id, initialRevision) → { push(data), flush(), onStatus(cb) }
// app/hooks: useAuth() · useMyProjects() · useProject(id) · useAutosave(id, encoded|null, hydrated, revision) → { status, error, flush, resolveConflict(kind) }
// app/services.ts: instancias concretas (repos de infrastructure/firebase) exportadas para editores y pantallas

// editors/board/model/board.ts
export type ShapeKind = 'rectangle'|'round_rectangle'|'ellipse'|'rhombus'|'triangle'|'parallelogram'|'hexagon'|'cylinder'|'cloud'|'document'|'terminator'|'arrow_right'|'callout'|'actor';
export type NodeKind = 'shape'|'text'|'sticky'|'frame'|'icon'|'image';
export interface NodeStyle { fill: string; stroke: string; strokeWidth: number; dashed: boolean; opacity: number; fontSize: number; textColor: string; align: 'left'|'center'|'right'; bold: boolean }
export type BoardNodeData = { kind: NodeKind; shape?: ShapeKind; icon?: IconName; fileId?: string; label: string; style: NodeStyle; locked?: boolean };
export type BoardNode = Node<BoardNodeData, NodeKind>;
export type EdgePath = 'bezier'|'straight'|'step';
export type BoardEdgeData = { label?: string; path: EdgePath; markerStart: boolean; markerEnd: boolean; dashed: boolean; color: string; width: number };
export type BoardEdge = Edge<BoardEdgeData, 'labeled'>;
export interface BoardContent { schemaVersion: 1; nodes: BoardNode[]; edges: BoardEdge[]; viewport: { x: number; y: number; zoom: number } }
export const ICONS: readonly IconName[]; // server database cloud user globe smartphone lock queue cpu hard-drive network shield mail credit-card box
export const STICKY_COLORS: Record<string, string>; // los 16 de miro.md
export const DEFAULT_SIZE: Record<NodeKind, { width: number; height: number }>;
export function makeNode(kind: NodeKind, pos: XY, partial?: Partial<BoardNodeData>): BoardNode;
export function makeEdge(source: string, target: string, partial?: Partial<BoardEdgeData> & { sourceHandle?: string; targetHandle?: string }): BoardEdge;
export const emptyBoard: () => BoardContent;
// model/geometry.ts: toAbsolute · toRelative · sortParentsFirst · nodeAtPoint
// model/validate.ts: validateBoardContent(x: unknown): { ok: true; value: BoardContent } | { ok: false; error: string }
// store: estado { nodes, edges, tool: Tool, pendingShape, pendingIcon, gridOn, snapOn }; acciones load · toContent(viewport) · replaceAll · addNodes · addEdges · updateNodeData(ids, patch) · updateEdgeData(ids, patch) · setNodes(fn) · setEdges(fn) · removeSelected · setTool · beginGesture · endGesture

// editors/note/codec.ts
export interface NoteContent { schemaVersion: 1; elements: readonly unknown[]; appState: { viewBackgroundColor?: string }; files: Record<string, { mimeType: string; created: number }> }
```

## Rutas
`/` · `/note/:id` · `/board/:id` · `/view/:type/:id` (pública) · `/embed/board/:id` (`BoardViewer` sin chrome). El `link` del embeddable es `/embed/board/:id`; dentro de la nota se pinta con `renderEmbeddable`, no con iframe. Hay 404 y fallback de carga.

## Propiedad de archivos

| Carril | Escribe | 
|---|---|
| T0 Base | todo lo inicial + stubs tipados de cada export que cruza carriles |
| A Panel/visor | `app/dashboard/**`, `app/viewer/**` |
| B Nota | `editors/note/**` |
| C1 Núcleo board | `editors/board/{store,canvas,nodes,edges}/**`, `BoardEditor.tsx`, `BoardViewer.tsx` |
| C2 UI board | `editors/board/ui/**`, `editors/board/model/ops.ts(+test)` |
| D Extras | `editors/board/extras/**`, `editors/board/model/{mermaid,layout}.ts(+test)`, `model/templates/*.json` |

Ningún carril edita `domain/`, `application/`, `infrastructure/`, `ui/`, `app/` (salvo su carpeta) ni `model/{board,geometry,validate,fixtures}.ts`. Si hace falta, se anota en `HANDOFF-<carril>.md` y lo resuelve T5.
Stubs de T0, con la firma final que compila: `BoardViewer({content})`, `NoteCanvas({projectId, content, readonly, onChange?})`, `ui/{Toolbar,StylePanel,ActionBar,SearchBox,useShortcuts}`, `extras/BoardMenu` y `model/{ops,mermaid,layout}.ts` (lanzan `not implemented`).

## Tareas

### P · Preflight (hecho)
Node 24.22.2 y Java 21 (`JAVA_HOME="C:/Program Files/Eclipse Adoptium/jre-21.0.13.9-hotspot"`, también en `PATH` para los emuladores).

### T0 · Base (serie, rama `feat/base`, Sonnet 5.5)
1. Vite 8.3 react-ts; `corepack enable` y pnpm; TS strict; ESLint flat con `no-restricted-imports` por capas; Prettier; Vitest. Scripts `dev build preview lint typecheck test test:rules emulators`.
2. Dependencias exactas: `react react-dom wouter zustand zundo @xyflow/react @excalidraw/excalidraw firebase @dagrejs/dagre html-to-image@1.11.11 lucide-react nanoid @radix-ui/react-{dialog,dropdown-menu,popover,tooltip}`; dev: `vitest @firebase/rules-unit-testing firebase-tools typescript eslint prettier @playwright/test`. **Antes**, comprobación de humo: Excalidraw y React Flow montan juntos en Vite 8 con React 19 (`pnpm build` + `pnpm preview` sin errores en consola). Si falla, se baja a Vite 7.3 y se anota.
3. `domain/`, `application/` (puertos, casos de uso, saveQueue con tests: gate de hidratación, cola, conflicto y borrador), `infrastructure/firebase/` (`VITE_FIREBASE_*`; emuladores si `VITE_USE_EMULATORS=1`, con login de prueba en emulador) y `editors/board/model/{board,geometry,validate,fixtures}.ts` con tests.
4. `ui/`: tokens (superficie, texto, borde, selección, foco, peligro, radios, espaciado, sombra, z-index), tema, primitivas Radix, Button, IconButton y Toast.
5. `app/`: router (5 rutas + 404), `AuthGate`, shell, hooks, `services.ts` y páginas lazy. En `index.html`, Open Graph genérico y `<meta name="robots" content="noindex">` en las vistas públicas (se inyecta al montar el visor).
6. Reglas:
   - **`firestore.rules`**
     - `isOwner()` compara `request.auth.uid` con `OWNER_UID`, que `scripts/render-rules.mjs` toma de `.env`; en los emuladores es `owner-test`.
     - `projects`: `get` si es del dueño o `isPublic`; `list` solo del dueño.
     - `create` exige `isOwner`, `ownerId == uid` y `keys().hasOnly`, con tipos validados.
     - `update` solo cambia `title`, `isPublic` y `updatedAt`; `delete`, solo del dueño.
     - `content/main` hereda la lectura del padre. Su `create` usa `getAfter()` (batch). Claves `data`, `schemaVersion`, `revision` y `updatedAt`. En `update`, `revision == resource.revision + 1`.
     - `files/{fileId}` y `files/{fileId}/chunks/{i}`: `get` si el proyecto padre es del dueño o público (`get()` al proyecto); `list` solo del dueño; escritura solo del dueño. Meta con claves cerradas (`mimeType` en png/jpeg/gif/webp, `size` entero ≤ 4 194 304, `chunks` entero 1–5, `createdAt`); trozo con `data is bytes` y `data.size() <= 900000`.
   - `firestore.indexes.json` (exime `data`) y `firebase.json` con los emuladores de Auth y Firestore.
7. `tests/rules/*.test.ts`:
   - El dueño crea en batch, lee y escribe.
   - Una cuenta ajena no lee lo privado ni crea.
   - Un anónimo lee lo público con `get` y no puede listar.
   - `ownerId` y `type` son inmutables; una `revision` que no corresponde se rechaza.
   - Archivos: el dueño escribe y lee trozos y meta, una cuenta ajena no, un anónimo lee si el proyecto es público; un trozo de 900 001 bytes y un `mimeType` SVG se rechazan; el dueño borra.
8. `vercel.json`: rewrite de la SPA que no intercepta `/assets` ni `/api`; caché inmutable en `/assets/*`; `nosniff`, `Referrer-Policy` y `X-Frame-Options: SAMEORIGIN`.
9. Fuentes de Excalidraw en `public/excalidraw-assets/` (`window.EXCALIDRAW_ASSET_PATH`).
10. Stubs, `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), `wigi.json`, `HANDOFF.md`, `.env.example` y `.gitignore` (`.wigi/`, `.env*`).
- **Hecho cuando** `lint`, `typecheck`, `test`, `test:rules` y `build` pasan en verde, y el login y la navegación funcionan contra los emuladores.

### Carriles paralelos (worktree desde `feat/base`, Sonnet 5.5; gates: lint, typecheck, test y build)

**A · Panel y visor** (`app/dashboard`, `app/viewer`)
- Panel:
  - Cabecera: avatar, tema y salir.
  - «Nuevo» con dos tarjetas: Nota y Diagrama.
  - Grilla de proyectos: tipo, título y fecha relativa (`Intl.RelativeTimeFormat('es')`). Encima, tabs Todos/Notas/Diagramas y búsqueda.
  - Menú de tarjeta (Radix DropdownMenu): renombrar inline, duplicar, público con copiar enlace y borrar con confirmación (Radix Dialog).
  - Estados vacío, cargando y error.
- `/view/:type/:id`: funciona sin sesión, con `NoteCanvas readonly` o `BoardViewer`, y mensajes «No existe o es privado» y «Error de red, reintentar».
- `/embed/board/:id`: `BoardViewer` a pantalla completa.

**B · Nota** (`editors/note`)
- `NoteCanvas`:
  - `<Excalidraw>` lazy a altura completa, con `langCode="es-ES"` y tema puenteado.
  - Hidratación: `decode` → elementos + `loadFile` → `addFiles`.
  - `onChange` → `encode` → `useAutosave`. Con `readonly`, `viewModeEnabled`.
- Archivos nuevos → `files` + subida con cola (invariante 3).
- Embed:
  - `validateEmbeddable` devuelve true solo para el mismo origen con `/embed/board/<id>`, y `undefined` para el resto.
  - `renderEmbeddable` → `BoardEmbed`: carga una vez y muestra `BoardViewer` con «Abrir» y «Recargar». Si no hay acceso, «Diagrama privado o inexistente».
- «Insertar diagrama» en `MainMenu`:
  - Abre un Radix Dialog con los boards y «Nuevo diagrama».
  - Inserta el elemento **completo**: el constructor que en `dist/types` 0.18.1 dé un `ExcalidrawEmbeddableElement` válido (`convertToExcalidrawElements` o `restoreElements`), con `updateScene` y `CaptureUpdateAction.IMMEDIATELY`, 640×400, centrado.
  - Aceptación: insertar → deshacer → rehacer → recargar.
- `renderTopRightUI`: título, estado de guardado, recuperar borrador, compartir y volver.
- La librería se guarda en `localStorage`.

**C1 · Núcleo del board** (camino crítico)
- Hito 1 (≤ 25 min): nodos y `LabeledEdge` con `BoardReadonlyContext`, y `BoardViewer` real.
  - `ShapeNode` dibuja en SVG con un mapa de paths para las 14 formas. Las P0 primero.
  - `TextNode`, `StickyNode`, `FrameNode` (va detrás), `IconNode` e `ImageNode` (`loadFile` → object URL, que se revoca al desmontar).
- Hito 2:
  - Store (invariante 6) y canvas: `Background`, `MiniMap`, `Controls`, snap 16 px conmutable y `colorMode`. Sin `onlyRenderVisibleElements`.
  - Herramienta + clic crea con `makeNode`. `onConnect` usa `makeEdge`; `onReconnect`, `reconnectEdge` guardando los handles.
  - Reparentar en `onNodeDragStop`. Doble clic edita el texto (Enter o Esc). `locked` bloquea `draggable`, `selectable` y `deletable`.
- Hito 3: `BoardEditor` (carga, validación, hidratación, autosave y header) con las ranuras de C2 y D.
- Aceptación:
  - Crear, conectar, mover y recargar: todo persiste.
  - Meter un nodo en un frame y sacarlo: no salta.
  - Un arrastre se deshace en un solo paso.
  - Un embed y el editor no comparten estado.

**C2 · UI del board**
- `model/ops.ts` y su test:
  - `align` (6 variantes) y `distribute(x|y)`, en absolutas.
  - `bringToFront` y `sendToBack`, con los padres siempre primero.
  - `wrapInFrame` (padding 32).
  - `duplicate`, que remapea ids, aristas internas y `parentId`.
- `ui/`:
  - `Toolbar`: vertical, con submenús Radix de formas e iconos.
  - `StylePanel`: Popover según la selección de nodos o aristas.
  - `ActionBar`.
  - `SearchBox`: Mod+F; Enter recorre las coincidencias con `fitView`.
- `useShortcuts` (invariante 11):
  - Herramientas: V H R O T S F L I.
  - Edición: Mod+Z, Mod+Shift+Z/Y, Mod+C/V/X/D, Mod+A, Supr/Retroceso, Mod+G, Mod+L, Mod+Shift+] y Mod+Shift+[.
  - Vista: Shift+1 y Shift+2, Mod+' y flechas (1 px; 10 px con Shift).

**D · Extras**
- `model/mermaid.ts` y su test:
  - `parseFlowchart`:
    - Directiva `flowchart|graph` con TD, TB, LR, RL o BT.
    - Nodos `A`, `A[t]`, `A(t)`, `A([t])`, `A{t}`, `A((t))` y `A[(t)]`.
    - Aristas `-->`, `---`, `-.->`, `==>`, `-->|t|` y `-- t -->`, también en cadenas.
    - `subgraph` como frame, comentarios `%%` y errores con número de línea.
    - Construye con `makeNode` y `makeEdge`.
  - `toFlowchart`: round-trip probado con el fixture.
- `model/layout.ts`: `autoLayout(content, 'LR'|'TB')` con `@dagrejs/dagre` (compound para frames), salida en relativas e `import()` dinámico.
- `model/templates/*.json`: «Web de 3 capas», «C4 · Contexto» y «Event-driven». Un test comprueba que validan.
- `extras/BoardMenu` (Radix DropdownMenu + Dialog):
  - Importar Mermaid (con autolayout) y exportar Mermaid (copiar).
  - Plantillas: reemplazar o insertar, con confirmación.
  - Ordenar automáticamente.
  - Exportar PNG: `toPng` sobre el viewport **del ref del editor**, con bounds absolutos y `getViewportForBounds`, tras `document.fonts.ready`; escala 2.
  - Exportar e importar JSON (validado y deshacible).

### T5 · Integración (orquestador)
- Merge en orden C1 → C2 → D → A → B; resolver los `HANDOFF-*`.
- Gates y bundle inicial < 250 kB gzip.
- Prueba manual con emuladores, en el navegador:
  - Nota con imagen + embed; recargar.
  - Plantilla, Mermaid, PNG y JSON.
  - Público en incógnito y despublicar.
  - Conflicto entre dos pestañas.

### T6 · Pruebas e2e (Haiku 5.5)
Un `tests/e2e/smoke.spec.ts` (Playwright + emuladores):
- Crear un board, añadir forma y conector, recargar y comprobar que persisten.
- Crear una nota, insertar el board y comprobar que se ve.
- Abrir el enlace público sin sesión.

### T7 · Revisión final GPT-6.1-sol → correcciones → T8 · Despliegue
- **Firebase personal (plan Spark, sin Storage)**:
  - `firebase deploy --only firestore:rules,firestore:indexes`.
  - Dominio de Vercel en los dominios autorizados de Auth.
- **Vercel**: `vercel --prod` con `VITE_FIREBASE_*` en el equipo personal `juangaitands-projects` (validado 2026-11-05: CLI como `juangaitand`).
- **Analytics** (pedido por Juan): `firebase/analytics` en `infrastructure/firebase/analytics.ts`, cargado con `import()` solo en producción, si `isSupported()` y hay `VITE_FIREBASE_MEASUREMENT_ID`. Eventos: `project_create {type}`, `project_publish`, `board_embed_insert`, `export {format}`. Sin datos personales ni títulos. Usar la skill `firebase-analytics` del plugin oficial.
- Plugin oficial de Firebase (skills `firebase-*`, MCP `firebase-tools mcp`): lo usan los agentes nuevos para reglas (`firestore-rules-creation`, `firebase-security-rules-auditor`), despliegue y Analytics.

## Estimación (con margen del 50 %)
T0 40→60 · A/B/C1/C2/D en paralelo 75→110 · T5 25→40 · T6 15→20 · T7 30→45 · T8 15→25. **≈ 5 h**, con ~1 h ya consumida en investigación y plan. El recorte por prioridad (P1 fuera) es la válvula.

## Pendiente de Juan (antes de T8)
1. Proyecto Firebase **personal** (plan gratuito Spark), con Google Sign-In y Firestore; config web; `npx firebase-tools login`.
2. Tu UID: aparece tras el primer login en local, o en Firebase Console → Authentication.
3. Vercel: la CLI está en `jgaitan-6182`. ¿Es la cuenta Pro personal?
