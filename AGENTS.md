# AGENTS.md — DYA (Draw your Architecture)

## Propósito

App web personal y de código abierto con dos tipos de proyecto, como TinkerCAD:

- **Nota** (`note`): pizarra libre sobre Excalidraw 0.18.1; puede incrustar diagramas propios.
- **Diagrama** (`board`): lienzo estructurado tipo Miro sobre React Flow (formas, conectores, frames, stickies, iconos, autolayout).

Los proyectos propios se organizan en **carpetas anidadas** en el panel (`/folder/:id`).

Firebase Auth con Google. Crean proyectos el dueño (`OWNER_UID`, renderizado en las reglas) y las cuentas con **correo verificado** en `allowedEmails/{correo}` (el dueño las gestiona en Ajustes); se comparte por invitación (editor o viewer) con edición y cursores en tiempo real, y los enlaces públicos son de solo lectura. Un servidor MCP (`/api/mcp`, `src/server/`) deja que agentes lean y creen notas y boards, editen notas (`update_note`), incrusten diagramas en notas (`embed_board`), amplíen boards (`update_board`) y organicen las carpetas (`create_folder`, `update_folder`, `delete_folder`, `move_project`) como la propia persona. Pantalla objetivo: laptop (≥ 1024 px). Fuente de verdad del alcance y los contratos: `docs/plan.md`; stack: `docs/stack.md`; arquitectura: `docs/architecture.md`; MCP: `docs/mcp.md`; deuda: `docs/deuda.md`.

## Idioma

**Español** (`wigi.json` → `idioma: es`): textos de la interfaz, comentarios, commits y PR. Los tipos de commit y los identificadores de código, en inglés.

## Comandos

Gestor **pnpm 12** (corepack) y **Node 24.x**. Versiones exactas, sin `^`.

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Vite en desarrollo |
| `pnpm lint` | ESLint flat (incluye la regla de dependencia entre capas) |
| `pnpm typecheck` | `tsc -b --noEmit` (TypeScript strict) |
| `pnpm test` | Vitest: `domain`, `application`, `editors/**/model`, las pruebas de componentes (jsdom + Testing Library, `// @vitest-environment jsdom`; polyfills en `src/test/setup.ts`; repos en memoria en lugar de `services`, sin mocks de Firebase) y lo que cada carril añada en `src/**`. Con `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` corren también las pruebas de `src/server` contra los emuladores (necesitan Auth en 9099), en un proyecto propio por ejecución (`GCLOUD_PROJECT=demo-dya-t…`, lo fija `vite.config.ts`); sin ella se omiten |
| `pnpm test:e2e` | Playwright (`tests/e2e`): humo (3), colaboración de dos contextos (6) e imágenes (3) contra los emuladores. Helpers compartidos en `helpers.ts`. Usa su propio proyecto `demo-dya-e2e` (`VITE_EMULATOR_PROJECT`); `global-setup.ts` carga las reglas y arranca la base de tiempo real si no hay una en 9000. `E2E_PORT` cambia el puerto (5185). Si antes corrió `pnpm test` con emulador en los mismos emuladores, el inicio de sesión de la e2e falla: vacía el Auth de `demo-dya` con `curl -X DELETE http://127.0.0.1:9099/emulator/v1/projects/demo-dya/accounts` |
| `pnpm og:render` | Regenera `public/og-image.png` desde `scripts/brand/og-image.svg` (incrusta IBM Plex Sans desde `@fontsource`; no usa fuentes del sistema) |
| `pnpm favicon:render` | Regenera `public/favicon-32.png` y `public/apple-touch-icon.png` desde `public/favicon.svg` (Playwright) |
| `node scripts/bundle-mcp.mjs` | Regenera `api/_mcp.mjs` (el servidor MCP empaquetado); `pnpm test` falla si no está al día |
| `pnpm test:rules` | Renderiza las reglas del emulador y corre `tests/rules` (Firestore y Realtime Database). `scripts/test-rules.mjs` reutiliza los emuladores vivos en 8080 y 9000 y arranca con `firebase emulators:exec` solo los que faltan |
| `pnpm build` | `tsc -b && vite build` |
| `pnpm emulators` | Auth (9099), Firestore (8080) y Realtime Database (9000) locales (proyecto `demo-dya`; no necesita login) |
| `pnpm rules:render` | Genera `firestore.rules` con `OWNER_UID` de `.env` (para desplegar) |

