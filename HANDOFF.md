# HANDOFF — drawyourarquitecture

## Dónde estamos

**Desplegado en producción (2026-11-05 13:09):** https://drawyourarchitecture.vercel.app (Vercel, equipo personal `juangaitands-projects`). Firebase `drawyourarchitecture` en plan gratuito: Firestore `(default)` con reglas e índices desplegados (`OWNER_UID` del dueño), Auth Google con el dominio de Vercel autorizado, Analytics `G-TPM775TWZ2`. Las reglas de producción se generan en `.wigi/deploy/` (no versionado) para no pisar las del emulador. Pendiente: revisión GPT-6.1-sol de lo cambiado tras la revisión final (correcciones, imágenes en Firestore, despliegue) cuando haya cuota.

**T5 · Integración terminada** en la rama `feat/base` (sin push): los carriles C1, C2, D, A y B están fusionados (`chore(merge): integrar carril <X>`, sin conflictos) y los pendientes cruzados resueltos. Gates `lint`, `typecheck`, `test` (309), `test:rules` (25) y `build` en verde. Bundle inicial **152,7 kB gzip** (objetivo < 250). Probado a mano en Chrome contra los emuladores (nota con imagen y board embebido, board con plantilla, Mermaid, ordenar, PNG, JSON, atajos, bloqueo, enlace público sin sesión, despublicar, conflicto entre pestañas, claro y oscuro a 1280 y 1024 px).

**Imágenes en Firestore, sin Storage** (decisión de Juan, 2026-11-05): `FileStore` guarda cada imagen troceada en `projects/{id}/files/{fileId}` + `chunks/{i}` y toda subida (nota y board) se optimiza antes (`application/imageOptimize.ts`). Ya no hay Storage, `cors.json` ni plan Blaze en el proyecto. Detalle en «Imágenes en Firestore».

**T7 · Revisión final corregida** (6 hallazgos de `.wigi/review/final-gpt.md`, un commit por cada uno, ver «Correcciones de la revisión final»). Gates `lint`, `typecheck`, `test` y `build` en verde (`test:rules` no se tocó: no cambian las reglas).

Siguen T6 (e2e) y T8 (despliegue, pendiente de Juan).

## Carril P2 · Colaboración en tiempo real (rama `lane/p2-realtime`, sin push)

**Hecho**: Biblioteca propia en la barra de la nota; reglas de `members`, `invites`, `joins` y `presence` (50 casos de reglas); invitaciones con enlace, panel «Compartidos conmigo» y ruta `/invite/:token`; sincronización en vivo con fusión (nota y board); presencia con latido y avatares. Gates: `lint`, `typecheck`, `test` (345), `build`, reglas (50) y `test:e2e` (3) en verde.

### Decisiones (incluye las correcciones de la revisión PonyTail)

