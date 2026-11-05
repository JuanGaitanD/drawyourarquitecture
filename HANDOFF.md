# HANDOFF — drawyourarquitecture

## Dónde estamos

**Rama `chore/deuda-tecnica` (sin push, sin desplegar):** integra los cinco carriles de deuda técnica (`docs/deuda.md`: D1–D21 cerradas; **D22** —e2e de colaboración y pruebas de componentes— sigue abierta). Orden de integración: L5 → L1 → L2 → L3 → L4 (`chore(merge): integrar deuda <Ln>`), más tres arreglos de integración: el servidor MCP usa el `contentRepo` troceado, los avisos de tamaño dicen 8 MiB y el benchmark del board mide en relación con una pasada de JSON. Gates en «Gates».

**Producción (2026-11-05 14:16):** https://drawyourarchitecture.vercel.app lleva las fases 1, 2 y 3 **tal como estaban antes de la deuda** (presencia en Firestore, MCP con Admin SDK y `allowedUsers`). Lo de esta rama exige pasos previos de Juan: ver «Para producción».

**Qué hace la app hoy:** notas (Excalidraw) y diagramas (React Flow) con autosave, imágenes en Firestore sin Storage, enlaces públicos de solo lectura, invitaciones (editor/viewer) con sincronización en vivo y fusión por elemento, **presencia y cursores en Realtime Database**, contenido de hasta **8 MiB** (troceado a partir de 900 000 bytes), lista de permitidos por **correo verificado**, y un **servidor MCP** (`/api/mcp`, `docs/mcp.md`) que opera como la propia persona bajo las reglas de Firestore.

Siguen: D22 (e2e de dos contextos y pruebas de componentes), la revisión final con GPT-6.1-sol de lo posterior a la revisión 2 (cuando haya cuota) y el despliegue (pendiente de Juan).

## Para producción (lo hace Juan, con la cuenta correcta)

Antes de cada paso, verificar la cuenta activa (`firebase login:list`, `vercel whoami`). El proyecto es personal (Firebase `drawyourarchitecture`, Vercel `juangaitands-projects`): nada de esto va con la cuenta de Wigilabs.

1. **Realtime Database**: consola de Firebase → Realtime Database → Crear base de datos (modo bloqueado, plan Spark). URL: `https://drawyourarchitecture-default-rtdb.firebaseio.com` (EE. UU.) o `https://drawyourarchitecture-default-rtdb.<región>.firebasedatabase.app`.
2. **Reglas**: `firebase deploy --only database` (usa `database.rules.json`) y volver a desplegar las de Firestore (`pnpm rules:render`, salida en `.wigi/deploy/`): traen `mcpTokens` acotado, `allowedEmails`, `rateLimits`, `mcpAudit`, `canCreate()`, el contenido troceado y ya no tienen `presence`.
3. **Política TTL** de Firestore sobre `mcpAudit.expireAt` (consola o `gcloud firestore fields ttls update expireAt --collection-group=mcpAudit --enable-ttl`). Sin ella la auditoría no caduca.
4. **Variables de Vercel** (Production y Preview): `VITE_FIREBASE_DATABASE_URL` (paso 1) y las `VITE_FIREBASE_*` visibles para la función del MCP, del **mismo proyecto** que `FIREBASE_SERVICE_ACCOUNT` (que sigue siendo un secreto y solo da identidad). `OWNER_UID` ya no se lee en el servidor (solo al renderizar las reglas). Redeploy.
5. **No verificado contra Firebase real** (sí contra emuladores): que el ID token de `signInWithCustomToken` lleve `email` y `email_verified` del registro del usuario; si no, solo el dueño crearía proyectos por MCP (arreglo: pasarlos en `createCustomToken(uid, claims)`). Tampoco se probó el despliegue en Vercel ni la caché de sesiones con la función congelada, ni el troceado de contenido contra Firestore real (sí contra el emulador).

## Colaboración en tiempo real

### Reglas y compartir

