# HANDOFF — drawyourarquitecture

## Dónde estamos

**Desplegado en producción (2026-11-05 13:09):** https://drawyourarchitecture.vercel.app (Vercel, equipo personal `juangaitands-projects`). Firebase `drawyourarchitecture` en plan gratuito: Firestore `(default)` con reglas e índices desplegados (`OWNER_UID` del dueño), Auth Google con el dominio de Vercel autorizado, Analytics `G-TPM775TWZ2`. Las reglas de producción se generan en `.wigi/deploy/` (no versionado) para no pisar las del emulador. Pendiente: revisión GPT-6.1-sol de lo cambiado tras la revisión final (correcciones, imágenes en Firestore, despliegue) cuando haya cuota.

**T5 · Integración terminada** en la rama `feat/base` (sin push): los carriles C1, C2, D, A y B están fusionados (`chore(merge): integrar carril <X>`, sin conflictos) y los pendientes cruzados resueltos. Gates `lint`, `typecheck`, `test` (309), `test:rules` (25) y `build` en verde. Bundle inicial **152,7 kB gzip** (objetivo < 250). Probado a mano en Chrome contra los emuladores (nota con imagen y board embebido, board con plantilla, Mermaid, ordenar, PNG, JSON, atajos, bloqueo, enlace público sin sesión, despublicar, conflicto entre pestañas, claro y oscuro a 1280 y 1024 px).

**Imágenes en Firestore, sin Storage** (decisión de Juan, 2026-11-05): `FileStore` guarda cada imagen troceada en `projects/{id}/files/{fileId}` + `chunks/{i}` y toda subida (nota y board) se optimiza antes (`application/imageOptimize.ts`). Ya no hay Storage, `cors.json` ni plan Blaze en el proyecto. Detalle en «Imágenes en Firestore».

**T7 · Revisión final corregida** (6 hallazgos de `.wigi/review/final-gpt.md`, un commit por cada uno, ver «Correcciones de la revisión final»). Gates `lint`, `typecheck`, `test` y `build` en verde (`test:rules` no se tocó: no cambian las reglas).

Siguen T6 (e2e) y T8 (despliegue, pendiente de Juan).

## Lo que hay

| Pieza            | Dónde                                                                  | Estado                                                                                                 |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Dominio          | `src/domain/{project,codec}.ts`                                        | Hecho y probado                                                                                        |
| Aplicación       | `src/application/{ports,projects,saveQueue}.ts`                        | Hecho y probado (gate de hidratación, cola serial, conflicto, borrador)                                |
| Infraestructura  | `src/infrastructure/firebase/*`                                        | Hecho; Firestore se carga con `import()`                                                                 |
| Modelo del board | `src/editors/board/model/{board,geometry,validate,fixtures}.ts`        | Hecho y probado                                                                                        |
| UI               | `src/ui/*`                                                             | Tokens, tema (claro/oscuro/sistema), Dialog, DropdownMenu, Popover, Tooltip, Button, IconButton, Toast |
| App              | `src/app/*`                                                            | Router (5 rutas + 404), AuthGate, login, shell, hooks, `services.ts`, páginas lazy                     |
| Reglas           | `firestore.rules.tpl`, `scripts/render-rules.mjs`                      | 27 casos en `tests/rules`                                                                              |
| Despliegue       | `firebase.json`, `firestore.indexes.json`, `vercel.json`               | Escritos, sin desplegar                                                                                |

### Carriles integrados

| Carril                | Qué trae                                                                                                                                                      | Dónde                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| C1 · Núcleo del board | Store por instancia (zustand + zundo), 6 nodos, `LabeledEdge`, `BoardCanvas`, `BoardViewer`, `BoardEditor` (carga → validación → hidratación → `useAutosave`) | `editors/board/{store,canvas,nodes,edges}`, `BoardEditor.tsx`, `BoardViewer.tsx` |
| C2 · UI del board     | `Toolbar`, `StylePanel`, `ActionBar`, `SearchBox`, atajos, `model/ops.ts`                                                                                     | `editors/board/ui`, `model/ops.ts`                                               |
| D · Extras            | `BoardMenu` (plantillas, Mermaid, ordenar, PNG, JSON), `parseFlowchart`/`toFlowchart`, `autoLayout` (dagre por niveles)                                       | `editors/board/extras`, `model/{mermaid,layout}.ts`, `model/templates`           |
| A · Panel y visor     | Panel, `/view/:type/:id`, `/embed/board/:id`                                                                                                                  | `app/dashboard`, `app/viewer`                                                    |
| B · Nota              | Excalidraw con autosave, imágenes (cola de subida), embed de board, «Insertar diagrama», librería                                                             | `editors/note`                                                                   |