1. **Biblioteca**: `NoteCanvas.topRight` admite una función `(ui: CanvasUi) => ReactNode`; el botón propio vive en `TopBar` (`api.toggleSidebar({ name: 'default' })`, `aria-pressed` con el estado) y el disparador de Excalidraw se oculta por CSS (`.default-sidebar-trigger`). Con la barra lateral abierta la tapa a ella, igual que antes: se cierra con su «X».
2. **Reglas** (`firestore.rules.tpl`): `members: map<uid, 'editor'|'viewer'>` en el proyecto; lectura dueño/miembro/público; contenido y archivos los escriben dueño y editor; metadatos, `members` y borrados solo el dueño (el editor solo sube `updatedAt`); `canCreate()` = `isOwner()` (P3 la amplía; los bloques `mcpTokens` y `allowedUsers` no se tocaron). **Unirse con invitación**: un batch escribe `projects/{id}/joins/{uid} = { token, name }` y `members.<uid>`; la regla de `update` lee el token con `getAfter(joins/uid)`, valida con `get(invites/token)` (mismo proyecto, `expiresAt` > `request.time`), exige que el rol sea el del invite y que solo cambie `members.<uid>`. Invites: `get` sin `list` salvo los propios, los crean y borran solo el dueño, token de 32 caracteres (24 bytes), caducidad ≤ 7 días. **`list` de compartidos**: `where('members.<uid>', 'in', ['editor','viewer'])` **sin `orderBy`** (se ordena en cliente): un índice compuesto por uid es imposible, así que `firestore.indexes.json` no cambia.
3. **Revocación** en «Compartir» (solo el dueño): crear enlace (editor/solo lectura), copiar, **revocar** invitación y **quitar** miembros (los nombres salen de `joins`).
4. **Sincronización**: `ContentRepo.subscribe` (`onSnapshot`) y `save(id, data, rev, merge?)`: con `merge`, un desfase de revisión no da conflicto: la transacción fusiona contra el remoto y escribe `revision+1`. La fusión se **inyecta por editor** (`useAutosave` 7.º parámetro `{ merge, same, fastFirstMs, onSaved }`); `application/` no importa motores. **Board**: fusión **a tres bandas** contra la base (último contenido del servidor conocido): sin contador `v`, sin tombstones y sin cambios en `BoardContent`/`validate`/visor/MCP; si cambia en los dos lados gana el local; se limpian aristas colgantes y se reparentan hijos de un frame borrado (`model/merge.ts`, `sync.ts`). La fusión del guardado usa el **estado vivo del store**, no el texto encolado (que puede ser anterior a lo último recibido). **Nota**: `reconcileElements` (`merge.ts`) con `updateScene({ captureUpdate: NEVER })`; la fusión **une `content.files`** (`unionFiles`). Como la nota no tiene `base`, `buildNoteContent` ahora **conserva como tombstone los elementos `isDeleted` modificados hace menos de 1 h** (`TOMBSTONE_TTL_MS`); **P3: el servidor MCP debe ignorar `isDeleted` al leer notas**. Techo: un cliente desconectado más de 1 h puede resucitar un borrado.
5. **Anti-eco**: al aplicar un remoto se llama `acceptRemote(data)` (la cola toma ese contenido como lo último del servidor) y se ignora la instantánea con revisión ya vista (propia o antigua); `same` compara contenidos de forma semántica (board: por id sin orden ni viewport; nota: id+versión+archivos), así lo que el editor re-emite igual no se reescribe. **No se sube la revisión esperada** al aplicar un remoto (la revisión es la de la última escritura propia): un guardado pendiente anterior a la fusión pasa por la fusión de la transacción en vez de pisar lo ajeno. Test: dos colas simuladas convergen y no escriben más al asentarse (`saveQueue.test.ts`).
6. **Latencia**: `fastFirstMs: 150` (el primer cambio tras un descanso ≥ 800 ms sale a los 150 ms; una ráfaga sigue agrupándose a 800 ms) y el board codifica a los 120 ms (antes 250).
7. **Presencia**: **sin cursores** (cada escritura gasta cuota). `projects/{id}/presence/{uid} = { name, color, at }`: latido al abrir y cada 60 s, caduca a los 2 min, borrado al salir (mejor esfuerzo); lo escribe solo el propio usuario y lo leen miembros y dueño. Avatares de los conectados en la barra de la nota y la cabecera del board. Los cursores (nota con `collaborators`, capa propia en el board) **quedan fuera de v2**: harían falta Realtime Database u otro canal efímero.
8. **Viewer**: la nota abre en `viewModeEnabled` y el board en `BoardViewer` («Solo lectura», título bloqueado); ambos se actualizan en vivo. El editor y el viewer no ven «Compartir».
9. **Emulador de pruebas con dos cuentas**: con `VITE_USE_EMULATORS=1`, `localStorage['dya:testUser'] = 'guest-a'` entra como otra cuenta de prueba (el dueño sigue siendo `owner-test`).

### Coste (cuota Spark: 20 000 escrituras y 50 000 lecturas al día)

- Guardado: con `DEBOUNCE_MS = 800`, un editor escribiendo sin parar genera **≈ 4 500 escrituras/h** (el techo; en uso real mucho menos), más **una lectura por oyente y por escritura**. Si se acerca a la cuota, subir el debounce.
- Presencia: 1 escritura/min por persona conectada.

### Aceptación (Chrome, dos contextos de Playwright: `owner-test` e invitado `guest-a`; script en `.wigi/p2/accept.mjs`, no versionado)

- Board: edición simultánea de los dos → los dos ven ambos cambios en 0,5 s; cambios de etiqueta distintos a la vez y un borrado se propagan; sin avisos de conflicto. Cambio aislado: 0,4–1,0 s de un cliente al otro.
- Nota: un rectángulo y una elipse dibujados a la vez por cada uno acaban en el servidor en ≈ 1 s, sin avisos de conflicto.
- Viewer (`viewer-b`): ve «Solo lectura», sin herramientas de edición, título bloqueado, y ve en vivo los cambios del dueño. Reglas: un viewer no escribe contenido.
- Dueño: lista de miembros con nombres, quitar un miembro y revocar invitaciones funcionan; tras quitarlo, sus escrituras reciben 403.
- Avatares: cada uno ve al otro conectado.
- **Reglas en el navegador**: los tests de reglas cargan `firestore.rules` en el emulador compartido; otro carril puede sobrescribirlas, y entonces «Crear enlace» falla («No se pudo crear la invitación»). Se volvió a lanzar la suite de reglas antes de cada pasada.

### Pendiente / límites

- Cursores en tiempo real (ver 7). Viewer del board: el visor se reconstruye (reencuadra) con cada cambio remoto.
- La fusión del board recorre todo el board por cada cambio remoto (O(n)).
- Una invitación aceptada y luego revocada no expulsa: hay que quitar al miembro (se hace desde la misma ventana).
- P3: ignorar `isDeleted` en notas; el servidor MCP ya puede escribir contenido de un board sin tocar nada de sincronización (no hay campos extra).

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
