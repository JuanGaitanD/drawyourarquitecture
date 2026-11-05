# Servidor MCP

drawyourarquitecture expone un servidor [MCP](https://modelcontextprotocol.io) para que un agente (Claude Code, Cursor, etc.) trabaje con tus notas y diagramas: lista proyectos, lee notas y boards, crea notas y boards nuevos y amplía un board desde Mermaid.

- Endpoint: `https://drawyourarchitecture.vercel.app/api/mcp` (función de Vercel, Node).
- Transporte: Streamable HTTP **sin estado** del SDK oficial (`@modelcontextprotocol/sdk`), solo `POST` y respuestas JSON (sin sesiones ni SSE).
- Autenticación: token personal en `Authorization: Bearer dya_…`.

## 1. Crear un token

1. Entra en la app y abre el menú de tu cuenta → **Ajustes** (`/settings`).
2. Escribe una etiqueta (p. ej. «Claude Code en mi portátil») y pulsa **Crear token**.
3. Copia el valor (`dya_` + 32 bytes en base64url). **Se muestra una sola vez**: en Firestore solo queda su `sha256` (`mcpTokens/{hash}`).
4. Para dejar de usarlo, **Revocar** en la misma pantalla: desde ese momento el servidor responde 401.

El token actúa **como tú**: ve lo que tú ves y escribe donde tú escribes.

## 2. Conectarlo

Claude Code:

```
claude mcp add --transport http dya https://drawyourarchitecture.vercel.app/api/mcp --header "Authorization: Bearer <token>"
```

Otros clientes con configuración JSON:

```json
{
  "mcpServers": {
    "dya": {
      "type": "http",
      "url": "https://drawyourarchitecture.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## 3. Herramientas

| Herramienta     | Argumentos                                | Qué hace                                                                                                                                    |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_projects` | `type?` (`note` \| `board`)               | Proyectos propios y compartidos contigo (hasta 200 de cada grupo), con su rol (`owner`, `editor`, `viewer`).                                |
| `read_note`     | `id`                                      | Texto de la nota en orden de lectura (por filas, de izquierda a derecha) y un resumen de elementos.                                          |
| `read_board`    | `id`                                      | Mermaid del diagrama (`toFlowchart`) y JSON compacto de nodos y aristas. El Mermaid pierde stickies, textos, iconos y estilos.              |
| `create_note`   | `title`, `text`                           | Nota nueva. El texto se divide en bloques por línea en blanco; cada bloque es un elemento `text` de Excalidraw. `#`, `##`, `###` = títulos. |
| `create_board`  | `title`, `mermaid`                        | Diagrama nuevo desde un flowchart de Mermaid, ordenado con dagre (el mismo `parseFlowchart` + `autoLayout` de la app).                      |
| `update_board`  | `id`, `mermaid`                           | **Amplía** el board: añade lo nuevo **debajo** de lo existente y conserva lo que hay (posiciones, estilos, frames, stickies e imágenes). No hay modo de sustitución. Transacción con `revision + 1`. |

Mermaid admite `flowchart`/`graph` (LR, TD…), formas `[]` `()` `([])` `{}` `(())` `[()]` `{{}}`, aristas `-->` `---` `-.->` `==>` con etiqueta, y `subgraph` anidados (pasan a frames). Los estilos (`style`, `classDef`…) se ignoran.

Límites: título ≤ 120 caracteres; `mermaid` ≤ 100 000 caracteres; `text` ≤ 200 000 caracteres y ≤ 2000 bloques; contenido final ≤ 900 000 bytes (el tope del codec); cuerpo de la petición ≤ 1 MB.

Si el board está abierto en el editor mientras un agente lo cambia, el editor verá un conflicto de revisión al guardar (hasta que llegue la sincronización en tiempo real de la fase 2).

### Errores

| Código | Cuándo                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| 401    | Respuesta HTTP: sin `Authorization`, token con formato inválido, inexistente o revocado (`WWW-Authenticate: Bearer`). |
| 403    | Resultado de la herramienta (`isError`, texto `403: …`): el proyecto existe pero no puedes leerlo/escribirlo, o tu cuenta no puede crear proyectos. |
| 404    | El proyecto no existe. |
| 400    | Id mal formado, tipo equivocado (nota vs. board), Mermaid no válido (con la línea) o contenido que no pasa `validateBoardContent`. |
| 413    | Texto, Mermaid o contenido por encima de los límites. |
| 405    | Cualquier método distinto de `POST`. |

## 4. Seguridad

- **Firebase Admin se salta las reglas de Firestore.** Por eso la autorización está en el servidor, en `src/server/authz.ts`, y **cada herramienta la aplica antes de leer o escribir**:
  - `canRead(proyecto, uid)`: dueño (`ownerId`), `members[uid]` (editor o viewer) o `isPublic`.
  - `canWrite(proyecto, uid)`: dueño o `members[uid] == 'editor'`.
  - Crear proyectos: `OWNER_UID` o existe `allowedUsers/{uid}`; el proyecto se crea siempre con `ownerId = uid` del token.
- El token solo se guarda como `sha256`; el valor en claro no existe en ningún sitio tras mostrarse. Un token revocado se rechaza en la siguiente petición. Cada uso actualiza `lastUsedAt`.
- Las reglas de `mcpTokens` dejan a cada persona crear, listar y revocar **solo los suyos** (campos cerrados; el cliente no puede escribir `lastUsedAt` ni reactivar). `allowedUsers` solo la escribe el dueño.
- El contenido que entra (Mermaid, texto) se valida con `validateBoardContent` y el codec de nota, con límites de tamaño. Los errores inesperados devuelven un 500 genérico y no filtran detalles.
- Un id de proyecto inexistente da 404 y uno ajeno 403: los ids son aleatorios de 20 caracteres, pero esto confirma que existen.

## 5. Despliegue (Vercel)

El endpoint necesita dos variables de entorno en el proyecto de Vercel (Production y, si se usa, Preview):

| Variable                   | Valor                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT` | El JSON **completo** de una cuenta de servicio de Firebase (Configuración del proyecto → Cuentas de servicio → Generar clave nueva; necesita acceso a Firestore). Es un secreto: no se versiona. |
| `OWNER_UID`                | El mismo uid del dueño que se usa para renderizar las reglas (`.env`). Decide quién puede crear proyectos además de `allowedUsers`.   |

Después de cambiar las reglas, despliega también las nuevas (`pnpm rules:render` y `firebase deploy --only firestore:rules`): las de `mcpTokens` y `allowedUsers` son necesarias para la pantalla de Ajustes.

### Por qué `api/_mcp.mjs` está versionado

El compilador de funciones de Vercel transpila cada fichero de `api/` por separado: no resuelve el alias `@/` y, en un proyecto `"type": "module"`, tampoco los imports relativos sin extensión que usa el dominio (`./board`, `./geometry`…). Para reutilizar `parseFlowchart`, `autoLayout` y `validateBoardContent` sin tocarlos, el servidor (`src/server/`) se empaqueta con esbuild en `api/_mcp.mjs` (los paquetes de `node_modules` quedan externos) y `api/mcp.ts` solo lo reexporta.

- Regenerar tras cambiar `src/server/**` o el dominio que usa: `node scripts/bundle-mcp.mjs`.
- `pnpm test` incluye `src/server/bundle.test.ts`, que falla si el fichero versionado no coincide con lo que generaría el código actual.

## 6. Probar en local

Con los emuladores corriendo (`pnpm emulators`):

```
# Tests de herramientas, autorización y extremo a extremo (cliente MCP del SDK contra el bundle en Node)
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm test

# Servidor a mano, sin Vercel
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 OWNER_UID=owner-test node scripts/mcp-serve.mjs 3977
claude mcp add --transport http dya-local http://127.0.0.1:3977/api/mcp --header "Authorization: Bearer <token creado en /settings contra los emuladores>"
```

Sin `FIRESTORE_EMULATOR_HOST` los tests de integración se omiten.
