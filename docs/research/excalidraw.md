# Excalidraw como motor de «notas whiteboard» — investigación

Fecha: 2026-11-05 · Paquete: `@excalidraw/excalidraw@0.18.1` (publicado 2026-04-20, `latest` en npm, licencia MIT) ·
Destino: React 19 + Vite + Firebase. Marcas: **[O]** observado (artefacto o red), **[I]** inferido, **[?]** sin verificar.

## 0. Respuesta corta

- El paquete es **un editor completo como componente React** (`<Excalidraw/>`): lienzo, herramientas, biblioteca, export, i18n, undo/redo. No trae backend, ni colaboración, ni persistencia: eso es de la app anfitriona.
- Persistencia = tú guardas `elements` + `appState` mínimo (JSON) y los `files` binarios aparte (Firebase Storage). Se rehidratan con `initialData`.
- Board propio incrustado = elemento `embeddable` con `link` a una URL del mismo origen + `validateEmbeddable` (permitir) + `renderEmbeddable` (pintar un componente React, **no** un iframe).

## 1. Funciones de serie (paquete 0.18.1)

| Área | Qué trae | Cómo se controla |
|---|---|---|
| Dibujo | rectángulo, rombo, elipse, flecha (con binding), línea, dibujo libre, texto, imagen, frame, magic frame, laser, borrador, mano, selección | `UIOptions.tools.image`; tipos `ToolType` [O types.d.ts] |
| Notas | «Sticky note» (tecla N) en excalidraw.com [O REA]; en la API aparece como `type:"stickynote"` del skeleton (docs, beta) | `convertToExcalidrawElements` |
| Embeds | elemento `embeddable` (iframe) y `iframe` interno; allowlist por defecto: youtube, vimeo, figma, gist, twitter/x, reddit, giphy, stackblitz, val.town, simplepdf, link.excalidraw.com [O bundle] | `validateEmbeddable`, `renderEmbeddable` |
| Enlaces | hipervínculo por elemento (`element.link`), «copiar enlace al objeto» | `generateLinkForSelection`, `onLinkOpen` |
| Biblioteca | panel de librerías, importar `.excalidrawlib`, `libraryReturnUrl` | `onLibraryChange`, `api.updateLibrary`, `useHandleLibrary`, `mergeLibraryItems` |
| Export | PNG/SVG/canvas/clipboard/JSON, `.excalidraw`, escena embebida en PNG/SVG (`exportEmbedScene`) | `exportToBlob/Svg/Canvas/Clipboard` |
| Import | `.excalidraw`, `.excalidrawlib`, PNG/SVG con escena, pegar imágenes | `loadFromBlob`, `loadSceneOrLibraryFromBlob`, `restore*` |
| Edición | undo/redo, grupos, alinear/distribuir, snap, rejilla, zoom, buscar en lienzo (Ctrl+F), paleta de comandos (Ctrl+/) | `gridModeEnabled`, `objectsSnapModeEnabled` |
| Vistas | modo lectura, modo zen, tema claro/oscuro/sistema, 25 idiomas en el selector (incl. Español) | `viewModeEnabled`, `zenModeEnabled`, `theme`, `langCode` |
| Texto→diagrama | Mermaid→Excalidraw (`@excalidraw/mermaid-to-excalidraw` es dependencia), `TTDDialog`, `DiagramToCodePlugin` | `TTDDialog`, `aiEnabled` |
| UI componible | `MainMenu`, `Footer`, `Sidebar`, `WelcomeScreen`, `Stats`, `DefaultSidebar`, `LiveCollaborationTrigger` | componentes hijos de `<Excalidraw>` |
| Colaboración | solo ganchos: `isCollaborating`, `onPointerUpdate`, `reconcileElements`, `updateScene({collaborators})`. **Sin servidor** en el paquete | tú pones el transporte (Firestore/WebSocket) |

Solo excalidraw.com, **no** en el paquete [O REA/docs]: Excalidraw+ (de pago), sala colaborativa cifrada, enlaces compartidos en su backend.

## 2. API de integración (firmas de `dist/types` 0.18.1)

Peer deps: `react ^17.0.2 || ^18.2.0 || ^19.0.0`, `react-dom` igual. ESM puro (`"type":"module"`), exporta `.` y `./index.css`.