- `members: map<uid, 'editor'|'viewer'>` en el proyecto; lectura dueño/miembro/público; contenido y archivos los escriben dueño y editor; metadatos, `members` y borrados solo el dueño. `canCreate()` = dueño o correo verificado en `allowedEmails`.
- **Unirse con invitación**: un batch escribe `projects/{id}/joins/{uid} = { token, name }` y `members.<uid>`; la regla lee el token con `getAfter(joins/uid)`, valida la invitación (`expiresAt` > `request.time`, mismo proyecto, rol exacto) y exige que solo cambie `members.<uid>`. Invitaciones: token de 32 caracteres, caducidad ≤ 7 días, las crea y borra solo el dueño. **`list` de compartidos**: `where('members.<uid>', 'in', ['editor','viewer'])` sin `orderBy` (se ordena en cliente; no hay índice compuesto por uid).
- **Revocar** (solo dueño): crear enlace, copiar, revocar y quitar miembros. Una invitación ya aceptada no expulsa por sí sola: «Compartir» lo explica, muestra por enlace cuántas personas entraron con él y ofrece **«Revocar y quitar…»** (un batch borra la invitación y quita de `members` a quienes entraron con ese token, según `joins.token`; `InviteRepo.revokeAndRemove`).

### Sincronización

- `ContentRepo.subscribe` (`onSnapshot`) y `save(id, data, rev, merge?)`: con `merge`, un desfase de revisión no da conflicto; la transacción fusiona contra el remoto y escribe `revision + 1`. La fusión se **inyecta por editor** (`useAutosave`, 7.º parámetro `{ merge, same, fastFirstMs, onSaved }`); `application/` no importa motores.
- **Board**: fusión a tres bandas contra la base (último contenido del servidor conocido), sin contadores ni tombstones; si cambia en los dos lados gana el local; limpia aristas colgantes y reparenta hijos de un frame borrado (`model/merge.ts`, `sync.ts`). Rompe ciclos de `parentId` de forma determinista. El historial rebasa los cambios remotos: deshacer no borra ni resucita lo ajeno (`applyRemote`).
- **Nota**: `reconcileElements` con `updateScene({ captureUpdate: NEVER })`; une `content.files`. Los borrados son tombstones (`isDeleted`) que duran **30 días** (`TOMBSTONE_TTL_MS`, D18): un cliente desconectado más de 30 días puede resucitar un borrado (purgar por `revision` no es demostrable sin registrar la base de cada miembro). **`read_note` ignora `isDeleted`.**
- **Anti-eco**: al aplicar un remoto se llama `acceptRemote(data)` y se ignora la instantánea con revisión ya vista; `same` compara semánticamente. No se sube la revisión esperada tras una fusión (un pendiente anterior pasa por la fusión de la transacción en vez de pisar lo ajeno). `sync.onRemote` devuelve `string | null` (el contenido remoto **con el viewport propio**; `null` si no cambió ningún elemento), y `BoardEditor` solo llama a `acceptRemote` con un valor no nulo.
- **Latencia**: `fastFirstMs: 150`; el board codifica a los 120 ms.
- **Viewer**: la nota abre en `viewModeEnabled` y el board en `BoardViewer` («Solo lectura»). **El visor ya no se reencuadra con cada cambio remoto** (D6): encuadra al cargar (y al llegar los primeros nodos de un tablero vacío) y a petición con «Encuadrar el diagrama».
- **Emulador con dos cuentas**: con `VITE_USE_EMULATORS=1`, `localStorage['dya:testUser'] = 'guest-a'` entra como otra cuenta de prueba (el dueño sigue siendo `owner-test`).

### Presencia y cursores (Realtime Database, D5)

- **Modelo**: `presence/{ownerId}/{projectId}/{uid} = { name, color, x?, y?, at }`. El nodo existe mientras haya conexión (`onDisconnect().remove()` reabierto en cada reconexión con `.info/connected`): sin latidos ni caducidad. El cursor se publica con `set` completo y throttle de 80 ms (`application/presence.ts`, `throttleCursor`). **Firestore ya no recibe latidos** (se quitó el bloque `presence` de las reglas).
- **Sala compartida**: `app/hooks/usePresence.ts` mantiene una sala por proyecto con contador de referencias (`usePresence(projectId) → { others, move }`); avatares y cursores comparten conexión. Sin `VITE_FIREBASE_DATABASE_URL` (ni emuladores) `loadDatabase()` devuelve `null` y la presencia se apaga sin romper nada.
- **Cursores**: nota → `updateScene({ collaborators })` con `onPointerUpdate` (`editors/note/presenceCursors.ts`); board → capa `BoardCursors` (`editors/board/presenceCursors.tsx`) con coordenadas de flujo proyectadas con la transformación de React Flow, también en el visor del rol viewer. Embeds y enlaces públicos no publican ni muestran cursores.
- **Control de acceso**: RTDB no lee Firestore. Se descartó el custom claim (exige Admin y renovar tokens) y un espejo plano `projectMembers/{pid}/{uid}` (quien llegue primero «reclama» el proyecto de otro). Se eligió un **espejo colgado del uid del dueño**: `acl/{ownerId}/{projectId}/{owner-only write}` con `members/{uid} = { role, token? }` e `invites/{token} = { role, expiresAt }`. Solo el dueño real escribe bajo su rama; un invitado se registra a sí mismo (`joinWithInvite`) con el token de una invitación vigente y el rol exacto de esa invitación. El dueño sincroniza `members` con los de Firestore al abrir el proyecto y republica las invitaciones vigentes al abrir «Compartir». Todo el espejo es de mejor esfuerzo: si falla, se comparte igual y solo falta la presencia. Reglas en `database.rules.json`, 9 casos en `tests/rules/database.test.ts`.
- **Límites conocidos**: (1) dos pestañas de la misma persona comparten nodo: cerrar una lo borra hasta el siguiente movimiento de la otra; (2) quitar a un miembro de Firestore sin pasar por «Compartir» deja su entrada en el espejo hasta que el dueño la quite; (3) en la nota cada cursor remoto hace que Excalidraw dispare `onChange` (150 ms de throttle; `useAutosave` no escribe porque el contenido no cambia); (4) Excalidraw pinta el cursor remoto con su paleta, no con el color del avatar; (5) con el Spark, 100 conexiones simultáneas de RTDB.