Los emuladores necesitan Java 21. En Windows:
`export JAVA_HOME="C:/Program Files/Eclipse Adoptium/jre-21.0.13.9-hotspot"; export PATH="$JAVA_HOME/bin:$PATH"`.

Para trabajar con la app contra emuladores: `pnpm emulators` en una terminal y, en otra, `VITE_USE_EMULATORS=1 pnpm dev`. El botón de acceso entra con la cuenta de prueba `owner-test` (el mismo uid que las reglas renderizadas con `--emulator`). Fuera de los emuladores, la presencia necesita `VITE_FIREBASE_DATABASE_URL` (Realtime Database); sin ella se apaga sin romper nada.

## Capas y regla de dependencia

```
src/
  domain/                    Project, codec. TypeScript puro.
  application/               puertos (ProjectRepo, ContentRepo, FileStore, Identity), casos de uso, saveQueue
  infrastructure/firebase/   únicos ficheros que importan el SDK (Firestore, Auth y Realtime Database)
  editors/note/  editors/board/   Excalidraw y React Flow
  ui/                        tokens, tema, primitivas Radix, Button, IconButton, Toast
  app/                       rutas, AuthGate, shell, hooks, services.ts (composición)
  server/                    servidor MCP (Vercel `api/`): identidad con Admin, datos con el SDK web autenticado
tests/rules/  tests/e2e/
```

`domain ← application ← infrastructure`; `editors` y `app` consumen `application` y `domain`; **solo `app/` conecta `infrastructure/firebase`** (`app/services.ts`). ESLint lo impone con `no-restricted-imports`:

- `domain/` y `application/` no importan React, Firebase, zustand ni los motores.
- `editors/` no importa `infrastructure/` ni el SDK de Firebase.
- `editors/board/model/` es TypeScript puro: solo `import type` de `@xyflow/react`.
- `ui/` no conoce el dominio.

## Convenciones