### Puntos de contacto que conviene conocer

- `app/services.ts` exporta `createProject`, `duplicateProject`, `deleteProject`, `saveAsCopy` (ya ligados a Firebase), y `projectRepo`, `contentRepo`, `fileStore`, `identity`. Los editores los importan de ahí (permitido por el lint; `infrastructure/` y el SDK no).
- `useAutosave(id, encoded, hydrated, revision, baseline?)`: el 5.º argumento es opcional (añadido al contrato). Sin él, la base de comparación es el primer `encoded` tras hidratar. Devuelve además de `{status, error, flush, resolveConflict}` lo que dice el plan.
- `useProject(id)` devuelve `{status: 'loading'|'ready'|'missing'|'error', project, content, error, draft, discardDraft, reload}`. `ready` es la señal de hidratación; `draft` es el borrador local más reciente que difiere de lo guardado.
- `createSaveQueue(repo, id, initialRevision | null, opts?)`: con `null` no escribe hasta `hydrate(revision, lastSaved)`. Extras sobre el contrato: `hydrate`, `hasPending`, `dispose`, `state`.
- `recoverableDrafts`, `readDraft`, `clearDraft` y `draftKey(id, sessionId)` están exportados de `application/saveQueue.ts` para «Recuperar cambios no guardados».
- Revisión inicial del contenido: **0** al crear; cada guardado sube una (las reglas lo exigen: `revision == resource.revision + 1`).
- `ProjectRepo.remove` borra `content/main` y el proyecto en un batch; los archivos los borra antes `deleteProject`.
- `window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/'` se fija en `main.tsx`. El carril B debe importar `@excalidraw/excalidraw/index.css` en `NoteCanvas`.
- Tema para los motores: `useTheme().resolved` (`'light' | 'dark'`) va a `theme` de Excalidraw y `colorMode` de React Flow.

## Cómo probar en local

```
export JAVA_HOME="C:/Program Files/Eclipse Adoptium/jre-21.0.13.9-hotspot"; export PATH="$JAVA_HOME/bin:$PATH"
pnpm emulators                        # terminal 1: auth 9099, firestore 8080 (proyecto demo-dya)
VITE_USE_EMULATORS=1 pnpm dev         # terminal 2; «Entrar con la cuenta de prueba» → uid owner-test
```

## Desviaciones del plan y decisiones

