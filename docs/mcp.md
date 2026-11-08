# Servidor MCP

DYA (Draw your Architecture) expone un servidor [MCP](https://modelcontextprotocol.io) para que un agente (Claude Code, Cursor, etc.) trabaje con tus notas y diagramas: lista proyectos, lee notas y boards, crea notas y boards nuevos, edita el título y el texto de una nota y amplía un board desde Mermaid.

- Endpoint: `https://dya.juandgaitan.com/api/mcp` (función de Vercel, Node).
- Transporte: Streamable HTTP **sin estado** del SDK oficial (`@modelcontextprotocol/sdk`), solo `POST` y respuestas JSON (sin sesiones ni SSE).
- Autenticación: token personal en `Authorization: Bearer dya_…`.
- Límite: 60 peticiones por minuto y token (ventana fija); la 61 recibe `429` con `Retry-After`. Cada llamada a una herramienta queda auditada (§ 4).

## 1. Crear un token

1. Entra en la app y abre el menú de tu cuenta → **Ajustes** (`/settings`).
2. Escribe una etiqueta (p. ej. «Claude Code en mi portátil») y pulsa **Crear token**.
3. Copia el valor (`dya_` + 32 bytes en base64url). **Se muestra una sola vez**: en Firestore solo queda su `sha256` (`mcpTokens/{hash}`).
4. Para dejar de usarlo, **Revocar** en la misma pantalla: desde ese momento el servidor responde 401.

El token actúa **como tú**: ve lo que tú ves y escribe donde tú escribes.

## 2. Conectarlo

Claude Code (el token va en una variable de entorno, no escrito en el comando):

```
export DYA_TOKEN=...   # pégalo en tu perfil de la shell o léelo de un gestor de secretos
claude mcp add --transport http dya https://dya.juandgaitan.com/api/mcp --header "Authorization: Bearer $DYA_TOKEN"
```

**No pegues el token literal en la línea de comandos**: quedaría en el historial de la shell (`~/.bash_history`, PSReadLine…). Con `$DYA_TOKEN` la shell lo expande y el historial guarda solo el nombre de la variable. Ojo: Claude Code guarda la cabecera ya expandida en su propia configuración (`~/.claude.json`); trátalo como un secreto del equipo y revoca el token si lo expones.

Otros clientes con configuración JSON:

```json
{
  "mcpServers": {
    "dya": {
      "type": "http",
      "url": "https://dya.juandgaitan.com/api/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## 3. Herramientas

| Herramienta     | Argumentos                                | Qué hace                                                                                                                                    |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_projects` | `type?` (`note` \| `board`)               | Proyectos propios y compartidos contigo (hasta 200 de cada grupo), con su rol (`owner`, `editor`, `viewer`).                                |
| `read_note`     | `id`                                      | Texto de la nota en orden de lectura (por filas, de izquierda a derecha), un resumen de elementos, la lista de **imágenes** (`fileId`, `mimeType`) y de **diagramas incrustados** (`boardId`, con título y Mermaid si puedes leerlos; si no, solo el `boardId`; hasta 10). |
| `read_board`    | `id`                                      | Mermaid del diagrama (`toFlowchart`) y JSON compacto de nodos y aristas. El Mermaid pierde stickies, textos, iconos y estilos.              |
| `create_note`   | `title`, `text`                           | Nota nueva. El texto se divide en bloques por línea en blanco; cada bloque es un elemento `text` de Excalidraw. `#`, `##`, `###` = títulos. |
| `create_board`  | `title`, `mermaid`                        | Diagrama nuevo desde un flowchart de Mermaid, ordenado con dagre (el mismo `parseFlowchart` + `autoLayout` de la app).                      |
| `update_note`   | `id`, `title?`, `text?` (al menos uno) | **Edita** una nota existente. `title` la renombra (solo el dueño: las reglas no dejan al editor tocar el título). `text` reemplaza el texto (mismo formato que `create_note`) y **conserva** imágenes, diagramas incrustados, formas y la posición y el estilo de cada texto (ver «`update_note`: cómo se reemplaza el texto»). Transacción con `revision + 1`. |
| `update_board`  | `id`, `mermaid`                           | **Amplía** el board: añade lo nuevo **debajo** de lo existente y conserva lo que hay (posiciones, estilos, frames, stickies e imágenes). No hay modo de sustitución. Transacción con `revision + 1`. |

### `update_note`: cómo se reemplaza el texto

Los textos vivos de la nota, en el orden de lectura de `read_note` (filas de arriba abajo, de izquierda a derecha; también las etiquetas de las formas), se emparejan **por posición** con los bloques nuevos:

- Bloque igual → el elemento no se toca (ni versión ni posición).
- Bloque distinto → se edita **en su sitio**: mismo id, posición, color, fuente y contenedor; cambian `text`, `originalText`, el tamaño aproximado y `version`/`versionNonce`/`updated`, así el editor abierto lo fusiona por elemento. Sin «# » se conserva el tamaño de letra que tenía (un título leído con `read_note` y devuelto sin «# » sigue siendo título); con «# », «## » o «### » pasa al tamaño de ese nivel.
- Geometría al editar: un texto libre se mide de nuevo; uno de **ancho fijo** (`autoResize: false`) conserva el ancho y se ajusta en líneas a él; la **etiqueta de una forma** se ajusta al ancho del contenedor y se centra en él sin tocar el contenedor (agrandarlo dejaría mal sus flechas conectadas; si no cabe en alto, desborda hasta que se edita en la app); la de una flecha conserva su centro. El ajuste es por palabras y grafemas (no parte emojis) y respeta la sangría; la medida es aproximada (sin métricas de fuente; en elipses y rombos usa el ancho del rectángulo): Excalidraw la afina al editar el texto. Devolver el texto ya ajustado que muestra `read_note` no cambia nada.
- Bloques de más → elementos nuevos apilados **debajo de todo** lo que hay (también de imágenes y diagramas), alineados con el texto existente y con índices de orden posteriores.
- Textos que sobran → se borran como lo hace Excalidraw (`isDeleted`, tombstone de 30 días). `text: ""` borra todo el texto y deja lo demás.

Límite: el emparejamiento es por posición, no por contenido. Insertar un bloque en medio edita los siguientes un hueco hacia abajo (el último sale como bloque nuevo, debajo de todo): el orden de lectura se mantiene, pero los textos ya no ocupan el sitio en el que estaban. Para cambios puntuales (corregir un título, marcar `- [x]`), lo seguro es mandar el texto completo de `read_note` con solo esas líneas cambiadas. `title` y `text` no son atómicos entre sí: el título se escribe primero (si las reglas lo rechazan, el texto no se toca) y un 409 en el texto deja el título ya cambiado.

Mermaid admite `flowchart`/`graph` (LR, TD…), formas `[]` `()` `([])` `{}` `(())` `[()]` `{{}}`, aristas `-->` `---` `-.->` `==>` con etiqueta, y `subgraph` anidados (pasan a frames). Los estilos (`style`, `classDef`…) se ignoran.

Límites: título ≤ 120 caracteres; `mermaid` ≤ 100 000 caracteres; `text` ≤ 200 000 caracteres y ≤ 2000 bloques; contenido final ≤ 8 MiB (el tope del codec; a partir de 900 000 bytes se guarda troceado, ver § 4); cuerpo de la petición ≤ 1 MB.

Si el board o la nota están abiertos en el editor mientras un agente escribe, el editor recibe el cambio en vivo y lo fusiona por elemento (fase 2); no hay conflicto de revisión. La presencia y los cursores viven en Realtime Database y el servidor MCP no los toca: un agente no aparece como conectado.

### Errores

| Código | Cuándo                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| 401    | Respuesta HTTP: sin `Authorization`, token con formato inválido, inexistente o revocado (`WWW-Authenticate: Bearer`). |
| 403    | Resultado de la herramienta (`isError`, texto `403: …`): una regla de Firestore rechazó la operación (`permission-denied`): el proyecto no existe o no es tuyo, no puedes editarlo, o tu cuenta no puede crear proyectos. **Un proyecto inexistente y uno ajeno son indistinguibles** (las reglas no los separan). |
| 404    | El proyecto existe pero no tiene contenido. |
| 429    | Respuesta HTTP: más de 60 peticiones en el minuto para ese token (`Retry-After`, en segundos, hasta la siguiente ventana). |
| 400    | Id mal formado, tipo equivocado (nota vs. board), Mermaid no válido (con la línea) o contenido que no pasa `validateBoardContent`. |
| 409    | `update_board` / `update_note`: la revisión cambió cinco veces seguidas mientras se guardaba (otra escritura en curso); reintenta. |
| 413    | Texto, Mermaid o contenido por encima de los límites (8 MiB codificado). |
| 405    | Cualquier método distinto de `POST`. |

## 4. Seguridad

- **Las reglas de Firestore aplican tal cual.** El servidor no autoriza a mano: Firebase Admin solo hace de **identidad** (busca el token en `mcpTokens`, anota `lastUsedAt` y emite `createCustomToken(uid)`); los datos se leen y escriben con el **SDK web de Firebase** (`firebase/app`, `firebase/auth`, `firebase/firestore`) tras `signInWithCustomToken`, es decir, como la propia persona. Una app por uid, cacheada en la memoria de la función caliente (50 min, máximo 20). Por eso `firestore.rules` protege este camino igual que a la web, y los invariantes de escritura (campos cerrados, `ownerId` y `type` inmutables, `revision + 1`, `data` ≤ 900 000 bytes o `chunks` de 2 a 12) no se duplican. Los 403 salen de `permission-denied`.
- **El contenido se lee y se escribe con el mismo repositorio que la app** (`createContentRepo`, `src/infrastructure/firebase/contentRepo.ts`) sobre el Firestore autenticado de la persona: no hay lectura ni escritura propias de `content/main`. Hasta 900 000 bytes es `{ data, schemaVersion, revision, updatedAt }`; por encima, `{ schemaVersion, revision, updatedAt, chunks: n }` (sin `data`, 2 ≤ n ≤ 12) y los trozos en `content/main/chunks/{i}`, en la misma transacción que la revisión (tope 8 MiB). `read_*` recompone los trozos; `update_board` guarda con `save` y la revisión leída; `create_*` con más de 900 000 bytes crean el proyecto con un contenido vacío (las reglas exigen `data` al crear `content/main`) y lo amplían a continuación con `save`. Test contra el emulador: crear, leer y ampliar un board de ≈ 1,2 MB (`tools.test.ts`, «contenido troceado»).
- **Quién puede crear proyectos** (regla `canCreate()`): el dueño (`OWNER_UID` renderizado en las reglas) o una cuenta con **correo verificado** (`email_verified`) que esté en `allowedEmails/{correo en minúsculas}`. Se gestiona en Ajustes por correo (solo el dueño). El proyecto se crea siempre con `ownerId` = uid del token.
- **Límite de tasa**: `rateLimits/{sha256 del token}` = `{uid, window, count}`; ventana fija de 1 min (`window` = minuto desde el epoch), 60 peticiones. La escribe el usuario autenticado y las reglas solo admiten empezar en 1, subir de uno en uno hasta 60 dentro de la ventana o abrir una ventana posterior (no se puede bajar ni reiniciar). Ventana fija: en el cambio de minuto cabe una ráfaga de hasta 2 × 60.
- **Auditoría**: cada llamada a una herramienta crea `mcpAudit/{id}` = `{uid, tokenHash, tool, projectId?, ok, at, expireAt}` (sin argumentos ni contenido). Solo se crea (no se edita ni se borra) y cada persona lee solo las suyas. `expireAt` es un `Timestamp` a 30 días: **hay que activar la política TTL de Firestore sobre el campo `expireAt` de la colección `mcpAudit`** (consola: Firestore → Datos → TTL, o `gcloud firestore fields ttls update expireAt --collection-group=mcpAudit --enable-ttl`). Sin esa política las entradas no caducan.
- **El endpoint nunca registra la cabecera `Authorization`** ni el token: solo `console.error` de errores inesperados (el objeto de error, sin la petición). Revisado en `api/` y `src/server/`.
- El token solo se guarda como `sha256`; el valor en claro no existe en ningún sitio tras mostrarse. Un token revocado se rechaza en la siguiente petición. `lastUsedAt` lo escribe solo el servidor (Admin) y como mucho una vez por hora, para que cada llamada no cueste una escritura.
- Las reglas de `mcpTokens` dejan a cada persona crear, listar y revocar **solo los suyos** (campos cerrados y `revoked == false` al crear; la única actualización del cliente es `revoked` de `false` a `true`: no puede escribir `lastUsedAt` ni reactivar). `allowedEmails` solo la escribe el dueño.
- El contenido que entra (Mermaid, texto) se valida con `validateBoardContent` y el codec de nota, con límites de tamaño. Los errores inesperados devuelven un 500 genérico y no filtran detalles.
- Los ids de proyecto son aleatorios de 20 caracteres y un proyecto inexistente da el mismo 403 que uno ajeno: la respuesta no confirma que existan.
- `update_board` y `update_note` leen el contenido, lo transforman y guardan con `save` (transacción) y la revisión leída. El SDK web es optimista: si otra escritura se cuela, `save` devuelve conflicto o la regla `revision == anterior + 1` rechaza el commit con `permission-denied`; el servidor relee la revisión y, si cambió, vuelve a leer y reintenta (hasta 5 veces, después 409) en vez de dar un 403 falso.

## 5. Despliegue (Vercel)

El endpoint necesita estas variables de entorno en el proyecto de Vercel (Production y, si se usa, Preview):

| Variable                   | Valor                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT` | El JSON **completo** de una cuenta de servicio de Firebase (Configuración del proyecto → Cuentas de servicio → Generar clave nueva). Solo identidad: buscar el token en `mcpTokens`, `lastUsedAt` y `createCustomToken`. Es un secreto: no se versiona. |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID` (y `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`) | Las mismas que ya usa la app web: la configuración del SDK web con la que el servidor entra como la persona. Deben ser del **mismo proyecto** que la cuenta de servicio. |

`OWNER_UID` **ya no hace falta en el servidor**: quién crea proyectos lo deciden las reglas (que se renderizan con `OWNER_UID` al desplegarlas).

Antes de usarlo en producción:

1. Despliega las reglas nuevas (`pnpm rules:render` y `firebase deploy --only firestore:rules`): `mcpTokens`, `allowedEmails`, `rateLimits`, `mcpAudit` y `canCreate()`. `allowedUsers` desaparece (nunca se desplegó, no hay nada que migrar).
2. Activa la política TTL de `mcpAudit.expireAt` (§ 4).
3. Comprueba una vez que el ID token de `signInWithCustomToken` lleva `email` y `email_verified` de la cuenta (lo hace el emulador y Firebase los toma del registro del usuario): sin ellos solo el dueño podría crear proyectos por MCP.

### Por qué `api/_mcp.mjs` está versionado

El compilador de funciones de Vercel transpila cada fichero de `api/` por separado: no resuelve el alias `@/` y, en un proyecto `"type": "module"`, tampoco los imports relativos sin extensión que usa el dominio (`./board`, `./geometry`…). Para reutilizar `parseFlowchart`, `autoLayout` y `validateBoardContent` sin tocarlos, el servidor (`src/server/`) se empaqueta con esbuild en `api/_mcp.mjs` (los paquetes de `node_modules` quedan externos) y `api/mcp.ts` solo lo reexporta.

- Regenerar tras cambiar `src/server/**` o el dominio que usa: `node scripts/bundle-mcp.mjs`.
- `pnpm test` incluye `src/server/bundle.test.ts`, que falla si el fichero versionado no coincide con lo que generaría el código actual.

## 6. Probar en local

Con los emuladores corriendo (`pnpm emulators`):

```
# Tests de herramientas, límite, auditoría, contenido troceado y extremo a extremo (cliente MCP del SDK contra el bundle en Node).
# Cargan las reglas de este repo en el emulador compartido y necesitan también Auth (9099).
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm test

# Servidor a mano, sin Vercel
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/mcp-serve.mjs 3977
claude mcp add --transport http dya-local http://127.0.0.1:3977/api/mcp --header "Authorization: Bearer $DYA_TOKEN"   # token creado en /settings contra los emuladores
```

Sin `FIRESTORE_EMULATOR_HOST` los tests de integración se omiten.
