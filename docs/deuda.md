# Deuda técnica — drawyourarquitecture

Fuente: `HANDOFF.md`, comentarios `ponytail:` del código y revisiones (`.wigi/review/`). Rama de trabajo: `chore/deuda-tecnica` (apilada sobre `feat/base`, PR #1). Cada ítem se cierra con código, test y la línea `Estado` actualizada.

| ID | Carril | Deuda | Cierre esperado | Estado |
|---|---|---|---|---|
| D1 | L1 | Servidor MCP usa Admin SDK (ignora reglas) y duplica la autorización a mano | Admin solo emite `createCustomToken(uid)`; el servidor opera con el SDK cliente autenticado (`signInWithCustomToken`, token cacheado por uid con la función caliente) y las reglas aplican tal cual; se borran `canRead/canWrite/canCreate` duplicados | cerrado (commit 696993a) |
| D2 | L1 | MCP sin límite de tasa ni auditoría | Límite por token (ventana fija en Firestore, p. ej. 60 llamadas/min, 429) y registro `mcpAudit/{id}` = `{uid, tokenHash, tool, projectId, ok, at}` con TTL; reglas: solo el propio uid lee lo suyo | cerrado (commit 6674453) |
| D3 | L1 | `read_note` ignora imágenes y embeds | Devuelve también la lista de imágenes (`fileId`, `mimeType`) y de diagramas incrustados (`boardId`, con su Mermaid si se puede leer) | cerrado (commit e29d2d7) |
| D4 | L1 | `allowedUsers` exige el UID a mano | Lista de permitidos por **correo verificado** (`allowedEmails/{email}`; regla con `request.auth.token.email` y `email_verified`); UI por correo; migrar `allowedUsers` y quitarlo | cerrado (commit 7c5a0c8) |
| D5 | L2 | Sin cursores en vivo; presencia en Firestore (escrituras de cuota) | Presencia y cursores en **Realtime Database** (`onDisconnect`, throttle 50–100 ms, solo miembros por reglas RTDB); Firestore deja de recibir latidos | cerrado (commits e4eab72, 6f66f30, b8b17d0, 6446d5c, 65411f7) |
| D6 | L2 | El visor del board se reencuadra con cada cambio remoto | Encuadre solo en la primera carga o a petición | cerrado (commits 0998dfd, 2db9a3e) |
| D7 | L2 | Revocar una invitación ya aceptada no expulsa | La UI lo explica en la lista de enlaces y ofrece «Revocar y quitar a quienes entraron con él» (guardar `inviteToken` en el miembro) | cerrado (commits d04e7d1, 505b0bb) |
| D8 | L3 | Imagen remota rota si la subida tarda > 7 s; binario agotado solo en memoria | La referencia (`content.files`/nodo imagen) se publica cuando la subida confirma; mientras, se guarda en IndexedDB (`dya-pending-files`) y se reintenta al volver | cerrado en la nota (commits 0aa18e4, a489136, 738b80c). El board ya solo inserta el nodo tras confirmar la subida; su binario agotado sigue solo en memoria (ver `HANDOFF.md`, «Nota») |
| D9 | L3 | Botones «Abrir/Recargar» del embed solo reciben el ratón tras activar el embed | Accesibles con un clic y con teclado | cerrado (commit b9ea29e) |
| D10 | L4 | Conector por clic origen → destino no existe | Herramienta conector: clic en nodo origen y clic en destino crea la arista (Esc cancela) | cerrado (commit fccb162, afefbac) |
| D11 | L4 | Pan y zoom solos no guardan el viewport | El viewport se guarda (debounce) aunque no cambie el contenido, sin entrar al historial | cerrado (commit 3fac5f0) |
| D12 | L4 | Crear una forma son dos pasos de historial (crear + etiqueta) | Un paso | cerrado (commit e1f9b86) |
| D13 | L4 | Historial y fusión comparan por JSON / recorren todo (O(n)) | Comparación por referencia y fusión diferencial por id; medido con un board de 2 000 nodos | cerrado (commit 7c50ea1) |
| D14 | L4 | Exportar JSON no incluye imágenes | Exportar/importar un `.dya.json` con los binarios (base64) que se suben al importar | cerrado (commit 7d1137f) |
| D15 | L4 | Copiar/pegar no usa el portapapeles del sistema | Copiar escribe `application/x-dya+json` y texto Mermaid; pegar entre pestañas funciona | cerrado (commit 531f0dc) |
| D16 | L4 | Título de la plantilla «Web de 3 capas» se parte | Ancho correcto | cerrado (commit efeb25d) |
| D17 | L5 | Contenido > 900 KB da error | Contenido troceado como los archivos (`content/main` + `content/chunks/{i}`), transacción con revisión intacta; límite práctico 8 MiB | cerrado (commit d61436f, bdaa4be) |
| D18 | L3 | Borrado de nota puede resucitar tras > 1 h desconectado | Tombstones con `revision` del servidor en vez de tiempo; purgar solo lo confirmado por todos o > 30 días | cerrado (commit fae51a9): no es demostrable la base de todos los clientes, se conservan 30 días |
| D19 | L5 | `pnpm test:rules` falla si los emuladores ya corren | El script detecta emuladores vivos (puerto 8080) y reutiliza; si no, `emulators:exec` | cerrado (commit 73815c0) |
| D20 | L5 | Sin `og:image` | Imagen de marca PNG 1200×630 en `public/` y meta `og:image`/`twitter:card` | cerrado (commit 6c47104) |
| D21 | L5 | Fuentes CJK (Xiaolai) excluidas de Excalidraw | Copiadas a `public/excalidraw-assets` (se descargan solo si se usan) | cerrado (commit b57db37) |
| D22 | M3 | Sin pruebas de componentes ni e2e de colaboración | e2e versionado de dos contextos (edición simultánea, viewer, invitación) y de las correcciones 4–6 de la revisión 2 | abierto |
| D23 | M1 | Board: binario de una imagen cuya subida agotó los reintentos queda solo en memoria | Usa `indexedDbPendingStore()` como la nota: se repone y sube al montar `BoardEditor` o al recuperar conexión | abierto |
| D24 | M2 | Nota: imagen borrada antes de confirmar su subida reaparece al reabrir | Borrar el pendiente de IndexedDB cuando el elemento se borra antes de confirmar | abierto |
| D25 | M2 | Dos pestañas del mismo usuario comparten nodo de presencia | Nodo por sesión (`presence/{pid}/{uid}/{sessionId}`), avatar único por uid | abierto |
| D26 | M2 | Excalidraw pinta los cursores con su paleta, no con el color del avatar | `collaborators` con `color: { background, stroke }` del avatar | abierto |
| D27 | M1 | Importar `.dya.json` que falla a medias deja imágenes huérfanas | Borra lo subido si la importación no se completa | abierto |
| D28 | M1 | Pegar entre proyectos pierde las imágenes | El portapapeles lleva `projectId` origen; al pegar en otro proyecto se copian los binarios (`load` + `upload`) antes de insertar | abierto |
| D29 | M3 | e2e falla de forma intermitente tras `test:rules` | Causa identificada y corregida (aislar reglas/datos del e2e); 5 corridas seguidas tras `test:rules` en verde | abierto |
| D30 | orquestador | Sin verificar en Firebase real: `email`/`email_verified` en el token de `signInWithCustomToken`, troceado y MCP en Vercel | Verificado tras el despliegue (o claims añadidos en `createCustomToken`) | abierto |
| D31 | M3 | `merge.ts` de la nota sin test (Excalidraw no carga en Vitest `node`) | Test con entorno jsdom (`// @vitest-environment jsdom`) del cliente que vuelve tras 2 h y de la unión de archivos | abierto |
| D32 | M4 | (GPT deuda-1 #1) Una aceptación concurrente sobrevive a «Revocar y quitar» | Cerrar primero la invitación; con el cierre confirmado, consultar `joins` y quitar a quienes entraron; estado recuperable si falla; test del intercalado | abierto |
| D33 | M4 | (GPT deuda-1 #2) El espejo RTDB puede conservar o restaurar permisos revocados | Sincronización autoritativa y versionada: rechaza snapshots anteriores, elimina sobrantes, reintenta revocaciones sin silenciar errores | abierto |
| D34 | M5 | (GPT deuda-1 #3) Los trozos de contenido cambian sin avanzar la revisión | Reglas: toda mutación de `content/main/chunks/*` exige `getAfter` del padre con `revision` avanzada en el mismo commit; borrado de proyecto aparte | abierto |
| D35 | M5 | (GPT deuda-1 #6) Se exportan `.dya.json` que la app rechaza al importar | Límites de exportación e importación alineados (o lectura incremental); test de ida y vuelta por encima del tope | abierto |
| D36 | M5 | (GPT deuda-1 #7) Reducir contenido troceado durante una carga da un falso `FORMAT_ERROR` | Dentro de la transacción se vuelve a discriminar formato (`data` o `chunks`) | abierto |

Aceptado (no es deuda): `null` ante `permission-denied` (privado = inexistente), borrador local como red de seguridad al cerrar la pestaña, atribución de React Flow, avisos de chunk > 500 kB de Excalidraw.