### Coste (cuota Spark: 20 000 escrituras y 50 000 lecturas al día)

- Guardado: con `DEBOUNCE_MS = 800`, un editor escribiendo sin parar genera ≈ 4 500 escrituras/h (techo) y una lectura por oyente y escritura. En el board, **pan y zoom** también guardan el viewport (D11): una escritura por gesto tras 1,5 s + 0,8 s de quietud.
- Contenido troceado: cada guardado reescribe todos los trozos y cada cliente suscrito relee n trozos por cambio; vigilarlo si un board real llega a varios MB.
- Presencia: en RTDB, sin gasto de cuota de Firestore.

## Servidor MCP

Detalle de uso, herramientas, seguridad y despliegue en `docs/mcp.md`.

- **Identidad vs. datos (D1)**: Admin solo resuelve token → uid, escribe `lastUsedAt` (como mucho una vez por hora) y emite `createCustomToken(uid)` (`src/server/admin.ts`). Los datos van por el **SDK web autenticado** como la persona (`src/server/userDb.ts`: una app por uid, 50 min, máximo 20), así que las reglas de Firestore aplican tal cual; `permission-denied` → 403. Se borraron `canRead/canWrite/canCreate`. Un id de proyecto inexistente da 403 (las reglas no lo distinguen de uno ajeno); 404 solo es «sin contenido».
- **Contenido**: lee y escribe con `createContentRepo` (la misma implementación que la app, troceado incluido); `update_board` lee, amplía y guarda con `save` y la revisión leída, y reintenta ante conflicto (hasta 5, después 409). `create_*` de más de 900 000 bytes crean el proyecto vacío y lo amplían con `save` (las reglas exigen `data` al crear `content/main`). Prueba: crear, leer y ampliar un board de ≈ 1,2 MB contra el emulador (`tools.test.ts`).
- **Límite y auditoría (D2)**: `rateLimits/{hash}` (60/min, 429 + `Retry-After`) y `mcpAudit/{id}` con `expireAt` (TTL de 30 días), escritos por la propia persona bajo reglas (`src/server/limits.ts`).
- **`read_note` (D3)**: devuelve también `images` (`fileId`, `mimeType`) y `embeds` (`boardId`, con título y Mermaid si se pueden leer).
- **Lista de permitidos (D4)**: `allowedEmails/{correo en minúsculas}`; `canCreate()` = dueño o `email_verified` + entrada. Ajustes pide solo el correo. `allowedUsers` desapareció (nunca se desplegó: sin migración).
- **Empaquetado**: `api/mcp.ts` reexporta `api/_mcp.mjs`, generado con `node scripts/bundle-mcp.mjs` (esbuild, paquetes externos); un test falla si no está al día. `contentRepo.ts`, `firestoreModule.ts` y `errors.ts` están separados de `firebase.ts` (`import.meta.env`) para poder empaquetarlos en Node.
- **Dependencias** (exactas): `@modelcontextprotocol/sdk` 1.32.2, `firebase-admin` 14.5.0, `zod` 4.6.7, `esbuild` 0.28.2 (dev).
- **Pruebas**: `src/server` contra Auth 9099 + Firestore 8080 (`tools`, `limits`, `note`, `e2e` con el bundle en un proceso Node y el cliente MCP del SDK). Los tests cargan las reglas de este repo en el emulador compartido (`loadRules()`); si otro carril carga las suyas entre medias, repetir. Sin `FIRESTORE_EMULATOR_HOST` se omiten.