1. **pnpm 12.6.0** (`corepack enable` sin errores y pnpm ya disponible en la máquina: no hizo falta `npm i -g`; fijado en `packageManager`). `pnpm-workspace.yaml` solo declara `allowBuilds` (los scripts de instalación de `@firebase/util`, `protobufjs`, `esbuild` y `re2` no hacen falta) y `minimumReleaseAgeExclude` para `lucide-react@1.69.0`, que pnpm 12 añadió por ser muy reciente.
2. **TypeScript 6.0.3**, no 7.0.2: `typescript-eslint@8.72.1` declara `typescript >=4.8.4 <6.1.0`. Subir cuando typescript-eslint admita 7.
3. **Vite 8.3.6**: la comprobación de humo pasó (Excalidraw + React Flow, React 19, `pnpm build` y navegación sin errores de consola); no hizo falta bajar a Vite 7.
4. **Reglas como plantillas.** El plan dice que `render-rules.mjs` toma `OWNER_UID` de `.env`; para no versionar un `firestore.rules` con un UID de prueba, lo versionado es `firestore.rules.tpl` y el `firestore.rules` generado están en `.gitignore`. Antes de `firebase deploy` hay que correr `pnpm rules:render` (necesita `OWNER_UID`).
5. **`OWNER_UID` en `.env.example`** (sin prefijo `VITE_`: no llega al navegador) y **`VITE_FIREBASE_MEASUREMENT_ID`** (pedida por Juan; Analytics **no** está integrado).
6. **Fuentes de Excalidraw sin Xiaolai** (el subconjunto CJK, ≈ 13 MB): `public/excalidraw-assets/fonts` pesa 500 KB. Si hace falta CJK: `cp -r node_modules/@excalidraw/excalidraw/dist/prod/fonts/Xiaolai public/excalidraw-assets/fonts/`.
7. **`useAutosave` con 5.º parámetro opcional `baseline`** y `createSaveQueue` con `initialRevision: number | null` (superset del contrato; ver arriba).
8. **Login de prueba del emulador**: crea el usuario `owner-test` con la API de administración del emulador de Auth (`localId` fijo) y entra con correo y clave. Solo se ejecuta con `VITE_USE_EMULATORS=1`.
9. **Open Graph genérico sin imagen**: `index.html` lleva título, descripción y `og:*`, pero no `og:image` (falta el recurso de marca en PNG).
10. `vercel.json` también excluye `/excalidraw-assets/` del rewrite (los ficheros de `public/` ya se sirven antes del rewrite, pero así queda explícito) y le da caché de 7 días (los nombres no llevan hash).
11. **CORS (`cors.json`)** abre `GET`/`HEAD` a cualquier origen: la lectura sigue protegida por las reglas y el token de Auth, no por el origen.

### Decisiones de la integración (T5)

12. **Un solo camino de borrado**: React Flow ya no borra (`deleteKeyCode={null}`); lo hace `useShortcuts` con `removeSelected` (respeta `locked`, limpia hijos de un frame y aristas colgantes, un paso de historial). Los atajos se montan con `<Shortcuts container>` dentro de los providers; `BoardMenu` recibe `getViewport` y `onContentChanged` (fitView tras medir).
13. **Un solo camino de estilo**: `updateNodeData(ids, { style })` con estilo parcial (tipo `NodeDataPatch`); `patchStyle` de C2 se eliminó.
14. **Bloqueados**: `toDisplayNodes` deja `locked` como no arrastrable, no borrable y no conectable, pero **seleccionable**. «Desbloquear todo» (ActionBar y Mod+L sin selección) se mantiene.
15. **Herramienta imagen**: al elegirla abre el selector de archivo y coloca la imagen en el centro de la vista con la subida de C1 (ya no espera un clic en el lienzo).
16. **Glifos**: `ui/glyphs.tsx` solo conserva rótulos y `ShapePreview`; los paths (`shapePath`) y el mapa de iconos (`iconComponent`) son los de `editors/board/nodes`.
17. **UI de C2 sin ranuras**: Toolbar, StylePanel, SearchBox y ActionBar se posicionan solos dentro de `.stage`; las ranuras absolutas de C1 los dejaban a tamaño cero. Se quitaron de `Controls` los botones de cuadrícula y snap (ya están en la ActionBar).
18. **Foco**: al terminar de editar un texto con Enter o Esc el foco vuelve al nodo (`store/returnFocus.ts`); sin eso los atajos callaban hasta el siguiente clic. `ui/Dialog` admite `initialFocus` y exporta `useReturnFocus` (borrar proyecto y reemplazar diagrama enfocan «Cancelar»; al cerrar, el foco vuelve al botón que abrió el menú).
19. **Imágenes en lectura**: `BoardViewer` recibe `files={{ load }}` en `Viewer`, `EmbedPage` y `BoardEmbed`.
20. **Último cambio**: `drainAndFlush` (`application/saveQueue.ts`, con test) pasa a la cola lo que retiene el throttle del editor (B 150 ms, C1 250 ms) y la escribe; `useAutosave` admite un 6.º argumento `drain` y escucha también `pagehide`. `useEncodedContent` y `NoteHandle.drain()` lo implementan. B ya no emite al desmontar el lienzo (los efectos del padre se limpian antes). Comprobado: crear una forma y recargar a los ~30 ms deja el borrador y se recupera.
21. **Bundle**: `vite.config.ts` ya no usa `manualChunks` (arrastraba React y Radix al chunk de Excalidraw y `index.html` precargaba ≈ 1,8 MB gzip). Firestore se carga con `import()` (`infrastructure/firebase/firestore.ts`). `ThemeToggle` y `UserMenu` viven en el chunk inicial, así que no inflan el del editor y no hizo falta moverlos a `ui/`.
22. **`/note` a 1024 px**: la barra superior de B oculta el texto del estado (queda para lectores de pantalla) y acorta el título para que quepa «Biblioteca».

