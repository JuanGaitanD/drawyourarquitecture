# AGENTS.md — drawyourarquitecture

## Propósito

App web personal y de código abierto con dos tipos de proyecto, como TinkerCAD:

- **Nota** (`note`): pizarra libre sobre Excalidraw 0.18.1; puede incrustar diagramas propios.
- **Diagrama** (`board`): lienzo estructurado tipo Miro sobre React Flow (formas, conectores, frames, stickies, iconos, autolayout).

Un solo dueño escribe (Firebase Auth con Google, restringido por `OWNER_UID` en las reglas); los enlaces públicos son de solo lectura. Pantalla objetivo: laptop (≥ 1024 px). Fuente de verdad del alcance y los contratos: `docs/plan.md`; stack: `docs/stack.md`; arquitectura: `docs/architecture.md`.

## Idioma

**Español** (`wigi.json` → `idioma: es`): textos de la interfaz, comentarios, commits y PR. Los tipos de commit y los identificadores de código, en inglés.

## Comandos

Gestor **pnpm 12** (corepack) y **Node 24.x**. Versiones exactas, sin `^`.

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Vite en desarrollo |
| `pnpm lint` | ESLint flat (incluye la regla de dependencia entre capas) |
| `pnpm typecheck` | `tsc -b --noEmit` (TypeScript strict) |
| `pnpm test` | Vitest: `domain`, `application`, `editors/**/model` y lo que cada carril añada en `src/**` |
| `pnpm test:rules` | Renderiza las reglas para el emulador y corre `tests/rules`: reutiliza el emulador vivo en 8080 y, si no hay, arranca uno con `firebase emulators:exec` (`scripts/test-rules.mjs`) |
| `pnpm build` | `tsc -b && vite build` |
| `pnpm emulators` | Auth y Firestore locales (proyecto `demo-dya`; no necesita login) |
| `pnpm rules:render` | Genera `firestore.rules` con `OWNER_UID` de `.env` (para desplegar) |

Los emuladores necesitan Java 21. En Windows:
`export JAVA_HOME="C:/Program Files/Eclipse Adoptium/jre-21.0.13.9-hotspot"; export PATH="$JAVA_HOME/bin:$PATH"`.

Para trabajar con la app contra emuladores: `pnpm emulators` en una terminal y, en otra, `VITE_USE_EMULATORS=1 pnpm dev`. El botón de acceso entra con la cuenta de prueba `owner-test` (el mismo uid que las reglas renderizadas con `--emulator`).

## Capas y regla de dependencia

```
src/
  domain/                    Project, codec. TypeScript puro.
  application/               puertos (ProjectRepo, ContentRepo, FileStore, Identity), casos de uso, saveQueue
  infrastructure/firebase/   únicos ficheros que importan el SDK
  editors/note/  editors/board/   Excalidraw y React Flow
  ui/                        tokens, tema, primitivas Radix, Button, IconButton, Toast
  app/                       rutas, AuthGate, shell, hooks, services.ts (composición)
tests/rules/  tests/e2e/
```

`domain ← application ← infrastructure`; `editors` y `app` consumen `application` y `domain`; **solo `app/` conecta `infrastructure/firebase`** (`app/services.ts`). ESLint lo impone con `no-restricted-imports`:

- `domain/` y `application/` no importan React, Firebase, zustand ni los motores.
- `editors/` no importa `infrastructure/` ni el SDK de Firebase.
- `editors/board/model/` es TypeScript puro: solo `import type` de `@xyflow/react`.
- `ui/` no conoce el dominio.

## Convenciones