## Contenido troceado (D17)

Formato de `projects/{id}/content/main`:

| Contenido codificado | `content/main` | `content/main/chunks/{i}` |
| --- | --- | --- |
| ≤ 900 000 bytes UTF-8 | `{ data, schemaVersion: 1, revision, updatedAt }` | — |
| > 900 000 y ≤ 8 MiB | `{ schemaVersion: 1, revision, updatedAt, chunks: n }` (sin `data`, 2 ≤ n ≤ 12) | `{ data: string }` por trozo, ≤ 900 000 bytes, `i` de 0 a n−1 |

- `createContentRepo` (`infrastructure/firebase/contentRepo.ts`) con la parte pura en `application/contentChunks.ts` (`splitContent`, `joinContent`, `chunkCount`; parte en frontera UTF-8). `save` abre una transacción, lee la meta (y los trozos solo si debe fusionar), escribe meta + trozos y borra los sobrantes de un guardado anterior más largo. `load` de un contenido troceado también va en transacción (consistencia entre trozos): necesita conexión; sin ella el editor cae al borrador local.
- Reglas (`firestore.rules.tpl`, bloque `content`): `update` de `main` con `data` ≤ 900 000 **o** `chunks` entero 2–12 sin `data`; trozos: `get` = lectura del contenido, `create/update` de dueño y editor (`data is string`, ≤ 900 000, `i` 0–11, claves cerradas), `delete` de dueño y editor, `list` del dueño. `create` de `main` sigue exigiendo `data`. Borrar un proyecto borra también los trozos.
- `domain/codec.ts`: `DOC_CONTENT_BYTES` = 900 000, `MAX_CONTENT_BYTES` = 8 MiB, `MAX_CONTENT_LABEL` («8 MiB») para los avisos de tamaño del board y de la nota.
- `vitest.rules.config.ts` (alias `@` y `VITE_USE_EMULATORS=1`) y `tsconfig.node.json` (`paths` de `@/*` y tipos `vite/client`) cambiaron porque `tests/` ahora importa código de `src/`.

## Board (D10–D16)

Medido con un board de 2 000 nodos y 2 500 aristas (≈ 1,1 MB; ya se puede guardar gracias a D17) en `src/editors/board/perf.test.ts`:

| Operación | Antes (JSON por cambio) | Después |
| --- | --- | --- |
| Historial · mover un nodo | 6,9 ms | 0,13 ms |
| Historial · gesto de 20 movimientos | 18,2 ms | 2,0 ms |
| Fusión · `onRemote` (parse incluido) | 102 ms | 23 ms |
| Fusión · `onRemote` con 100 pasos de historial | ≈ 7 900 ms | 70 ms |
| Fusión · `mergeBoards` | 45 ms | 2,0 ms |

El benchmark mide **en relación con una pasada de `JSON.stringify` del board entero** (misma máquina, mismo momento), con el mejor de varios intentos y hasta dos reintentos del bloque: no depende de la carga de la máquina, y una regresión al recorrido con JSON sigue fallando. También comprueba que el board de 2 000 nodos se codifica con el `encode` real y se trocea y recompone igual. Los tiempos van a la salida: `pnpm exec vitest run src/editors/board/perf.test.ts --reporter=verbose`. Mide el modelo en Node, no el render de React Flow.

