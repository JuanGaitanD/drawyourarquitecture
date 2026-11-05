# HANDOFF · carril L2 · Presencia y colaboración (rama `debt/l2-presence`, sin push)

Cierra D5, D6 y D7 de `docs/deuda.md`. Gates: `lint`, `typecheck`, `test` (391), `build`, reglas Firestore + RTDB (69) y `test:e2e` (3) en verde.

## D5 · Presencia y cursores en Realtime Database

- **Modelo**: `presence/{ownerId}/{projectId}/{uid} = { name, color, x?, y?, at }`. El nodo existe mientras haya conexión (`onDisconnect().remove()`, reabierto en cada reconexión con `.info/connected`): sin latidos ni caducidad. El cursor se publica con `set` completo (así un nodo borrado por otra pestaña del mismo uid se recrea) y un throttle de 80 ms (`application/presence.ts`, `throttleCursor`).
- **Sala compartida**: `app/hooks/usePresence.ts` mantiene una sala por proyecto con contador de referencias; avatares y capas de cursores comparten conexión y oyente (`usePresence(projectId) → { others, move }`). Sin `VITE_FIREBASE_DATABASE_URL` (ni emuladores) `loadDatabase()` devuelve `null` y la presencia se apaga sin romper nada.
- **Cursores**: nota → `updateScene({ collaborators })` con coordenadas de escena y `onPointerUpdate` (`editors/note/presenceCursors.ts`); board → capa propia `BoardCursors` (`editors/board/presenceCursors.tsx`), coordenadas de flujo proyectadas con la transformación de React Flow, en el editor y en el visor del rol viewer. Embeds y enlaces públicos no muestran ni publican cursores.
- **Control de acceso (decisión)**: RTDB no lee Firestore. Se descartó el custom claim (exige Admin/servidor y renovar tokens) y un espejo plano `projectMembers/{pid}/{uid}` (quien llegue primero «reclama» el proyecto de otro). Se eligió un **espejo colgado del uid del dueño**: `acl/{ownerId}/{projectId}/{owner-only write}` con `members/{uid} = { role, token? }` e `invites/{token} = { role, expiresAt }`. Como la ruta lleva el uid del dueño real (`project.ownerId`), solo él puede escribir bajo su rama: no hay squatting. Firestore sigue siendo la fuente de verdad.
  - El dueño publica la invitación al crearla y la borra al revocarla; quita miembros del espejo al quitarlos o al «Revocar y quitar».
  - **Un invitado se registra a sí mismo** (`joinWithInvite`) con el token de una invitación vigente y el rol exacto de esa invitación (así entra aunque el dueño esté desconectado).
  - El dueño, al abrir el proyecto, **sincroniza `members`** con los de Firestore (cubre a quienes entraron antes de la presencia) y, al abrir «Compartir», republica las invitaciones vigentes. Todo el espejo es de mejor esfuerzo: si falla, se comparte igual y solo falta la presencia.
  - Reglas en `database.rules.json`; 9 casos en `tests/rules/database.test.ts` (miembros leen/escriben su nodo, no miembros no, nadie escribe el nodo de otro, validación de forma, invitación caducada/ajena, quitar del espejo corta la sala).
- **Firestore**: se quitó el bloque `presence` de `firestore.rules.tpl` (y `isMemberOrOwner`, sin uso); un test comprueba que ya no admite latidos.
- **Límites conocidos**: (1) una misma persona con dos pestañas comparte nodo: cerrar una lo borra hasta el siguiente movimiento de la otra. (2) Quitar a un miembro de Firestore sin pasar por «Compartir» deja su entrada en el espejo hasta que el dueño la quite. (3) En la nota, cada cursor remoto hace que Excalidraw dispare `onChange` (limitado a 150 ms por el throttle de `NoteCanvasInner`); `useAutosave` no escribe porque el contenido no cambia. (4) Excalidraw pinta el cursor remoto con su propia paleta, no con el color del avatar. (5) Con el Spark, 100 conexiones simultáneas de RTDB.

## D6 · Visor del board

`BoardViewer` ya no usa `key` por contenido: un cambio remoto actualiza los nodos sin mover la vista. Encuadra al cargar (React Flow `fitView` inicial; si el tablero estaba vacío, al llegar los primeros nodos) y a petición con el botón «Encuadrar el diagrama». «Recargar» de un embed sigue reencuadrando porque desmonta el visor. Prueba: `BoardViewer.test.tsx` (jsdom) y comprobación en navegador (zoom del lector idéntico tras dos cambios remotos).

## D7 · Revocar y quitar

`InviteRepo.memberJoins` (nombre y token de cada `joins/{uid}`; sustituye a `memberNames`) y `revokeAndRemove(projectId, token)`: un batch borra la invitación y quita de `members` a todos los que entraron con ese token. Se usa `joins.token` (ya guardado al entrar) en vez de añadir `inviteToken` al miembro: no cambia el esquema de `members` ni sus reglas. «Compartir» explica que revocar no expulsa y muestra, por enlace, cuántas personas entraron con él y el botón «Revocar y quitar…». Prueba de reglas: `compartir · revocar y quitar`.

## Para producción (lo hace Juan, con la cuenta correcta)

1. Consola de Firebase del proyecto `drawyourarchitecture` → **Realtime Database → Crear base de datos** (modo bloqueado; plan Spark). Anotar su URL: `https://drawyourarchitecture-default-rtdb.firebaseio.com` (región EE. UU.) o `https://drawyourarchitecture-default-rtdb.<región>.firebasedatabase.app`.
2. Desplegar las reglas: `firebase deploy --only database` (usa `database.rules.json`) y volver a desplegar las de Firestore (`.wigi/deploy/`, ya sin `presence`).
3. Variable `VITE_FIREBASE_DATABASE_URL` con esa URL en Vercel (Production y Preview) y redeploy. El dominio ya está autorizado en Auth.
4. Antes de cada paso, verificar la cuenta activa (`firebase login:list`, `vercel whoami`): debe ser la de Wigilabs solo si el proyecto es de Wigilabs; este es personal.

## Para T0 (anotado, no tocado)

- `package.json`: `test:rules` ahora usa `--only firestore,database`. `pnpm emulators` levanta también `database` (9000) por `firebase.json`.
- `AGENTS.md` (tabla de comandos y emuladores) y `docs/architecture.md` deberían mencionar RTDB, `database.rules.json` y `VITE_FIREBASE_DATABASE_URL`; `HANDOFF.md` §P2 punto 7 («Presencia») queda superado por este documento.
- Tocados fuera de mi propiedad, mínimos: `application/ports.ts` (contratos de presencia y `MemberJoin`), `infrastructure/firebase/firebase.ts` (+`databaseURL`, `HAS_DATABASE`, puerto 9000), `vite-env.d.ts`, `.env.example`, `app/services.ts` (+`presenceAcl`), `editors/note/NoteCanvasInner.tsx` (3 líneas: hook y `onPointerUpdate`) y `editors/board/BoardEditor.tsx` (la capa de cursores y `projectId` en el visor).
- `ReadOnly` del board (rol viewer) usa `BoardViewer` con `projectId`; si L4 lo mueve, conservar esa prop.
- Pruebas con RTDB: `FIREBASE_DATABASE_EMULATOR_HOST` (por defecto `127.0.0.1:9000`) debe apuntar a un emulador `database`; con `pnpm test:rules` lo arranca `emulators:exec`.