- **Persistencia como string versionado** con `encode`/`decode` de `domain/codec.ts`. Hasta 900 000 bytes (`DOC_CONTENT_BYTES`): `projects/{id}/content/main = { data, schemaVersion: 1, revision, updatedAt }`. Por encima, **contenido troceado**: `content/main = { schemaVersion: 1, revision, updatedAt, chunks: n }` (sin `data`, 2 ≤ n ≤ 12) y `content/main/chunks/{i} = { data }` (≤ 900 000 bytes cada uno), todo en una transacción con la revisión esperada; tope práctico 8 MiB (`MAX_CONTENT_BYTES`). Las reglas no dejan escribir ni borrar un trozo sin que `content/main` suba una revisión en el mismo commit (solo borrar el proyecto es la excepción). **Una sola implementación**: `createContentRepo` (`infrastructure/firebase/contentRepo.ts`; la app lo liga a `loadFirestore` en `content.ts`, el servidor MCP a su Firestore autenticado) con la parte pura en `application/contentChunks.ts` (`splitContent`/`joinContent`/`joinChunks`). Unos trozos ausentes dentro de la transacción no son un error: devuelven un marcador «incompleto» y la lectura o la fusión se reintenta `READ_ATTEMPTS` veces (otro cliente pudo reducir el contenido a mitad; D45). Nadie lee ni escribe `content/main` a mano. Los avisos de tamaño usan `MAX_CONTENT_LABEL`, no un número literal.
- **Nodos y aristas del board se crean solo con `makeNode` y `makeEdge`**; `node.type === node.data.kind` y `edge.type === 'labeled'`. Todo contenido externo pasa por `validateBoardContent`.
- **Coordenadas**: los hijos (`parentId`) guardan posición relativa al padre y van después de él en el array; las operaciones geométricas usan `toAbsolute`/`toRelative`.
- **Guardado**: solo con `useAutosave` + `saveQueue`; el editor se monta con `key={id}` y no guarda hasta hidratar. Si el editor retiene cambios en un throttle, pasa un `drain` a `useAutosave` (`drainAndFlush`): se vacía antes de guardar en `pagehide`, al ocultar y al desmontar.
- **Firestore y Realtime Database se cargan con `import()`** (`infrastructure/firebase/firestore.ts` y `database.ts`; `files.ts` usa `loadFirestore`) para mantener el bundle inicial por debajo de 250 kB gzip; no los importes de forma estática desde otro sitio ni añadas `manualChunks` a `vite.config.ts`. `contentRepo.ts`, `firestoreModule.ts` y `errors.ts` no leen `import.meta.env` a propósito: el servidor MCP los empaqueta en Node.
- **Presencia y cursores en Realtime Database** (`presence/{ownerId}/{projectId}/{uid}/{sessionId}` (una sesión por pestaña, agrupada por uid), `onDisconnect().remove()`, cursor con throttle de 80 ms). RTDB no lee Firestore: el dueño publica el espejo de acceso `acl/{ownerId}/{projectId}` = `{ version, members, invites }` (`presenceAcl.publish`, transacción que reemplaza todo) y solo él lo lee y escribe. `version` es la `aclRev` del proyecto (solo el dueño la sube, +1 con cada cambio de miembros o invitaciones, en el mismo batch); las reglas RTDB rechazan una versión anterior. `publish` conserva, con la misma `version`, las altas de invitados cuya invitación sigue en la instantánea (unirse no sube `aclRev`; D40) y «Crear enlace» publica el espejo en segundo plano con reintento y aviso (D43). «Revocar y quitar» cierra primero la invitación y después retira a quienes entraron. Con el proyecto abierto, el dueño vigila `members` y `aclRev` (`ProjectRepo.watchAccess`) y republica en cada cambio, sin solapar publicaciones (`keepAclSynced`, D47). Firestore ya no recibe latidos. Reglas en `database.rules.json`, probadas en `tests/rules/database.test.ts`.
- **Carpetas**: `folders/{id} = { ownerId, name, parentId: string | null, createdAt, updatedAt }` (nombre recortado, 1–40: `MAX_FOLDER_NAME_LENGTH` y la regla `validFolderName`; un nombre anterior más largo se conserva al mover) y `folderId?: string | null` en el proyecto (ausente o `null` = Inicio; solo el dueño lo cambia). Las reglas dan la colección solo a su `ownerId` (se lista con `where('ownerId', '==', uid)` y se ordena en cliente: sin índice compuesto). Lógica pura en `domain/folder.ts` (`childrenOf`, `path`, `descendants`, `canMove`, `flatTree`); puerto `FolderRepo`, casos de uso en `application/folders.ts` e implementación en `infrastructure/firebase/folders.ts`. Ruta `/folder/:id` = el mismo `Dashboard` con `folderId`. Borrar una carpeta solo si está vacía y mover sin ciclos lo comprueba el cliente. El servidor MCP aplica las mismas comprobaciones (`src/server/folders.ts`: destino = carpeta propia existente, `canMove`, borrar solo vacía) y sus proyectos nacen en Inicio o en la carpeta `folderId` indicada. **Arrastrar y soltar** (HTML5 nativo, `app/dashboard/useDragDrop.ts`): una tarjeta o un chip se arrastran solo desde su enlace (no desde el menú ⋯) a un chip o a una miga (incluido «Inicio»); `canDrop` rechaza la carpeta actual, ella misma y sus descendientes (`canMove`), y esos destinos ni se resaltan ni aceptan; el teclado sigue con «Mover a…». **«Volver al panel»**: el panel abre cada proyecto con `{ from: <ruta del panel> }` en `history.state` (`Link state` / `navigate(…, { state })`); `App.tsx` lo lee (`useHistoryState`) y lo pasa como prop `origin` a los editores, que calculan el destino con `backPath` (`domain/folder.ts`: origen válido (`/` o `/folder/:id`), si no la carpeta del proyecto —solo si es suyo— y si no Inicio). **Ancho**: chips, migas, título (2 líneas), árbol de «Mover a…» y etiqueta de las tarjetas llevan tope y elipsis, con el nombre completo en `title`.
- **Lista de permitidos por correo**: `allowedEmails/{correo en minúsculas}`; `canCreate()` en las reglas = dueño o `email_verified` + entrada en la lista. `allowedUsers` (por UID) ya no existe.
- **Servidor MCP**: Admin solo da identidad (`mcpTokens` → uid, `createCustomToken`); los datos pasan por el SDK web autenticado (`src/server/userDb.ts`), así que las reglas aplican tal cual y no hay autorización duplicada a mano.
- **Un solo camino por operación del board**: borrar = `removeSelected` (atajos), estilo = `updateNodeData(ids, { style })`, paths de formas e iconos = `editors/board/nodes`. Los nodos bloqueados son seleccionables pero no arrastrables ni borrables.
- **Archivos**: sin Storage; viven en Firestore troceados (`projects/{id}/files/{fileId}` con `createdBy` (quien sube, que puede borrarlo) + `chunks/{i}`, ≤ 900 000 bytes por trozo). Toda subida pasa antes por `optimizeImage` (`application/imageOptimize.ts`: ≤ 2048 px, WebP 0,82, GIF intacto). PNG, JPEG, GIF y WebP; hasta 4 MiB tras optimizar.
- **Estilos**: CSS Modules + tokens de `src/ui/tokens.css`; nada de colores literales en el chrome (los colores del dibujo persistido sí son literales y no cambian con el tema). Sistema visual «mesa de dibujo técnico» (rediseño de 2026-11-12; ficha y razones en `HANDOFF.md`):
  - **Color**: neutros de grafito cálido (matiz 75–85) y un solo color de acción, verde de tapete de corte (`--accent`, OKLCH matiz 172); el resto son estados. Los nombres de los tokens son los de siempre; los nuevos son `--accent-edge`, `--danger-edge` (canto del botón), `--focus-gap` (hueco del anillo de foco), `--text-3xl`, `--edge`, `--control-h-touch` y `--registro`. Todo valor nuevo entra como token.
  - **Tipografía**: IBM Plex Sans autoalojada (`@fontsource/ibm-plex-sans`, subconjunto latino 400/500/600, importada en `main.tsx` antes de `tokens.css`; sin CDN). Pesos de uso: 400 lectura, 500 etiquetas y botones, 600 títulos; nada de 550/650/700. `--font-mono` solo para datos (URL, atajos, código). Cifras con `tabular-nums` en contadores y fechas.
  - **Forma y profundidad**: radios 4 px controles, 6 px contenedores, 10 px diálogos y lámina de acceso; círculo solo en avatares, contadores y muestras de color. Los planos se separan con un filete de 1 px; solo lo que flota sobre el lienzo (menús, popovers, diálogos, barras, tooltips) lleva `--shadow-float`, la única sombra.
  - **Botón con cuerpo** (`ui/Button`): el canto es el borde inferior de `--edge` (3 px), un paso más oscuro que la cara; al pulsar la cara cubre el canto y nada salta. Las barras y cabeceras densas sobre el lienzo declaran la **salida plana** con `data-densidad="compacta"` (editor de diagrama, barra de la nota, cabecera del visor). Deshabilitado = hundido, sin opacidad. `IconButton` siempre plano.
  - **Foco**: anillo doble global en `base.css` (`outline` + `box-shadow` de hueco `--focus-gap`); no se redefine por componente. Excepciones anotadas: contenedores que recortan (controles y minimapa de React Flow, ítems de menú) lo dibujan hacia dentro.
  - **Campos**: `ui/Input`, `ui/Textarea` y `ui/Select` (aspecto en `ui/Field.module.css`). `Select` envuelve al `<select>` nativo, que sigue siendo el control; la lista se dibuja solo donde existe `appearance: base-select` (Chromium y WebKit recientes) y en Firefox queda la lista nativa. Los campos de texto llevan `placeholder`.
  - **Firma**: marcas de registro (`.registro`, utilidad global de `base.css`; el anfitrión debe estar posicionado) en vistas previas de tarjetas, dibujo del acceso, vacíos y páginas de estado; las tarjetas llevan un cajetín (título, tipo, fecha) y un esbozo por tipo (`Sketch` en `typeMeta.tsx`), no la miniatura real.
  - **Sin subrayados** (`a` sin `text-decoration`; las acciones en texto llevan peso 600, flecha y fondo tenue al pasar y enfocar). Excalidraw se tematiza por sus variables CSS en `NoteCanvas.module.css`; React Flow, por `--xy-*` en `flow.module.css`.