```ts
import { Excalidraw, MainMenu, Footer, Sidebar, WelcomeScreen, convertToExcalidrawElements,
  exportToBlob, exportToSvg, exportToCanvas, serializeAsJSON, loadFromBlob, restore,
  reconcileElements, CaptureUpdateAction, THEME, useHandleLibrary } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI, ExcalidrawProps, BinaryFiles, BinaryFileData }
  from "@excalidraw/excalidraw/types";            // el subpath ./* sale tipado
```

Props de `ExcalidrawProps` (extracto literal):

```ts
onChange?(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles): void;
initialData?: (() => MaybePromise<ExcalidrawInitialDataState|null>) | MaybePromise<ExcalidrawInitialDataState|null>;
excalidrawAPI?(api: ExcalidrawImperativeAPI): void;     // callback, NO ref (ref/ready se quitaron en 0.17)
validateEmbeddable?: boolean | string[] | RegExp | RegExp[] | ((link: string) => boolean | undefined);
renderEmbeddable?(element: NonDeleted<ExcalidrawEmbeddableElement>, appState: AppState): JSX.Element | null;
generateLinkForSelection?(id: string, type: "element"|"group"): string;
onLinkOpen?(element, event: CustomEvent<{ nativeEvent: MouseEvent | React.PointerEvent }>): void;
generateIdForFile?(file: File): string | Promise<string>;   // por defecto SHA-1 del archivo
viewModeEnabled?, zenModeEnabled?, gridModeEnabled?, theme?: "light"|"dark", langCode?, name?, autoFocus?,
handleKeyboardGlobally?, detectScroll?, libraryReturnUrl?, onLibraryChange?(items), UIOptions?: Partial<UIOptions>,
renderTopRightUI?, onPaste?, onDuplicate?, onScrollChange?, onPointerUpdate?, isCollaborating?, aiEnabled?
```

`initialData` (`ImportedDataState`): `{ elements?, appState?, scrollToContent?, libraryItems?, files?: BinaryFiles }`.
Solo se lee al montar: para cambiar de nota usa `key={noteId}` o `api.updateScene`.

`ExcalidrawImperativeAPI`: `updateScene({elements, appState, collaborators, captureUpdate})`, `updateLibrary`, `resetScene`,
`getSceneElements()`, `getSceneElementsIncludingDeleted()`, `getAppState()`, `getFiles()`, `addFiles(BinaryFileData[])`,
`scrollToContent`, `setActiveTool`, `toggleSidebar`, `registerAction`, `refresh`, `setToast`, `updateFrameRendering`,
`onChange/onPointerDown/onPointerUp/onScrollChange/onUserFollow(cb) => unsubscribe`, `history.clear()`, `id`.
`captureUpdate`: `CaptureUpdateAction.IMMEDIATELY | EVENTUALLY | NEVER` (NEVER para cargas y cambios remotos).

Utilidades (0.18.1, **difieren de la web de docs**):

```ts
serializeAsJSON(elements: readonly ExcalidrawElement[], appState: Partial<AppState>,
                files: BinaryFiles, type: "local" | "database"): string          // 4 parámetros, NO el objeto de la doc
exportToBlob(opts: {elements, appState?, files: BinaryFiles|null, maxWidthOrHeight?, getDimensions?,
                    exportingFrame?, mimeType?, quality?, exportPadding?}): Promise<Blob>   // PNG por defecto, padding 10
exportToSvg({..., renderEmbeddables?: boolean, skipInliningFonts?: true, reuseImages?: boolean}): Promise<SVGSVGElement>
loadFromBlob(blob, localAppState|null, localElements|null, fileHandle?): Promise<RestoredDataState>  // lanza si no es escena
restore(data, localAppState, localElements, opts?), restoreElements, restoreAppState
convertToExcalidrawElements(skeleton, opts?: { regenerateIds: boolean }): ExcalidrawElement[]  // beta; regenera ids por defecto
```

`MainMenu` (`.Item`, `.ItemLink`, `.ItemCustom`, `.Group`, `.DefaultItems.*`): si lo renderizas, tú pones **todos** los ítems.
`Footer` solo escritorio. `Sidebar name=… docked? onDock?` + `Sidebar.Trigger`, `.Tabs/.Tab/.TabTriggers/.TabTrigger`, `.Header`.
La doc menciona `useEditorInterface`; **0.18.1 exporta `useDevice`** [O index.d.ts] (la doc va por delante del paquete).

## 3. Receta: incrustar un board propio dentro de una nota