### Correcciones de la revisión final (T7)

23. **Guardar como copia** (`application/projects.ts`): `saveAsCopy` y `duplicateProject` comparten `copyProject`: crean el proyecto, copian los archivos con el mismo `fileId`, escriben el contenido al final y, si algo falla, borran la copia incompleta.
24. **Borradores por pestaña** (`application/saveQueue.ts`): clave `draft:<id>:<sessionId>` (un `sessionId` por cola); la cola solo borra el suyo al confirmar. `recoverableDrafts(id, {data, revision})` sustituye a `recoverableDraft`: ofrece los de cualquier sesión cuyo contenido difiera del servidor, **sin descartar por fecha**, el más reciente primero; borra los idénticos al servidor y marca `stale` si su revisión base no es la guardada (los banners lo dicen). `useProject.draft` es el primero de la lista y `discardDraft` borra solo ese y pasa al siguiente. `DraftStorage` pide `length` y `key(i)`; `readDraft`/`clearDraft` reciben la clave completa.
25. **Reparentar sin ciclos** (`editors/board/store/reparent.ts`): ningún nodo de la selección ni descendiente suyo es destino de otro; los destinos se resuelven a la vez sobre la geometría original. **Guardado validado**: `useEncodedContent` pasa `validateBoardContent` antes de codificar (`computeEncoded`); si falla, no hay `encoded` (no se guarda) y el editor muestra un banner con el motivo.
26. **Validación** (`model/validate.ts`): `shape` ∈ `SHAPES`, `icon` ∈ `ICONS`, `fileId` string en imágenes y `style.{fill,stroke,textColor}` string y `{strokeWidth,opacity,fontSize}` número finito. `dashed`, `bold` y `align` no se validan (no rompen el pintado).
27. **Borrar un frame** (`removeSelected`): los descendientes bloqueados sobreviven (con su subárbol) y pasan al ancestro superviviente con la posición absoluta conservada.
28. **JSON sin imágenes**: el ítem pasa a «Descargar JSON (sin imágenes)» y el toast dice que no es una copia de seguridad completa. Transportar los binarios en el JSON **queda pendiente**.

### Bundle inicial (gzip, lo que pide `index.html`)

| Medida                                 | Tamaño                             |
| -------------------------------------- | ---------------------------------- |
| T0 (sin editores)                      | ≈ 288 kB                           |
| Rama integrada, con `manualChunks`     | 1 863,6 kB (Excalidraw precargado) |
| Sin `manualChunks`, Firestore estático | 293,7 kB                           |
| **Final (Firestore con `import()`)**   | **152,7 kB**                       |

### Decisiones y desviaciones de los carriles