- **Persistencia como string versionado** (`projects/{id}/content/main = { data, schemaVersion: 1, revision, updatedAt }`); `encode`/`decode` de `domain/codec.ts`, tope práctico de 8 MiB (`MAX_CONTENT_BYTES`). Hasta 900 000 bytes (`DOC_CONTENT_BYTES`) va en `data`; por encima la meta lleva `chunks: n` (sin `data`) y los trozos van en `content/main/chunks/{i}` (`application/contentChunks.ts`: `splitContent`/`joinContent`). Leer y escribir contenido, también desde el servidor MCP, pasa solo por `contentRepo` (`infrastructure/firebase/content.ts`): la escritura va en una transacción con la revisión esperada y la lectura de un contenido troceado también.
- **Nodos y aristas del board se crean solo con `makeNode` y `makeEdge`**; `node.type === node.data.kind` y `edge.type === 'labeled'`. Todo contenido externo pasa por `validateBoardContent`.
- **Coordenadas**: los hijos (`parentId`) guardan posición relativa al padre y van después de él en el array; las operaciones geométricas usan `toAbsolute`/`toRelative`.
- **Guardado**: solo con `useAutosave` + `saveQueue`; el editor se monta con `key={id}` y no guarda hasta hidratar. Si el editor retiene cambios en un throttle, pasa un `drain` a `useAutosave` (`drainAndFlush`): se vacía antes de guardar en `pagehide`, al ocultar y al desmontar.
- **Firestore se carga con `import()`** (`infrastructure/firebase/firestore.ts`; `files.ts` lo usa a través de `loadFirestore`) para mantener el bundle inicial por debajo de 250 kB gzip; no los importes de forma estática desde otro sitio ni añadas `manualChunks` a `vite.config.ts`.
- **Un solo camino por operación del board**: borrar = `removeSelected` (atajos), estilo = `updateNodeData(ids, { style })`, paths de formas e iconos = `editors/board/nodes`. Los nodos bloqueados son seleccionables pero no arrastrables ni borrables.
- **Archivos**: sin Storage; viven en Firestore troceados (`projects/{id}/files/{fileId}` + `chunks/{i}`, ≤ 900 000 bytes por trozo). Toda subida pasa antes por `optimizeImage` (`application/imageOptimize.ts`: ≤ 2048 px, WebP 0,82, GIF intacto). PNG, JPEG, GIF y WebP; hasta 4 MiB tras optimizar.
- **Estilos**: CSS Modules + tokens de `src/ui/tokens.css`; nada de colores literales en el chrome (los colores del dibujo persistido sí son literales y no cambian con el tema).
- **Accesibilidad**: Radix para overlays; `aria-label` y tooltip en botones de icono; `:focus-visible` visible; respetar `prefers-reduced-motion`.
- **Atajos** solo con el editor enfocado; se ignoran en inputs, contentEditable e IME.
- Commits: Conventional Commits en español, atómicos, el árbol compila en cada uno. Ámbitos: ver `wigi.json`.
- Una prueba por cosa que puede romperse; las reglas se prueban contra los emuladores, sin mocks de Firebase.
- `pnpm test:rules` no falla con emuladores ya corriendo: detecta el puerto 8080 y reutiliza ese emulador (recarga las reglas al renderizarlas).

## Qué no tocar

- `docs/plan.md`, `docs/stack.md` y `docs/architecture.md` (los cambia quien planifica).
- Cada carril escribe solo en sus rutas (tabla «Propiedad de archivos» de `docs/plan.md`); `domain/`, `application/`, `infrastructure/`, `ui/`, `app/` (salvo su carpeta) y `model/{board,geometry,validate,fixtures}.ts` los resuelve T5. Lo que haga falta se anota en `HANDOFF-<carril>.md`.
- Las firmas de los stubs de T0 no se cambian: se implementan.
- `firestore.rules` está generado (`.gitignore`): se edita la plantilla `firestore.rules.tpl`.
- `public/excalidraw-assets/` son las fuentes copiadas de `node_modules/@excalidraw/excalidraw/dist/prod/fonts`; no se editan.
- `.env*` (salvo `.env.example`) y `.wigi/` no se versionan. Nada de claves ni UID reales en el repo.
- Sin `push`, `merge` ni cuentas reales de Firebase o Vercel salvo que Juan lo pida.
