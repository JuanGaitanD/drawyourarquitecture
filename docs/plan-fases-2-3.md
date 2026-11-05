# Plan fases 2 y 3 — drawyourarquitecture

Base: `feat/base` desplegada (fase 1). Ventana: ~1 h 50 min hasta el reinicio de cuota (2026-11-05 ~15:30). Revisión GPT-6.1-sol al final, cuando vuelva su cuota.
Decisiones por defecto (Juan puede cambiarlas): **registro cerrado por lista de permitidos** (el dueño añade usuarios); los invitados a un proyecto pueden editarlo aunque no estén en la lista.

## Modelo común (lo usan las dos fases)

- `projects/{id}` gana `members: map<uid, 'editor'|'viewer'>` (opcional; sin él = solo dueño). `ownerId` sigue siendo el dueño.
- `allowedUsers/{uid}` (`{ email, addedAt }`): quién puede **crear** proyectos además de `OWNER_UID`. Solo `OWNER_UID` escribe esta colección.
- Reglas: lectura de proyecto/contenido/archivos si dueño, miembro o `isPublic`; escritura de contenido y archivos si dueño o `members[uid] == 'editor'`; metadatos (título, `isPublic`, `members`) solo el dueño; crear proyecto si `OWNER_UID` o `allowedUsers/{uid}` existe (y `ownerId == uid`). `list` por `ownerId == uid` o `members.<uid>` existente (índice).

## Fase 2 · Colaboración en tiempo real (carril P2)

1. **Compartir con invitación**: el dueño genera un enlace `/invite/:token` (rol editor o viewer, caduca en 7 días). `invites/{token}` = `{ projectId, role, createdBy, expiresAt }`. El invitado entra con Google y se añade a `members` en una transacción que las reglas validan con `getAfter`/`get` del invite (no expirado, rol coincide). Panel: sección «Compartidos conmigo».
2. **Sincronización**: `ContentRepo.subscribe(id, cb)` (`onSnapshot`). Al llegar un remoto con `revision` mayor, se **fusiona por elemento**:
   - Nota: `reconcileElements` de Excalidraw (versión por elemento) + `updateScene` con `CaptureUpdateAction.NEVER` (no entra al historial local).
   - Board: fusión por `id` de nodos y aristas con un contador `v` por elemento (el mayor gana; los borrados son tombstones `deleted: true` que se purgan al guardar si tienen > 1 min). Función pura `mergeBoards(local, remote, base)` con tests.
   - El guardado deja de fallar por conflicto: en la transacción, si la revisión cambió, se fusiona contra el remoto y se escribe la fusión (`revision+1`). El aviso «Conflicto» queda solo para errores de validación.
3. **Presencia y cursores**: `projects/{id}/presence/{uid}` = `{ name, color, x, y, at }`, escrita con throttle de 250 ms y borrada al salir; se ignora si `at` tiene > 30 s. Nota: `updateScene({ collaborators })`. Board: capa de cursores propia. Avatares de los conectados en la barra.
4. **Biblioteca** (pedido de Juan): el botón «Biblioteca» de la nota se sustituye por uno propio en la barra superior, con el estilo de los demás (`api.toggleSidebar({ name: 'default' })`), y se oculta el disparador por defecto.

Aceptación: dos navegadores (dueño + invitado) editan la misma nota y el mismo board a la vez; los cambios aparecen en < 1 s, sin pérdidas ni avisos de conflicto; se ven los cursores; un viewer no puede editar.

## Fase 3 · Servidor MCP (carril P3)

1. **Tokens personales**: en «Ajustes» (`/settings`) el usuario crea tokens con etiqueta; el valor (`dya_` + 32 bytes aleatorios en base64url) se muestra una vez; se guarda solo `sha256` en `mcpTokens/{hash}` = `{ uid, label, createdAt, lastUsedAt?, revoked }`. Reglas: el usuario crea/lee/revoca los suyos.
2. **Endpoint** `api/mcp.ts` (función de Vercel, Node, transporte Streamable HTTP del SDK oficial `@modelcontextprotocol/sdk`, sin estado). `Authorization: Bearer <token>` → hash → `mcpTokens` → `uid`. Firebase Admin con cuenta de servicio en `FIREBASE_SERVICE_ACCOUNT` (secreto de Vercel). Admin ignora reglas: **el servidor aplica dueño/miembro en cada operación** con una función única `canRead/canWrite(project, uid)`.
3. **Herramientas**:
   - `list_projects({ type? })` → propios y compartidos.
   - `read_note({ id })` → texto de los elementos (en orden de lectura) + JSON resumido.
   - `read_board({ id })` → Mermaid (`toFlowchart`) + JSON de nodos/aristas.
   - `create_note({ title, text })` → nota con bloques de texto (`convertToExcalidrawElements` no corre en Node: se generan elementos `text` mínimos válidos con un helper propio y test).
   - `create_board({ title, mermaid })` → `parseFlowchart` + `autoLayout` (mismo dominio del front).
   - `update_board({ id, mermaid, mode: 'replace'|'append' })` con revisión (transacción).
   - Todo validado con `validateBoardContent` / codec de nota; límites de tamaño.
4. **Docs**: `docs/mcp.md` con cómo conectarlo (Claude Code: `claude mcp add --transport http dya https://drawyourarchitecture.vercel.app/api/mcp --header "Authorization: Bearer …"`).

Aceptación: con un token, Claude Code lista proyectos, lee una nota, crea un board desde Mermaid y aparece en la app; token revocado → 401; proyecto ajeno → 403.

## Propiedad de archivos (dos carriles en paralelo, worktrees desde `feat/base`)

| Carril | Escribe |
|---|---|
| P2 | `src/editors/**`, `src/app/dashboard/**`, `src/app/invite/**`, `application/{ports,saveQueue,projects}.ts` (+ nuevos de merge), `infrastructure/firebase/{content,projects,presence}.ts`, bloque `projects/**` e `invites` de `firestore.rules.tpl` |
| P3 | `api/**`, `src/app/settings/**`, `src/server/**` (si hace falta código compartido solo de servidor), `infrastructure/firebase/tokens.ts`, bloques `mcpTokens` y `allowedUsers` de `firestore.rules.tpl`, `docs/mcp.md` |

Compartido: `app/routes` (P2 añade `/invite/:token`, P3 `/settings`): cada uno añade solo su línea. Integración P2 → P3.

## Gates
`lint`, `typecheck`, `test`, reglas contra emuladores y `build`; P2 además prueba con dos navegadores; P3 prueba el endpoint con `vercel dev` o un test de integración contra el emulador (Admin SDK con `FIRESTORE_EMULATOR_HOST`).