Hechos del código publicado [O `dist/prod/chunk-K2UTITRG.js`, `index.js`]:

1. Un `embeddable` guarda su URL en `element.link`. Se pinta **solo si** `embedsValidationStatus[id] === true`, calculado con
   `validateEmbeddable` (función `Y_`): si es función y devuelve **boolean**, manda; si devuelve `undefined`, cae al allowlist por defecto;
   `string[]` compara solo el **hostname** (sin `www.`); `RegExp` prueba el link completo.
2. El allowlist por defecto no incluye tu dominio. Un `link` relativo revienta en `new URL()` → **usa siempre URL absoluta**.
3. Render: `this.props.renderEmbeddable?.(el, appState) ?? <iframe …>`. Devolver `null` activa el iframe de serie.
4. El iframe de serie lleva `sandbox="allow-scripts allow-forms allow-popups … allow-downloads"` y **`allow-same-origin` solo para
   hosts de la lista segura** (youtube, vimeo, figma, twitter/x, reddit, stackblitz, simplepdf). Un iframe a tu `/embed/board/:id`
   corre en **origen opaco**: sin Firebase Auth, sin IndexedDB, sin `localStorage`. **Por eso hay que usar `renderEmbeddable`.**
5. El contenedor aplica tamaño, rotación y `pointer-events` según el estado `activeEmbeddable` (hover/active); se interactúa tras clic.
   Un embed se monta al entrar en pantalla y se mantiene montado después (`initializedEmbeds`) [I de lectura del código].

```tsx
const BOARD_PATH = /^\/embed\/board\/([\w-]{8,})$/;
const parseBoardLink = (link?: string | null) => {
  try { const u = new URL(link ?? ""); const m = BOARD_PATH.exec(u.pathname);
        return u.origin === location.origin && m ? m[1] : null; } catch { return null; }
};

<Excalidraw
  excalidrawAPI={setApi}
  validateEmbeddable={(link) => (parseBoardLink(link) ? true : undefined)}   // undefined = allowlist por defecto
  renderEmbeddable={(el) => {
    const id = parseBoardLink(el.link);
    return id ? <BoardEmbed boardId={id} depth={depth + 1} /> : null;       // null = iframe de serie
  }}
  onLinkOpen={(el, ev) => { const id = parseBoardLink(el.link);
    if (id) { ev.preventDefault(); navigate(`/boards/${id}`); } }}          // abrir el board completo
/>
```

`BoardEmbed` = segundo `<Excalidraw viewModeEnabled zenModeEnabled initialData={…}/>` (solo lectura) alimentado por la misma capa de carga
de boards (Firestore + Storage) y con `key={boardId}`. Para devolver `false` a todo lo demás (bloquear el allowlist) usa `parseBoardLink(l) !== null`.

Crear el elemento: (a) UI «More tools → Web embed» y pegar `https://app/embed/board/<id>`; (b) por código, añadir con
`api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), embeddable] })`, donde `embeddable` tiene
`type:"embeddable"`, `x,y,width,height` y `link`. El tipo del skeleton admite `ExcalidrawIframeLikeElement`
completo [O transform.d.ts]; **no probado** si acepta un esqueleto parcial [?].

Riesgos a decidir: (i) **recursión** (board que se incrusta a sí mismo o ciclos A→B→A): pasar `depth` y cortar en 1–2 niveles;
(ii) **coste**: cada embed monta un editor completo; cargar lazy y limitar nº por nota; (iii) permisos: el embed lee con el
mismo usuario; si el board es privado, mostrar placeholder «sin acceso» en vez de error; (iv) `/embed/board/:id` como ruta
standalone (para compartir fuera) sí puede usar iframe normal, pero entonces necesita `X-Frame-Options`/`frame-ancestors` abiertos
y no hereda sesión; no la uses para el caso dentro-de-nota.

Export de una nota con embeds: `exportToSvg({renderEmbeddables:true})` incrusta `<foreignObject>` con el iframe/enlace; PNG/canvas
**no** renderiza el contenido embebido (solo marcador) [I]. Si necesitas miniatura, rasteriza el board hijo por separado.

## 4. Persistencia

**Formato de escena** (`serializeAsJSON`, `type:"excalidraw"`, `version:2`) [O]:

```json
{ "type":"excalidraw", "version":2, "source":"…", "elements":[…], "appState":{…}, "files":{ "<fileId>": {mimeType,id,dataURL,created,lastRetrieved?} } }
```