- **D13**: `cleanNodes`/`cleanEdges` recuerdan el resultado por objeto (`WeakMap`); la igualdad del historial compara por referencia y a fondo solo lo que difiere; el rebase del historial ante un remoto calcula el diff por id una vez; `model/merge.ts` tiene `deepEqual` y `diffById`; `onRemote` no fusiona nada si el remoto no cambió ningún elemento respecto de `base`.
- **D12**: crear una forma es un solo paso de historial (`insertNode(node, edit)` abre un gesto que cierra `setEditingId`; Esc deja la forma sin etiqueta en el mismo paso).
- **D10**: herramienta Conector (`L`): clic en el origen y clic en el destino crean la arista (un paso, con los lados que se miran, `canvas/connect.ts`); Esc cancela primero el origen y luego sale de la herramienta; los bloqueados no se conectan. No evita aristas duplicadas entre los mismos nodos (igual que arrastrar).
- **D11**: pan y zoom recodifican el contenido con 1,5 s de retraso (`useEncodedContent.touchViewport`) y se guardan sin entrar al historial; `boardSame` compara el viewport.
- **D16**: el título de «Web de 3 capas» (y los de «C4 · Contexto» y «Event-driven») ya caben; test que estima el ancho del texto de cada plantilla.
- **D15**: copiar escribe `web application/x-dya+json` y texto Mermaid en el portapapeles del sistema (sin formato propio: Firefox y Safari, solo Mermaid y copia en memoria en la misma pestaña); pegar valida con `validateBoardContent` (nunca se confía en el portapapeles), cae a la copia en memoria y por último a Mermaid. Lo copiado es autocontenido. Probado en Chrome entre dos pestañas; Chrome pide permiso de lectura la primera vez. Pegar imágenes entre **proyectos distintos** deja la imagen sin archivo.
- **D14**: `.dya.json` = `{ format: 'dya-board', version: 1, content, files: { [fileId]: { mimeType, base64 } } }`; importar valida todo (≤ 4 MiB por imagen, archivo ≤ 40 MB), sube las imágenes con reintentos (1-2-4 s) **antes** de aplicar el contenido y les da `fileId` nuevos; si una subida falla no se importa nada. El `.json` antiguo sin imágenes se sigue importando. Exportar omite (con aviso) las imágenes que no se pueden leer; una subida fallida a mitad deja archivos huérfanos en `files/`.
- Límites: leer del portapapeles pide permiso en Chrome; `onRemote` con altas o borrados en un historial profundo recorre cada paso (lineal por paso).

## Nota (D8, D9, D18)

- **D8**: cada imagen nueva se copia a IndexedDB (`dya-pending-files`, `application/pendingFiles.ts`) con sus elementos y **no se publica** (ni el elemento ni `content.files`) hasta que la subida confirma (`buildNoteContent(…, unconfirmed)`); la copia se borra cuando el guardado con la imagen se confirma (`NoteHandle.saved` → `release`), y al volver a abrir la nota o recuperar la conexión la cola repone la imagen y la sube. Si la persona borra la imagen antes de que confirme y cierra la pestaña, al reabrir puede reaparecer. En el board la referencia ya se publicaba tras confirmar (`placeImage`); su binario agotado (tras los reintentos) sigue **solo en memoria**: cerrarlo exige guardarlo en `PendingStore` con la posición del nodo y reponerlo al montar `BoardEditor` (la pieza reutilizable es `indexedDbPendingStore()`).
- **D9**: los botones del embed (`Abrir`, `Recargar`, `Reintentar`) se usan con un clic y con teclado sin activar el embed.
- **D18**: tombstones de 30 días (ver «Sincronización»).
- `merge.ts` tiene test (`merge.test.ts`, D31) con Excalidraw real en `jsdom`: Vitest transforma `@excalidraw/excalidraw` y `open-color` (`server.deps.inline` en `vite.config.ts`) y el test parchea `getContext` del lienzo antes de importarlo.
- Sin probar en navegador (solo Vitest): `remoteInbox`, `pickBackground` y `retryMissing` cubren la lógica pura, no el cableado del lienzo.

## Infraestructura (D19–D21)

- **D19**: `scripts/test-rules.mjs` renderiza las reglas del emulador y, por cada emulador (Firestore 8080, Realtime Database 9000), reutiliza el vivo o lo arranca con `firebase emulators:exec --only <los que faltan>`. `pnpm emulators` levanta los tres (auth, firestore, database) por `firebase.json`.
- **D20**: `scripts/brand/og-image.svg` → `pnpm og:render` (Chromium de Playwright) → `public/og-image.png` (1200×630, 36 KB); `index.html` lleva `og:image` (URL absoluta de producción), sus metas y `twitter:card=summary_large_image`. La fuente del SVG es la del sistema: regenerar en otra máquina puede variar el texto.
- **D21**: fuentes Xiaolai (CJK, 209 woff2) copiadas a `public/excalidraw-assets/fonts/Xiaolai`: `public/excalidraw-assets` pasó de 0,5 MB a 14 MB (el paquete de git ≈ 13,4 MiB). Se descargan solo si se usan (comprobado: 0 peticiones al abrir una nota y 5 de 209 tras escribir chino); no entran en el bundle.

## Lo que hay

