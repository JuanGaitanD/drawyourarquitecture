# HANDOFF-l1 — carril L1 · Servidor MCP (rama `debt/l1-mcp`)

Cierra D1–D4 de `docs/deuda.md` sobre `chore/deuda-tecnica`. Sin push ni despliegue.

## Lo que se hizo

- **D1** (`696993a`): Admin solo hace de identidad (`src/server/admin.ts`: token → uid, `lastUsedAt`, `createCustomToken`); los datos van por el SDK web autenticado, una app por uid (`src/server/userDb.ts`). Se borran `canRead/canWrite/canCreate`; `permission-denied` → 403.
- **D4** (`7c5a0c8`): `allowedEmails/{correo en minúsculas}`; `canCreate()` = dueño o `email_verified` + entrada en la lista. Ajustes pide solo el correo. `allowedUsers` eliminado (nunca se desplegó: sin migración de datos).
- **D2** (`6674453`): `rateLimits/{hash}` (60/min, 429 + `Retry-After`) y `mcpAudit/{id}` con `expireAt` (Timestamp), escritos por el usuario bajo reglas (`src/server/limits.ts`).
- **D3** (`e29d2d7`): `read_note` devuelve `images` y `embeds` (con Mermaid si se pueden leer).

## Lo que necesita T0 (fuera de mi propiedad o a tener en cuenta)

1. **Tocado fuera de mi propiedad, mínimo**: `src/application/tokens.ts` y su test (`AllowedUser` → `AllowedEmail` + `normalizeEmail`, misma regex que las reglas) porque `Settings` importa el tipo de ahí; comentario de `scripts/mcp-serve.mjs`.
2. **`HANDOFF.md` § Carril P3** quedó desfasado: habla de `allowedUsers`, de `OWNER_UID` en Vercel, de «Admin ignora las reglas / migrar a createCustomToken» y de los pendientes (límite de tasa, auditoría, `read_note`, UID a mano). Reescribirlo con lo de arriba. `docs/plan-fases-2-3.md` también menciona `allowedUsers`.
3. **Antes de desplegar**: reglas nuevas (`mcpTokens`, `allowedEmails`, `rateLimits`, `mcpAudit`, `canCreate()`); activar la **política TTL** de `mcpAudit.expireAt`; variables `VITE_FIREBASE_API_KEY`/`VITE_FIREBASE_PROJECT_ID` (y las demás `VITE_FIREBASE_*`) visibles para la función, del mismo proyecto que `FIREBASE_SERVICE_ACCOUNT`. `OWNER_UID` ya no se lee en el servidor.
4. **No verificado contra Firebase real**: que el ID token de `signInWithCustomToken` incluya `email`/`email_verified` del registro del usuario (el emulador sí). Si no los trajera, solo el dueño crearía proyectos por MCP; el arreglo sería pasar esos claims en `createCustomToken(uid, claims)`. Tampoco se probó el despliegue en Vercel ni el comportamiento de la caché de sesiones con la función congelada.
5. **Cambios de comportamiento**: un id de proyecto inexistente ahora da 403 (las reglas no lo distinguen de uno ajeno); 404 solo para «sin contenido». Si P2 cambia `projects/**` en las reglas, el servidor lo hereda sin tocar código.
6. **Emulador compartido**: los tests de `src/server` cargan las reglas de este repo en el emulador (`loadRules()` en `testkit.ts`); si otro carril carga las suyas entre medias, repetir la prueba. Necesitan Auth (9099) además de Firestore (8080).