- `type:"local"` → elementos sin borrados, `appState` limpio y **incluye `files`** usados por los elementos. `type:"database"` →
  `appState` recortado y **`files: undefined`** [O código de `serializeAsJSON`]. Por tanto: `"database"` para Firestore, `files` aparte.
- `BinaryFiles = Record<FileId, BinaryFileData>`; `dataURL` es base64 (≈ +33 % sobre el binario). `api.getFiles()` puede traer ficheros
  no referenciados: filtra por `element.fileId` de los `image` no borrados antes de subir.
- Constantes en el bundle: ancho/alto máx. de imagen **1440 px** y tope **4 MiB** por fichero (valores observados; nombres
  `DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT` / `MAX_ALLOWED_FILE_BYTES` por inferencia) [O valores, I nombres]. El id por defecto es SHA-1 del contenido → deduplicación gratis.
- excalidraw.com guarda en `localStorage` las claves `excalidraw`, `excalidraw-state`, `excalidraw-theme`, `version-dataState`,
  `version-files`, `i18nextLng` (valores hasheados por REA) y las imágenes en IndexedDB [O REA; IndexedDB I]. No lo copies: es de su app.

**Tamaño típico** [? estimado, no medido]: un elemento serializa ~0,4–0,7 KB; una nota con 200 elementos ≈ 100–150 KB, 1000 ≈ 0,5–0,7 MB,
lejos del límite de **1 MiB por documento de Firestore**. Con imágenes base64 se supera enseguida → no guardes `files` en el documento.

**Recomendación (Firebase)**:
1. Documento `notes/{id}` o `boards/{id}`: `{ elements, appState(minimal), fileIds[], version, updatedAt }` usando `serializeAsJSON(…, "database")` (o guardar `elements` como string JSON para evitar problemas con `undefined`/arrays anidados en Firestore). Para escenas grandes, un blob JSON en Storage con la referencia en Firestore.
2. Imágenes en Storage: `notes/{id}/files/{fileId}` (el `fileId` ya es hash). Subir solo las ausentes; guardar `mimeType`, `created`.
3. Cargar: leer doc → descargar los `fileIds` → `initialData={{ elements, appState, files }}` (o `api.addFiles([...])` en diferido; Excalidraw muestra
   placeholder hasta que llegue el fichero). Pasar por `restore(data,null,null)` si el JSON puede venir de una versión vieja.
4. Guardar: `onChange` con **debounce** (≈1–2 s) + `flush` en `visibilitychange`/`pagehide`. Ignora los `onChange` provocados por la carga
   (`captureUpdate: NEVER` + comparar `getSceneVersion(elements)`/`hashElementsVersion`). Guarda solo si cambió la versión.
5. Concurrencia/colaboración: `reconcileElements(local, remote, appState)` y `updateScene({captureUpdate: CaptureUpdateAction.NEVER})`.
6. Evita guardar `appState` completo (incluye selección, cursor, diálogos); conserva `viewBackgroundColor`, `gridSize`, `theme` si hace falta.
7. Reglas Storage: validar `contentType` imagen/binary y `size < 4 MB`; borrar huérfanos con Cloud Function o barrido diferido.

## 5. Gotchas con Vite y React 19

- **React 19**: peer dep declarada como compatible [O package.json]; **no encontré incidencias específicas de React 19** en búsqueda [?]. No probado en este repo.
- **CSS obligatorio**: `import "@excalidraw/excalidraw/index.css"` (Vite lo procesa). Sin él el editor se ve roto.
- **Contenedor con alto**: el editor ocupa 100 % del bloque padre; si el padre tiene alto 0, no se ve nada. Con embeds, fija `width/height` en el contenedor.
- **Fuentes y assets**: por defecto se descargan de un CDN (`esm.run`, fallback `ASSETS_FALLBACK_URL`); excalidraw.com las sirve desde
  `excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/fonts/…` [O REA]. Para funcionar **offline/sin CDN**: copiar
  `node_modules/@excalidraw/excalidraw/dist/prod/fonts` a `public/` (≈14 MB, 13 MB son Xiaolai/CJK en carga diferida; latín ≈ 0,5 MB) y definir
  **antes** de montar: `window.EXCALIDRAW_ASSET_PATH = "/"` (acepta string o array de URLs). Si `fonts/` no queda en esa ruta, el texto cae a la fuente por defecto.