| Pieza | Dónde | Estado |
| --- | --- | --- |
| Dominio | `src/domain/{project,codec}.ts` | Hecho y probado |
| Aplicación | `src/application/{ports,projects,saveQueue,contentChunks,presence,pendingFiles,tokens}.ts` | Hecho y probado |
| Infraestructura | `src/infrastructure/firebase/*` | Firestore y Realtime Database se cargan con `import()` |
| Modelo del board | `src/editors/board/model/*` | Hecho y probado |
| UI | `src/ui/*` | Tokens, tema, primitivas Radix, Button, IconButton, Toast |
| App | `src/app/*` | Router, AuthGate, shell, hooks, `services.ts`, páginas lazy, Ajustes, invitaciones |
| Servidor MCP | `src/server/*`, `api/mcp.ts`, `api/_mcp.mjs` | Hecho; sin desplegar |
| Reglas | `firestore.rules.tpl`, `database.rules.json`, `scripts/{render-rules,test-rules}.mjs` | Casos en `tests/rules` (Firestore y RTDB) |
| Despliegue | `firebase.json`, `firestore.indexes.json`, `vercel.json` | Escritos |

### Carriles de la base

| Carril | Qué trae | Dónde |
| --- | --- | --- |
| C1 · Núcleo del board | Store por instancia (zustand + zundo), 6 nodos, `LabeledEdge`, `BoardCanvas`, `BoardViewer`, `BoardEditor` | `editors/board/{store,canvas,nodes,edges}` |
| C2 · UI del board | `Toolbar`, `StylePanel`, `ActionBar`, `SearchBox`, atajos, `model/ops.ts` | `editors/board/ui`, `model/ops.ts` |
| D · Extras | `BoardMenu` (plantillas, Mermaid, ordenar, PNG, JSON), `parseFlowchart`/`toFlowchart`, `autoLayout` | `editors/board/extras`, `model/{mermaid,layout,templates}` |
| A · Panel y visor | Panel, `/view/:type/:id`, `/embed/board/:id` | `app/dashboard`, `app/viewer` |
| B · Nota | Excalidraw con autosave, imágenes, embed de board, «Insertar diagrama», biblioteca propia | `editors/note` |

### Puntos de contacto

- `app/services.ts` exporta `createProject`, `duplicateProject`, `deleteProject`, `saveAsCopy` y `projectRepo`, `contentRepo`, `fileStore`, `identity`, `presenceAcl`. Los editores los importan de ahí.
- `useAutosave(id, encoded, hydrated, revision, baseline?, drain?, { merge, same, fastFirstMs, onSaved })`; devuelve `{status, error, flush, resolveConflict, acceptRemote}`.
- `useProject(id)` devuelve `{status: 'loading'|'ready'|'missing'|'error', project, content, error, draft, discardDraft, reload}`.
- `createSaveQueue(repo, id, initialRevision | null, opts?)`: con `null` no escribe hasta `hydrate(revision, lastSaved)`.
- Revisión inicial del contenido: **0** al crear; cada guardado sube una (`revision == resource.revision + 1` en las reglas).
- `ProjectRepo.remove` borra `content/main`, sus trozos y el proyecto; los archivos los borra antes `deleteProject`.
- `window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/'` se fija en `main.tsx`. Tema para los motores: `useTheme().resolved`.

## Cómo probar en local

```
export JAVA_HOME="C:/Program Files/Eclipse Adoptium/jre-21.0.13.9-hotspot"; export PATH="$JAVA_HOME/bin:$PATH"
pnpm emulators                        # terminal 1: auth 9099, firestore 8080, database 9000 (proyecto demo-dya)
VITE_USE_EMULATORS=1 pnpm dev         # terminal 2; «Entrar con la cuenta de prueba» → uid owner-test
```

## Desviaciones del plan y decisiones

