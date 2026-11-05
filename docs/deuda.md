# Deuda técnica — drawyourarquitecture

Fuente: `HANDOFF.md`, comentarios `ponytail:` del código y revisiones (`.wigi/review/`). Rama de trabajo: `chore/deuda-tecnica` (apilada sobre `feat/base`, PR #1). Cada ítem se cierra con código, test y la línea `Estado` actualizada.

| ID | Carril | Deuda | Cierre esperado | Estado |
|---|---|---|---|---|
| D1 | L1 | Servidor MCP usa Admin SDK (ignora reglas) y duplica la autorización a mano | Admin solo emite `createCustomToken(uid)`; el servidor opera con el SDK cliente autenticado (`signInWithCustomToken`, token cacheado por uid con la función caliente) y las reglas aplican tal cual; se borran `canRead/canWrite/canCreate` duplicados | abierto |
| D2 | L1 | MCP sin límite de tasa ni auditoría | Límite por token (ventana fija en Firestore, p. ej. 60 llamadas/min, 429) y registro `mcpAudit/{id}` = `{uid, tokenHash, tool, projectId, ok, at}` con TTL; reglas: solo el propio uid lee lo suyo | abierto |
| D3 | L1 | `read_note` ignora imágenes y embeds | Devuelve también la lista de imágenes (`fileId`, `mimeType`) y de diagramas incrustados (`boardId`, con su Mermaid si se puede leer) | abierto |
| D4 | L1 | `allowedUsers` exige el UID a mano | Lista de permitidos por **correo verificado** (`allowedEmails/{email}`; regla con `request.auth.token.email` y `email_verified`); UI por correo; migrar `allowedUsers` y quitarlo | abierto |
| D5 | L2 | Sin cursores en vivo; presencia en Firestore (escrituras de cuota) | Presencia y cursores en **Realtime Database** (`onDisconnect`, throttle 50–100 ms, solo miembros por reglas RTDB); Firestore deja de recibir latidos | abierto |
| D6 | L2 | El visor del board se reencuadra con cada cambio remoto | Encuadre solo en la primera carga o a petición | abierto |
| D7 | L2 | Revocar una invitación ya aceptada no expulsa | La UI lo explica en la lista de enlaces y ofrece «Revocar y quitar a quienes entraron con él» (guardar `inviteToken` en el miembro) | abierto |
| D8 | L3 | Imagen remota rota si la subida tarda > 7 s; binario agotado solo en memoria | La referencia (`content.files`/nodo imagen) se publica cuando la subida confirma; mientras, se guarda en IndexedDB (`dya-pending-files`) y se reintenta al volver | abierto |
| D9 | L3 | Botones «Abrir/Recargar» del embed solo reciben el ratón tras activar el embed | Accesibles con un clic y con teclado | abierto |
| D10 | L4 | Conector por clic origen → destino no existe | Herramienta conector: clic en nodo origen y clic en destino crea la arista (Esc cancela) | cerrado (commit fccb162, afefbac) |
| D11 | L4 | Pan y zoom solos no guardan el viewport | El viewport se guarda (debounce) aunque no cambie el contenido, sin entrar al historial | cerrado (commit 3fac5f0) |
| D12 | L4 | Crear una forma son dos pasos de historial (crear + etiqueta) | Un paso | cerrado (commit e1f9b86) |
| D13 | L4 | Historial y fusión comparan por JSON / recorren todo (O(n)) | Comparación por referencia y fusión diferencial por id; medido con un board de 2 000 nodos | cerrado (commit 7c50ea1) |
| D14 | L4 | Exportar JSON no incluye imágenes | Exportar/importar un `.dya.json` con los binarios (base64) que se suben al importar | cerrado (commit 7d1137f) |
| D15 | L4 | Copiar/pegar no usa el portapapeles del sistema | Copiar escribe `application/x-dya+json` y texto Mermaid; pegar entre pestañas funciona | cerrado (commit 531f0dc) |
| D16 | L4 | Título de la plantilla «Web de 3 capas» se parte | Ancho correcto | cerrado (commit efeb25d) |
| D17 | L5 | Contenido > 900 KB da error | Contenido troceado como los archivos (`content/main` + `content/chunks/{i}`), transacción con revisión intacta; límite práctico 8 MiB | abierto |
| D18 | L3 | Borrado de nota puede resucitar tras > 1 h desconectado | Tombstones con `revision` del servidor en vez de tiempo; purgar solo lo confirmado por todos o > 30 días | abierto |
| D19 | L5 | `pnpm test:rules` falla si los emuladores ya corren | El script detecta emuladores vivos (puerto 8080) y reutiliza; si no, `emulators:exec` | abierto |
| D20 | L5 | Sin `og:image` | Imagen de marca PNG 1200×630 en `public/` y meta `og:image`/`twitter:card` | abierto |
| D21 | L5 | Fuentes CJK (Xiaolai) excluidas de Excalidraw | Copiadas a `public/excalidraw-assets` (se descargan solo si se usan) | abierto |
| D22 | L6 (tras integrar) | Sin pruebas de componentes ni e2e de colaboración | e2e versionado de dos contextos (edición simultánea, viewer, invitación) y de las correcciones 4–6 de la revisión 2 | abierto |

Aceptado (no es deuda): `null` ante `permission-denied` (privado = inexistente), borrador local como red de seguridad al cerrar la pestaña, atribución de React Flow, avisos de chunk > 500 kB de Excalidraw.