- **Tamaño del bundle**: `dist/prod` ≈ 2,8 MB minificado en 6 chunks + 55 locales (1,8 MB, carga diferida). Cárgalo con `React.lazy`/`import()`
  y en **chunk propio** (`manualChunks`); solo en las rutas de nota/board.
- **SSR**: no soportado (Next). En Vite SPA no aplica. Si usas prerender, importa dinámico solo en cliente.
- **Preact**: no aplica; si algún día, `define: { "process.env.IS_PREACT": JSON.stringify("true") }`.
- **`process.env`**: el bundle publicado no mostró accesos a `process.env` en los puntos revisados [I]; si Vite avisa de `process is not defined`, define `process.env.NODE_ENV`.
- **Exports condicionales**: `development` → `dist/dev`, `production` → `dist/prod`; Vite elige según el modo. Tipos solo vía subpath `@excalidraw/excalidraw/types` (`./*`).
- **StrictMode**: `excalidrawAPI` es callback; guárdalo en estado, no en ref; desmonta limpio (`onChange` de API devuelve unsubscribe).
- **Teclado**: `handleKeyboardGlobally` está en false; con varios editores (nota + embeds) déjalo así para no capturar atajos entre ellos.
- **`initialData` solo al montar**; no cambiar la nota sin `key`. `viewModeEnabled` manda sobre `initialData.appState.viewModeEnabled`.
- **Docs vs. paquete**: `serializeAsJSON` (4 args), `useEditorInterface` (no existe), `renderFooter` (eliminado). Confía en `dist/types`.
- **Licencias**: paquete MIT; la marca/Excalidraw+ no se incluyen. Dependencias con sus licencias (roughjs, jotai, radix…) a revisar en SBOM [?].

## 6. Evidencia de REA y limitaciones

Herramienta: servidor MCP `rea` (conectado en la sesión, **sin** usar `npx` de respaldo). Flujo de la skill `reverse-engineer-anything` para web,
Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe` en modo `launch` (perfil temporal).

| Evidencia | Qué probó |
|---|---|
| `ev_c67567e41ac0fdd13f1762b7457d207f425ee8b3cd2ea8b8c7089e22d8e97139` (capture_browser_scenario) | 19 transacciones: `index-COQVqmE8.js`, `bundler-helpers`, `workbox-window`, `roundRect`, `manifest.webmanifest`, fuentes en CDN DigitalOcean, Simple Analytics, Sentry |
| `ev_7acc553228f210937972a3caa0870e970aa3383f0f4ffd8c23bfd26921865582` (export_web_scripts) | solo 5 scripts pequeños exportados; el principal quedó `unavailable` (`body-size-limit`, 64 KiB) |
| `ev_29c36f890ec6f0fd6c39cc7dbda1508ae8fd58d30830d263d72b38f3943c052a` | UI con menú abierto (accesibilidad): herramientas, menú, 25 idiomas, claves de localStorage |
| `ev_5aeb65e7660e890f4a56ad33242acb462ea2d145962921f6be26fcd8f4e390b1` | reintento con límites mayores: el principal sigue `unavailable` (`body-allocation-limit`) |

Limitaciones honestas:
- **No pude exportar ni trazar el bundle principal de excalidraw.com**; `trace_web_module_imports` no se ejecutó (sin módulos ES exportados útiles).
  El análisis de código (embed, sandbox, `serializeAsJSON`, constantes) se hizo sobre el **paquete npm 0.18.1 descargado** (`npm pack`, extraído en el scratchpad) con lectura del JS minificado: es el artefacto publicado, **no** el de producción de excalidraw.com, que puede ir por delante.
- La captura es estática/superficial: **no dibujé ni incrusté un board** en vivo; la receta de §3 se deduce del código y los tipos, **no está ejecutada**.
- Nombres de funciones minificadas (`Y_`, `ja`, `Qa`) son locales a esa build; se citan por comportamiento.
- Tamaños de escena (§4) son estimaciones. Docs consultadas vía subagente `web-fetch` sobre docs.excalidraw.com (13 páginas, todas 200).
- Bytes de respuesta de Playwright pueden no coincidir con los de red (aviso de REA).

Fuentes: <https://excalidraw.com>, <https://docs.excalidraw.com>, <https://www.npmjs.com/package/@excalidraw/excalidraw>, tarball `@excalidraw/excalidraw@0.18.1`.