1. **pnpm 12.6.0** (corepack, fijado en `packageManager`). `pnpm-workspace.yaml` solo declara `allowBuilds` y `minimumReleaseAgeExclude` para `lucide-react@1.69.0`.
2. **TypeScript 6.0.3**, no 7: `typescript-eslint@8.72.1` declara `typescript >=4.8.4 <6.1.0`.
3. **Vite 8.3.6**: Excalidraw + React Flow, React 19, `pnpm build` y navegación sin errores de consola.
4. **Reglas como plantillas**: lo versionado es `firestore.rules.tpl`; el `firestore.rules` generado está en `.gitignore`. Antes de `firebase deploy` hay que correr `pnpm rules:render` (necesita `OWNER_UID`). `database.rules.json` se versiona tal cual.
5. **`OWNER_UID` en `.env.example`** (sin `VITE_`: no llega al navegador) y `VITE_FIREBASE_MEASUREMENT_ID` (Analytics `G-TPM775TWZ2`); `VITE_FIREBASE_DATABASE_URL` para la presencia.
6. **Login de prueba del emulador**: crea `owner-test` con la API de administración del emulador de Auth y entra con correo y clave (solo con `VITE_USE_EMULATORS=1`). El 400 de `identitytoolkit … /accounts` en consola es ese login (el usuario ya existe), no un error de la app.
7. `vercel.json` excluye `/excalidraw-assets/` del rewrite y le da caché de 7 días (los nombres no llevan hash).
8. **Un solo camino de borrado** (`removeSelected`, respeta `locked`, limpia hijos de un frame y aristas colgantes), **de estilo** (`updateNodeData(ids, { style })`) y de paths de formas e iconos (`editors/board/nodes`). Los bloqueados son seleccionables pero no arrastrables, borrables ni conectables.
9. **Herramienta imagen**: abre el selector de archivo y coloca la imagen en el centro de la vista con la subida de C1. `BoardViewer` recibe `files={{ load }}` en `Viewer`, `EmbedPage` y `BoardEmbed`.
10. **Foco**: al terminar de editar un texto con Enter o Esc el foco vuelve al nodo (`store/returnFocus.ts`); `ui/Dialog` admite `initialFocus` y exporta `useReturnFocus`.
11. **Último cambio al cerrar la pestaña**: `drainAndFlush` pasa a la cola lo que retiene el throttle del editor y `useAutosave` escucha `pagehide`; el borrador local se escribe de forma síncrona y se ofrece «Recuperar». La escritura en Firestore al `pagehide` no está garantizada.
12. **Bundle**: sin `manualChunks`; Firestore y Realtime Database se cargan con `import()`. Bundle inicial **152,7 kB gzip** al integrar la base (objetivo < 250); la medida actual está en «Gates».
13. **`/note` a 1024 px**: la barra superior oculta el texto del estado y acorta el título para que quepa «Biblioteca».
14. **Biblioteca**: `NoteCanvas.topRight` admite una función `(ui: CanvasUi) => ReactNode`; el botón propio vive en `TopBar` y el disparador de Excalidraw se oculta por CSS.
15. **Guardar como copia** (`copyProject`): crea el proyecto, copia los archivos con el mismo `fileId`, escribe el contenido al final y, si algo falla, borra la copia incompleta.
16. **Borradores por pestaña**: clave `draft:<id>:<sessionId>`; `recoverableDrafts` ofrece los de cualquier sesión cuyo contenido difiera del servidor, el más reciente primero, sin descartar por fecha, y marca `stale` si su revisión base no es la guardada.
17. **Reparentar sin ciclos** (`store/reparent.ts`) y **guardado validado** (`useEncodedContent` pasa `validateBoardContent` antes de codificar; si falla, no se guarda y el editor muestra el motivo). `validateBoardContent` valida `shape`, `icon`, `fileId` y los campos de `style`.
18. **Borrar un frame**: los descendientes bloqueados sobreviven con su subárbol y pasan al ancestro superviviente con la posición absoluta conservada.
19. **Decisiones de C2/D/A/B**: autolayout por niveles (dagre por frame, +32 px de relleno y 40 de cabecera) con `sourceHandle`/`targetHandle` según el sentido; gramática Mermaid ampliada (hexágono, paralelogramo, `-.-`, `===`, `;`, comillas), ignora `style`/`classDef`/`class`/`linkStyle`/`click`/`direction`, sin `&` ni flechas bidireccionales; `toFlowchart` pierde stickies, textos, iconos y estilos. Reemplazar (plantilla, Mermaid, JSON) pide confirmación si el lienzo no está vacío. PNG: margen 48 px, lado máximo 4096 px de CSS (escala 2), fondo blanco. El archivo de una nota se registra en `content.files` al detectarlo; SVG o > 4 MiB se retiran con un toast. En una nota pública un board incrustado solo se ve si el board también es público.

## Riesgos y deuda