- **C1**: `BoardState` añade `editingId`/`setEditingId`; `updateNodeData` mezcla el estilo parcial; `removeSelected` borra hijos y aristas colgantes y respeta `locked`. El color por defecto de texto suelto, iconos, título de frame y aristas usa tokens (legible en oscuro); lo dibujado es literal. Los frames van detrás por CSS (`z-index: -1`) y el texto suelto tiene alto automático. `window.__board` (solo `import.meta.env.DEV`) expone el store para pruebas.
- **C2**: `model/ops.ts` añade `rootsOf`, `nudge`, `setLocked`, `selectOnly`. Los bloqueados no participan en alinear, distribuir ni mover; un padre y su hijo seleccionados juntos se mueven una sola vez; `wrapInFrame` mete el frame en el padre común; `duplicate` incluye descendientes. Los atajos escuchan `keydown` en captura y mandan sobre los de React Flow. El portapapeles es en memoria (por store), no el del sistema.
- **D**: layout **por niveles** (dagre por frame, +32 px de relleno y 40 de cabecera) en vez de un grafo compound; `autoLayout` reescribe `sourceHandle`/`targetHandle` según el sentido; `parseFlowchart` devuelve también `direction`; gramática extra (hexágono, paralelogramo, `-.-`, `===`, `;`, comillas) e ignora `style`/`classDef`/`class`/`linkStyle`/`click`/`direction`; no admite `&` ni flechas bidireccionales. `toFlowchart` pierde stickies, textos, iconos y estilos. Reemplazar (plantilla, Mermaid, JSON) pide confirmación si el lienzo no está vacío. PNG: margen 48 px, lado máximo 4096 px de CSS (escala 2), fondo blanco fijo; JSON hasta 8 MB; `html-to-image` por `import()`.
- **A**: «Error de red» + «Reintentar» también para contenido ilegible; un tipo equivocado en `/view/:type/:id` se trata como «No existe o es privado»; el dueño con sesión ve «Editar» en el visor; tabs manuales (no hay `@radix-ui/react-tabs`); un único ítem de menú alterna publicar/dejar de compartir y aparece «Copiar enlace».
- **B**: `NoteCanvasProps` añade `topRight` y `onHandle`; `NoteHandle` añade `applyContent` y `drain`. Los avisos (conflicto, error, demasiado grande, «Recuperar») van en un banner bajo la barra de herramientas. El archivo se registra en `content.files` al detectarlo (no al terminar la subida); SVG o > 4 MiB se retiran de la escena con un toast; recuperar un borrador no es deshacible. En una nota pública un board incrustado solo se ve si **el board también es público** (si no, «Diagrama privado o inexistente»); «Abrir» va a `/view/board/:id` en lectura.

## Riesgos y deuda

- **Imágenes en Firestore**: cada lectura de un trozo de un proyecto público cuesta una lectura extra por el `get()` al proyecto en las reglas (cuota Spark: 50 000 lecturas al día); una imagen de 1 MiB son 2 trozos. Sin Storage no hay rol IAM ni CORS que configurar.
- `ContentRepo.load` y `ProjectRepo.get` devuelven `null` ante `permission-denied` (privado y no existente se ven igual, a propósito); los demás errores se propagan.
- Los tests de reglas escriben `firestore-debug.log` / `ui-debug.log` en la raíz (ignorados por git). `pnpm test:rules` arranca sus emuladores en 9099/8080: si ya hay otros corriendo, falla con «port taken»; entonces `node scripts/render-rules.mjs --emulator` y `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm exec vitest run --config vitest.rules.config.ts` (así se verificó en T5: 25 casos).
- **Pendientes del board**: conector por clic origen → destino (hoy solo arrastrar desde un handle); el viewport se guarda con el siguiente cambio de contenido (pan y zoom solos no disparan guardado); el historial compara por JSON (O(n); pasar a referencia con tableros de miles de nodos, `ponytail` en `boardStore.ts`); cada forma nueva son dos pasos de historial (crear y escribir la etiqueta).
- **Pendientes de la nota**: el toast «Reintentar» de subida con Firestore caído solo está probado por test de la cola, no en navegador; con una subida agotada el binario solo sigue en memoria. Los `Abrir`/`Recargar` de un embed solo reciben el ratón cuando Excalidraw activa el embed (doble clic).
- **Último cambio al cerrar la pestaña**: el borrador local se escribe de forma síncrona y se ofrece «Recuperar»; la escritura en Firestore al `pagehide` no está garantizada (el navegador puede cortarla).
- Los embeds muestran la atribución «React Flow» (sin plan Pro). El título de la plantilla «Web de 3 capas» se parte en dos líneas (texto suelto estrecho).
- Sin tests de componentes (Vitest corre en `node`, sin jsdom): la lógica no trivial está en funciones puras probadas; el comportamiento de UI se comprobó en Chrome. Lo cubrirá T6 (e2e).
- El 400 de `identitytoolkit … /accounts` en consola con emuladores es el login de prueba (el usuario `owner-test` ya existe), no un error de la app.