- **Compatibilidad**: objetivo Safari 14.1 / iOS 14.5, Chrome y Edge 90, Firefox 90 y Samsung 15 (`build.target` en `vite.config.ts` y `browserslist` en `package.json`; mantener los dos iguales). CSS por mejora progresiva: sin `:has()` imprescindible (un selector inválido en una lista descarta la regla entera: ponlo aparte y da un respaldo; el estado elegido va en `data-checked`), `vh` antes de `dvh`, `transform` y no `translate`, hex y no `color-mix`/`oklch` (tokens), `@media (hover: hover)` para todo `:hover`, `@supports not selector(...)` para respaldos de selectores. JS: las APIs que faltan en el suelo van en `src/compat.ts` (`structuredClone`, `Object.hasOwn`, `at`); las demás, con guarda donde su fallo rompa la tarea.
- **Favicon**: `public/favicon.svg` (claro/oscuro dentro del SVG), `favicon-32.png` y `apple-touch-icon.png`; los PNG salen de `pnpm favicon:render`. Sin manifest: DYA no es una PWA.
- **Alto contraste (`forced-colors`)**: el estado activo (`aria-pressed`, `aria-selected`, `aria-checked`, `data-checked`) se invierte con `Highlight`/`HighlightText` en el `.module.css` de cada componente propio, junto a su regla del estado; no hay regla global por atributo (alcanzaría a Excalidraw, React Flow y Radix). Un componente nuevo con estado activo añade su bloque `@media (forced-colors: active)`.
- **Nota en ventanas estrechas**: por debajo de 1100 px la barra de la nota va en una fila propia encima del lienzo (`CanvasUi.docked`, `DOCK_QUERY` en `NoteCanvasInner`); no se toca el DOM de Excalidraw. El texto del título en edición vive en `NoteEditor` (`titleEdit`), no en `TopBar`: la barra se monta en una de las dos ubicaciones según el ancho y el texto sin confirmar debe sobrevivir al cambio. Con la barra flotante (≥ 1101 px) el CSS de Excalidraw pisa el foco de sus botones: `TopBar.module.css` repite el anillo doble con más especificidad y `SharePopover` devuelve el foco a «Compartir» al cerrar.
- **Accesibilidad**: Radix para overlays; `aria-label` y tooltip en botones de icono; `:focus-visible` visible; enlace «Saltar al contenido» como primer enfocable del `Shell`; objetivos de 44 px con `pointer: coarse` (tokens `--control-h-*`); respetar `prefers-reduced-motion` (el trazo del acceso solo se anima con `no-preference`).
- **Atajos** solo con el editor enfocado; se ignoran en inputs, contentEditable e IME.
- Commits: Conventional Commits en español, atómicos, el árbol compila en cada uno. Ámbitos: ver `wigi.json`.
- Una prueba por cosa que puede romperse; las reglas se prueban contra los emuladores, sin mocks de Firebase.
- Con emuladores ya corriendo, `pnpm test:rules` los reutiliza (detecta 8080 y 9000) y arranca solo los que faltan. Las reglas de Firestore son un recurso compartido del emulador: en el proyecto `demo-dya` quien las carga pisa las de otro carril. Por eso `test:rules` corre en un proyecto propio por ejecución (`RULES_PROJECT`) y el e2e en `demo-dya-e2e`: ninguno limpia ni recarga lo del otro. El emulador de Auth no separa por proyecto (siempre `demo-dya`).

## Qué no tocar

- `docs/plan.md`, `docs/stack.md` y `docs/architecture.md` (los cambia quien planifica).
- Cada carril escribe solo en sus rutas (tabla «Propiedad de archivos» de `docs/plan.md`); `domain/`, `application/`, `infrastructure/`, `ui/`, `app/` (salvo su carpeta) y `model/{board,geometry,validate,fixtures}.ts` los resuelve T5. Lo que haga falta se anota en `HANDOFF-<carril>.md`.
- Las firmas de los stubs de T0 no se cambian: se implementan.
- `firestore.rules` está generado (`.gitignore`): se edita la plantilla `firestore.rules.tpl`. `database.rules.json` (Realtime Database) sí se edita a mano.
- `api/_mcp.mjs` está generado por `scripts/bundle-mcp.mjs`: no se edita, se regenera.
- `public/excalidraw-assets/` son las fuentes copiadas de `node_modules/@excalidraw/excalidraw/dist/prod/fonts`; no se editan.
- `.env*` (salvo `.env.example`) y `.wigi/` no se versionan. Nada de claves ni UID reales en el repo.
- Sin `push`, `merge` ni cuentas reales de Firebase o Vercel salvo que Juan lo pida.