- **Imágenes en Firestore**: cada lectura de un trozo de un proyecto público cuesta una lectura extra por el `get()` al proyecto en las reglas (50 000 lecturas/día); una imagen de 1 MiB son 2 trozos.
- `ContentRepo.load` y `ProjectRepo.get` devuelven `null` ante `permission-denied` (privado y no existente se ven igual, a propósito).
- Las reglas de Firestore son un recurso compartido del emulador: cada suite que las carga pisa las de otra que corra a la vez; repetir la prueba. Los tests de reglas escriben `firestore-debug.log`, `database-debug.log` y `ui-debug.log` en la raíz (ignorados por git).
- El emulador compartido acumula proyectos de `owner-test`: `list_projects` solo trae 200, así que las pruebas que listan usan una persona nueva (`seedAllowedUser`).
- D29 cerrada. Causa: `test:rules` y el e2e compartían el proyecto `demo-dya` del emulador con los demás carriles, que limpian Firestore entre pruebas, recargan reglas y cierran la base de tiempo real (`emulators:exec`). Ahora `test:rules` usa un proyecto por ejecución (`RULES_PROJECT`) y el e2e `demo-dya-e2e` con `global-setup.ts`. El emulador de Auth no separa por proyecto: las cuentas de prueba siguen en `demo-dya`.
- Los embeds muestran la atribución «React Flow» (sin plan Pro).
- **D22**: el e2e de colaboración está versionado (`tests/e2e/collab.spec.ts`). Siguen sin pruebas de componentes (Vitest corre en `node`; solo `BoardViewer.test.tsx` y `merge.test.ts` usan jsdom) ni e2e de las correcciones 4–6 de la revisión 2 (la revisión vive en `.wigi/`, no versionada).
- Un editor abierto mientras un agente escribe por MCP recibe el cambio en vivo y lo fusiona; un agente no aparece en la presencia.

## Imágenes en Firestore

- **Modelo**: `projects/{id}/files/{fileId} = { mimeType, size, chunks, createdAt }` y `…/chunks/{i} = { data: Bytes }` (≤ 900 000 bytes). Adaptador en `infrastructure/firebase/files.ts`; troceado y reparto en batch puros (`application/fileChunks.ts`). La meta se escribe la última.
- **Optimización** (`application/imageOptimize.ts`): lado mayor ≤ 2048 px, WebP 0,82 si pesa menos; GIF tal cual; tope de 4 MiB tras optimizar. La usan `NoteCanvasInner` y `BoardCanvas.placeImage`; copiar o duplicar no recodifica. Medido: un PNG de 21 MB → WebP de 138 kB (−99,3 %).
- **Retirado**: `storage.rules.tpl`, `cors.json`, el emulador de Storage, `firebase/storage` y `VITE_FIREBASE_STORAGE_BUCKET`. No hay migración (no hay datos reales).
- **Accesibilidad**: los handles de conexión de `NodeChrome` son `role="button"` con «Conectar desde el lado …».

## Gates

Sobre `chore/deuda-tecnica` tras integrar L5, L1, L2, L3 y L4 (Java: `export PATH="/c/Program Files/Eclipse Adoptium/jre-21.0.13.9-hotspot/bin:$PATH"`):

- `pnpm lint` y `pnpm typecheck`: en verde.
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm test`: **472 pruebas** en 38 ficheros (con Auth 9099 y Firestore 8080 vivos; sin la variable se omiten las de `src/server`). Repetido 4 veces seguidas sin fallos tras estabilizar el benchmark y las pruebas del MCP.
- `pnpm build`: en verde. Bundle inicial ≈ **160 kB gzip** (JS + CSS que pide `index.html`; objetivo < 250). Avisos de chunk > 500 kB de Excalidraw: aceptados.
- `pnpm test:rules`: **93 pruebas** (6 ficheros: Firestore y Realtime Database). Con Firestore vivo en 8080 y sin nada en 9000, reutilizó el primero y arrancó solo `database` con `emulators:exec` (que lo cierra al terminar).
- `pnpm test:e2e`: **3 pasan** (tres ejecuciones; una cuarta, justo después de `test:rules` en la misma tanda, falló en «diagrama: forma y conector persisten tras recargar» y no se reprodujo: ver «Riesgos y deuda»).

## Lo que sigue

D22 (e2e de colaboración de dos contextos, pruebas de componentes con jsdom, `merge.ts` de la nota) → revisión final con GPT-6.1-sol de lo posterior a la revisión 2 → despliegue (pendiente de Juan; ver «Para producción»).

## Hoja de ruta por fases (decisión de Juan, 2026-11-05)

1. **Fase 1:** notas y diagramas, enlace público de solo lectura. Hecha.
2. **Fase 2:** colaboración en tiempo real. Hecha (invitaciones, fusión, presencia y cursores en RTDB).
3. **Fase 3:** servidor MCP para que agentes de IA lean y creen las notas y diagramas de una persona autenticada. Hecha (tokens, reglas, límite, auditoría). El objetivo sigue siendo un sistema que haga diagramas y notas y que procese esas notas para arrancar o detallar un proyecto.