## Imágenes en Firestore

- **Modelo**: `projects/{id}/files/{fileId} = { mimeType, size, chunks, createdAt }` y `…/chunks/{i} = { data: Bytes }` (≤ 900 000 bytes). Adaptador en `infrastructure/firebase/files.ts`; el troceado y el reparto en batch son puros (`application/fileChunks.ts`, con tests). La meta se escribe la última.
- **Optimización** (`application/imageOptimize.ts`, lógica pura con el códec del navegador inyectable): lado mayor ≤ 2048 px, WebP 0,82, se conserva solo si pesa menos; GIF tal cual; sin WebP o sin poder decodificar, el original; tope de 4 MiB tras optimizar. La usan `NoteCanvasInner` y `BoardCanvas.placeImage`; copiar o duplicar un proyecto no recodifica.
- **Medido** (PNG sintético 3200×2400 de 21 016 258 bytes, en Chrome contra los emuladores): el board lo guardó como WebP de 2048×1536 y 138 214 bytes (−99,3 %); pegado en una nota, WebP de 18 356 bytes (Excalidraw ya lo reduce a 1440 px antes). Tras recargar se ve en el editor y en el visor público sin sesión.
- **Retirado**: `storage.rules.tpl`, `cors.json`, la sección `storage` de `firebase.json`, el emulador de Storage, `firebase/storage` y `VITE_FIREBASE_STORAGE_BUCKET`. Los archivos que ya hubiera en un bucket de pruebas no se migran (no hay datos reales).
- **Accesibilidad**: los handles de conexión de `NodeChrome` son `role="button"` con «Conectar desde el lado derecho/izquierdo/superior/inferior» (`aria-hidden` en solo lectura o bloqueado).

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` (Vitest) · `pnpm test:rules` (emuladores; exige Java 21 en el `PATH`; 27 casos) · `pnpm build`.

## Lo que sigue

T6 e2e (`tests/e2e/smoke.spec.ts`: board con forma y conector que persisten tras recargar, nota con el board insertado, enlace público sin sesión) → T7 revisión → T8 despliegue (pendiente de Juan: proyecto Firebase (Spark), su UID, la cuenta de Vercel y Analytics, que **no** está integrado).

## Hoja de ruta por fases (decisión de Juan, 2026-11-05)

1. **Fase 1 (esta):** un solo dueño, notas y diagramas, enlace público de solo lectura.
2. **Fase 2:** colaboración en tiempo real (otra implementación del puerto de contenido; Firestore `onSnapshot` + reconciliación o Yjs).
3. **Fase 3:** **servidor MCP** para que agentes de IA lean y creen las notas y diagramas de un usuario autenticado. El objetivo es un sistema que haga diagramas y notas y que procese esas notas para arrancar o detallar un proyecto. Requisitos previstos: autenticación por usuario (OAuth o token personal revocable), permisos por proyecto, operaciones `list/read/create/update` sobre los formatos versionados (`NoteContent`, `BoardContent`), validación con los mismos codecs (`validateBoardContent`) y registro de auditoría. Encaja como otro adaptador sobre `application/` (casos de uso y puertos), sin tocar los editores.

## Carril P3 · Servidor MCP (rama `lane/p3-mcp`, sin push)

Detalle de uso, herramientas y seguridad en `docs/mcp.md`. Estado: las 5 entregas hechas; gates `lint`, `typecheck`, `test` (con `FIRESTORE_EMULATOR_HOST`), `test:rules` (36 casos) y `build` en verde; **sin desplegar** (necesita las variables `FIREBASE_SERVICE_ACCOUNT` y `OWNER_UID` en Vercel y las reglas nuevas en producción).

- **Reglas** (`firestore.rules.tpl`): bloques `allowedUsers/{uid}` (escribe solo `OWNER_UID`; cada persona lee el suyo) y `mcpTokens/{hash}` (crear con `uid == auth.uid`, id = sha256 hex, campos cerrados; leer y revocar los propios, `revoked` solo pasa a `true`). `isAllowedCreator()` = `isOwner()` o existe `allowedUsers/{uid}`; se usa en el `create` de `projects` **y** en el de `content/main` (el batch de creación escribe ambos). **Integración con P2:** P2 trae `canCreate()` en el mismo bloque; unificar en una sola función. Ojo: el resto de las reglas de `projects/**` siguen siendo `isOwner() && ownerId == uid`, así que un `allowedUser` solo **crea** vía reglas; para que luego lea, edite o liste lo suyo desde la web, P2 debe generalizar «dueño» a `ownerId == request.auth.uid` (por MCP ya funciona, el servidor autoriza por `ownerId`).
- **UI** (`src/app/settings/`, ruta `/settings`, ítem «Ajustes» en `UserMenu`): crear token (etiqueta, valor mostrado una vez con copiar), listar y revocar; el dueño ve además «Personas permitidas» (alta por UID + correo, baja). La sección se oculta sola si `allowedUsers` no se puede listar (no eres el dueño). Casos de uso puros en `application/tokens.ts` (`generateToken`, `sha256Hex`); adaptador en `infrastructure/firebase/tokens.ts`. No se tocó `app/services.ts`: `Settings` importa el adaptador directamente (permitido: vive en `app/`).
- **Servidor** (`src/server/`): `authz.ts` (`canRead`, `canWrite`, `canCreate`, `authenticate`), `note.ts` (nota ⇄ texto; elementos `text` mínimos con índices fraccionarios; test de compatibilidad con `editors/note/codec`), `tools.ts` (una función por herramienta), `mcpServer.ts` (registro con zod), `handler.ts` (POST, un servidor + transporte por petición, 401 con `WWW-Authenticate`), `admin.ts` (cuenta de servicio o emulador).
- **Empaquetado**: `api/mcp.ts` reexporta `api/_mcp.mjs`, generado con `node scripts/bundle-mcp.mjs` (esbuild; paquetes externos). Motivo: `@vercel/node` 29 transpila cada fichero sin resolver `@/` ni imports sin extensión de `src/`. Un test falla si el fichero versionado no está al día. `tsconfig.server.json` (tipos de Node) y `eslint.config.js` (globals de Node para `src/server` y `api`) son nuevos; `tsconfig.app.json` excluye `src/server`.
- **Dependencias** (exactas, > 24 h de publicadas): `@modelcontextprotocol/sdk` 1.32.2, `firebase-admin` 14.5.0, `zod` 4.6.7 y `esbuild` 0.28.2 (dev).
- **Pruebas**: 24 de herramientas/autorización/nota contra el emulador (`tools.test.ts` incluye 401, 403, 404, 413 y dos `update_board` simultáneos) y 3 e2e (`e2e.test.ts`: el bundle en un proceso Node aparte, hablado con `Client` + `StreamableHTTPClientTransport` del SDK: 401 sin token/revocado, crear board desde Mermaid, leer, ampliar, nota, 403 en proyecto ajeno). Sin `FIRESTORE_EMULATOR_HOST` se omiten. `scripts/mcp-serve.mjs` levanta el endpoint a mano. **No probado**: el despliegue real en Vercel (`vercel dev` pide cuenta) ni la lectura de campos `members` con datos de P2 (probado con datos sembrados a mano).
- **Seguridad (revisión h8, deuda)**: el servidor usa Admin SDK, que **ignora las reglas**; aplica `canRead`/`canWrite`/`canCreate` explícitos que duplican las reglas y sus invariantes a mano. Migrar a `createCustomToken(uid)` + SDK cliente (`signInWithCustomToken`, ID token cacheado con la función caliente) para que las reglas apliquen tal cual. Detalle en `docs/mcp.md` § Seguridad. Tras la revisión: `update_board` solo amplía (sin `replace`), `lastUsedAt` como mucho una vez por hora, `mcpTokens` solo se actualiza revocando un token activo, y el endpoint no registra `Authorization`.
- **Pendientes**: auditoría del uso (solo `lastUsedAt`); el servidor no tiene límite de tasa; `read_note` ignora imágenes y embeds; `allowedUsers` pide el UID a mano (la pantalla no muestra el UID de quien va a ser añadido); un editor abierto mientras un agente escribe verá conflicto de revisión (la fase 2 lo resuelve con la fusión).
