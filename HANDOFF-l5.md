# HANDOFF · carril L5 (contenido e infraestructura)

Rama `debt/l5-infra`, desde `chore/deuda-tecnica`. Cierra D17, D19, D20 y D21 (`docs/deuda.md`).

## Contrato del contenido troceado (D17) — para L1 (MCP) y quien lea o escriba contenido

Formato de `projects/{id}/content/main`:

| Tamaño del contenido codificado | `content/main`                                                                      | `content/main/chunks/{i}`                                     |
| ------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| ≤ 900 000 bytes UTF-8           | `{ data, schemaVersion: 1, revision, updatedAt }` (igual que siempre)               | —                                                             |
| > 900 000 y ≤ 8 MiB             | `{ schemaVersion: 1, revision, updatedAt, chunks: n }` (**sin `data`**, 2 ≤ n ≤ 12) | `{ data: string }` por trozo, ≤ 900 000 bytes, `i` de 0 a n−1 |

Reglas de uso:

- **Una sola implementación.** El servidor MCP no escribe ni lee `content/main` a mano: usa `contentRepo` (`src/infrastructure/firebase/content.ts`, `load` / `save` / `subscribe`) o, si necesita otro cliente de Firestore (p. ej. el SDK web autenticado de D1), `createContentRepo(load)` con su propio `FirestoreModule`. La parte pura (partir y recomponer en frontera UTF-8, validar `chunks`) está en `src/application/contentChunks.ts` (`splitContent`, `joinContent`, `chunkCount`).
- `save` abre una transacción, lee la meta (y los trozos solo si debe fusionar), escribe meta + trozos y borra los trozos sobrantes de un guardado anterior más largo. Si la revisión esperada no coincide: `{ conflict: true }` o fusión con `merge`.
- Mientras el servidor siga con Admin (`src/server/tools.ts`, `loadContent`, `updateBoard`, `createProject`) **no** entiende `chunks`: un contenido troceado se vería como «El proyecto no tiene contenido» (404) y `tx.update(contentRef, { data })` con más de 900 000 bytes lo rechaza Firestore. Al migrar a D1, sustituir `loadContent` y las escrituras de `content/main` por `contentRepo` (el límite lo pone `encode`, ahora 8 MiB).
- `api/_mcp.mjs` se regeneró (`node scripts/bundle-mcp.mjs`) porque `domain/codec.ts` cambió `MAX_CONTENT_BYTES` (900 000 → 8 MiB; el límite de un documento pasó a `DOC_CONTENT_BYTES`). Si hay conflicto al fusionar con `debt/l1-mcp`, se vuelve a generar, no se resuelve a mano.
- Reglas (`firestore.rules.tpl`, bloque `content`): `update` de `main` con `data` ≤ 900 000 **o** `chunks` entero 2–12 sin `data`; trozos con `get` = lectura del contenido, `create/update` de dueño y editor (`data is string`, ≤ 900 000, `i` 0–11, claves cerradas), `delete` de dueño y editor, `list` del dueño. `create` de `main` sigue exigiendo `data`.
- Borrar un proyecto (`projectRepo.remove`) lista y borra también los trozos del contenido.

Pendiente para otros carriles (no es de L5):

- Los avisos de tamaño dicen «900 KB»: `src/editors/board/BoardEditor.tsx:291`, `src/editors/note/NoteEditor.tsx:283` y el comentario de `src/editors/board/canvas/useEncodedContent.ts`. Ahora el tope es 8 MiB. Los llevan L3 (nota) y L4 (board).
- `docs/plan.md`, `docs/stack.md` y `docs/architecture.md` aún describen «un solo documento, 900 000 bytes» para el contenido: los cambia quien planifica.
- La carga de un contenido troceado usa transacción (consistencia entre trozos): necesita conexión. Sin conexión el editor cae al borrador local, como con cualquier error de carga.
- Con el contenido troceado cada guardado reescribe todos los trozos y cada cliente suscrito relee n trozos por cada cambio (cuota de lecturas). Vigilarlo si un board real llega a varios MB.

## D19 · `pnpm test:rules`

`scripts/test-rules.mjs`: renderiza las reglas del emulador; si hay algo escuchando en 127.0.0.1:8080 corre vitest contra ese emulador (`FIRESTORE_EMULATOR_HOST`), y si no, usa `firebase emulators:exec`. La vía de reutilización está verificada con los emuladores compartidos; la de `emulators:exec` no se pudo ejercitar aquí (los puertos estaban ocupados por el emulador compartido).

## D20 · `og:image`

`scripts/brand/og-image.svg` (fuente) → `pnpm og:render` (`scripts/render-og.mjs`, Chromium de Playwright, sin dependencias nuevas) → `public/og-image.png` (1200×630, 36 KB). `index.html`: `og:image` (URL absoluta de producción `https://drawyourarchitecture.vercel.app/og-image.png`), `og:image:type/width/height/alt` y `twitter:card=summary_large_image`. La fuente tipográfica del SVG es la del sistema (Segoe UI en Windows): regenerar en otra máquina puede variar el texto.

## D21 · Fuentes Xiaolai

Copiadas `node_modules/@excalidraw/excalidraw/dist/prod/fonts/Xiaolai` → `public/excalidraw-assets/fonts/Xiaolai` (209 woff2). Peso: `public/excalidraw-assets` pasó de 0,5 MB a **14 MB** (Xiaolai ≈ 13 MB); el paquete de git del repo es ≈ 13,4 MiB. Comprobado en el navegador (Playwright contra el emulador): al abrir una nota **0** peticiones a `/fonts/Xiaolai/`; tras escribir texto chino se descargaron 5 de los 209 archivos. Vercel los sirve con la caché de `/excalidraw-assets/` (`vercel.json`), no entran en el bundle.

## Cambios de configuración que arrastra D17

- `vitest.rules.config.ts`: alias `@` y `VITE_USE_EMULATORS=1` para probar el `contentRepo` real contra las reglas (`tests/rules/content-chunks.test.ts`).
- `tsconfig.node.json`: `paths` de `@/*` y tipos `vite/client`, porque `tests/` ahora importa código de `src/`.
