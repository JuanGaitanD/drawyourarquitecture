# HANDOFF — drawyourarquitecture

## Dónde estamos

**T0 · Base terminada** en la rama `feat/base` (sin push). Los gates `lint`, `typecheck`, `test`, `test:rules` y `build` están en verde y el login y la navegación funcionan contra los emuladores (comprobado en Chrome: acceso con la cuenta de prueba, las cinco rutas más 404, tema claro y oscuro, cierre de sesión, sin errores de consola).

Los carriles A, B, C1, C2 y D parten de esta rama. Todo lo que cruza carriles existe como **stub con la firma final** (lista abajo): se sustituye, no se renombra.

## Lo que hay

| Pieza | Dónde | Estado |
|---|---|---|
| Dominio | `src/domain/{project,codec}.ts` | Hecho y probado |
| Aplicación | `src/application/{ports,projects,saveQueue}.ts` | Hecho y probado (gate de hidratación, cola serial, conflicto, borrador) |
| Infraestructura | `src/infrastructure/firebase/*` | Hecho; Storage se carga con `import()` |
| Modelo del board | `src/editors/board/model/{board,geometry,validate,fixtures}.ts` | Hecho y probado |
| UI | `src/ui/*` | Tokens, tema (claro/oscuro/sistema), Dialog, DropdownMenu, Popover, Tooltip, Button, IconButton, Toast |
| App | `src/app/*` | Router (5 rutas + 404), AuthGate, login, shell, hooks, `services.ts`, páginas lazy |
| Reglas | `firestore.rules.tpl`, `storage.rules.tpl`, `scripts/render-rules.mjs` | 25 casos en `tests/rules` |
| Despliegue | `firebase.json`, `firestore.indexes.json`, `cors.json`, `vercel.json` | Escritos, sin desplegar |

### Stubs (los sustituye cada carril)

| Carril | Stub | Firma |
|---|---|---|
| A | `app/dashboard/Dashboard.tsx` · `app/viewer/Viewer.tsx` · `app/viewer/EmbedPage.tsx` | `Dashboard()` · `Viewer({type, id})` (llama a `useNoindex()`) · `EmbedPage({id})` |
| B | `editors/note/NoteCanvas.tsx` · `NoteEditor.tsx` · `BoardEmbed.tsx` | `NoteCanvas({projectId, content, readonly, onChange?})` · `NoteEditor({id})` · `BoardEmbed({boardId, depth?})` |
| C1 | `editors/board/BoardEditor.tsx` · `BoardViewer.tsx` · `store/boardStore.ts` | `BoardEditor({id})` · `BoardViewer({content})` · `createBoardStore()` lanza `not implemented`; `BoardState`, `Tool` y `BoardStore` ya tipados con el contrato |
| C2 | `editors/board/ui/{Toolbar,StylePanel,ActionBar,SearchBox}.tsx` · `useShortcuts.ts` · `model/ops.ts` | componentes sin props (leen el store con `useBoard`) · `useShortcuts(containerRef)` · `align`, `distribute`, `bringToFront`, `sendToBack`, `wrapInFrame`, `duplicate` (lanzan `not implemented`) |
| D | `editors/board/extras/BoardMenu.tsx` · `model/{mermaid,layout}.ts` | `BoardMenu({title, viewportRef})` · `parseFlowchart` / `toFlowchart` · `autoLayout(content, dir): Promise` |

`BoardStoreProvider`, `useBoard`, `useBoardStore` y `BoardReadonlyContext` ya están implementados (fontanería de contexto). Los carriles no editan `domain/`, `application/`, `infrastructure/`, `ui/`, `app/` (salvo su carpeta) ni `model/{board,geometry,validate,fixtures}.ts`: lo que falte se anota en `HANDOFF-<carril>.md`.

### Puntos de contacto que conviene conocer

- `app/services.ts` exporta `createProject`, `duplicateProject`, `deleteProject`, `saveAsCopy` (ya ligados a Firebase), y `projectRepo`, `contentRepo`, `fileStore`, `identity`. Los editores los importan de ahí (permitido por el lint; `infrastructure/` y el SDK no).
- `useAutosave(id, encoded, hydrated, revision, baseline?)`: el 5.º argumento es opcional (añadido al contrato). Sin él, la base de comparación es el primer `encoded` tras hidratar. Devuelve además de `{status, error, flush, resolveConflict}` lo que dice el plan.
- `useProject(id)` devuelve `{status: 'loading'|'ready'|'missing'|'error', project, content, error, draft, discardDraft, reload}`. `ready` es la señal de hidratación; `draft` es el borrador local más reciente que lo guardado.
- `createSaveQueue(repo, id, initialRevision | null, opts?)`: con `null` no escribe hasta `hydrate(revision, lastSaved)`. Extras sobre el contrato: `hydrate`, `hasPending`, `dispose`, `state`.
- `recoverableDraft`, `readDraft` y `clearDraft` están exportados de `application/saveQueue.ts` para «Recuperar cambios no guardados».
- Revisión inicial del contenido: **0** al crear; cada guardado sube una (las reglas lo exigen: `revision == resource.revision + 1`).
- `ProjectRepo.remove` borra `content/main` y el proyecto en un batch; los archivos los borra antes `deleteProject`.
- `window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/'` se fija en `main.tsx`. El carril B debe importar `@excalidraw/excalidraw/index.css` en `NoteCanvas`.
- Tema para los motores: `useTheme().resolved` (`'light' | 'dark'`) va a `theme` de Excalidraw y `colorMode` de React Flow.

## Cómo probar en local

```
export JAVA_HOME="C:/Program Files/Eclipse Adoptium/jre-21.0.13.9-hotspot"; export PATH="$JAVA_HOME/bin:$PATH"
pnpm emulators                        # terminal 1: auth 9099, firestore 8080, storage 9199 (proyecto demo-dya)
VITE_USE_EMULATORS=1 pnpm dev         # terminal 2; «Entrar con la cuenta de prueba» → uid owner-test
```

## Desviaciones del plan y decisiones

1. **pnpm 12.6.0** (`corepack enable` sin errores y pnpm ya disponible en la máquina: no hizo falta `npm i -g`; fijado en `packageManager`). `pnpm-workspace.yaml` solo declara `allowBuilds` (los scripts de instalación de `@firebase/util`, `protobufjs`, `esbuild` y `re2` no hacen falta) y `minimumReleaseAgeExclude` para `lucide-react@1.69.0`, que pnpm 12 añadió por ser muy reciente.
2. **TypeScript 6.0.3**, no 7.0.2: `typescript-eslint@8.72.1` declara `typescript >=4.8.4 <6.1.0`. Subir cuando typescript-eslint admita 7.
3. **Vite 8.3.6**: la comprobación de humo pasó (Excalidraw + React Flow, React 19, `pnpm build` y navegación sin errores de consola); no hizo falta bajar a Vite 7.
4. **Reglas como plantillas.** El plan dice que `render-rules.mjs` toma `OWNER_UID` de `.env`; para no versionar un `firestore.rules` con un UID de prueba, lo versionado son `firestore.rules.tpl` y `storage.rules.tpl` y los `*.rules` generados están en `.gitignore`. Antes de `firebase deploy` hay que correr `pnpm rules:render` (necesita `OWNER_UID`).
5. **`OWNER_UID` en `.env.example`** (sin prefijo `VITE_`: no llega al navegador) y **`VITE_FIREBASE_MEASUREMENT_ID`** (pedida por Juan; Analytics **no** está integrado).
6. **Fuentes de Excalidraw sin Xiaolai** (el subconjunto CJK, ≈ 13 MB): `public/excalidraw-assets/fonts` pesa 500 KB. Si hace falta CJK: `cp -r node_modules/@excalidraw/excalidraw/dist/prod/fonts/Xiaolai public/excalidraw-assets/fonts/`.
7. **`useAutosave` con 5.º parámetro opcional `baseline`** y `createSaveQueue` con `initialRevision: number | null` (superset del contrato; ver arriba).
8. **Login de prueba del emulador**: crea el usuario `owner-test` con la API de administración del emulador de Auth (`localId` fijo) y entra con correo y clave. Solo se ejecuta con `VITE_USE_EMULATORS=1`.
9. **Open Graph genérico sin imagen**: `index.html` lleva título, descripción y `og:*`, pero no `og:image` (falta el recurso de marca en PNG).
10. `vercel.json` también excluye `/excalidraw-assets/` del rewrite (los ficheros de `public/` ya se sirven antes del rewrite, pero así queda explícito) y le da caché de 7 días (los nombres no llevan hash).
11. **CORS (`cors.json`)** abre `GET`/`HEAD` a cualquier origen: la lectura sigue protegida por las reglas y el token de Auth, no por el origen.

## Riesgos y deuda

- **Bundle inicial ≈ 288 kB gzip** (app 112 + Firebase Auth/Firestore 172 + resto), por encima del objetivo de 250 kB de T5. Storage ya va aparte (11 kB). Si T5 lo exige: cargar Firestore con `import()` tras el login (`infrastructure/firebase/{projects,content}.ts`), como se hizo con Storage. Excalidraw (≈ 1,6 MB gzip) y React Flow ya van en chunks propios y solo se piden en las rutas de editor.
- **Reglas de Storage en producción**: la lectura pública consulta `firestore.get(...)`; exige el rol IAM entre productos (T8) y el CORS del bucket con `cors.json`.
- **Autosave**: `saveQueue` ignora lo que llega antes de hidratar. Un editor que no llame a `useAutosave` con `hydrated=true` jamás guardará (es lo esperado).
- `ContentRepo.load` y `ProjectRepo.get` devuelven `null` ante `permission-denied` (privado y no existente se ven igual, a propósito); los demás errores se propagan.
- Los tests de reglas escriben `firestore-debug.log` / `ui-debug.log` en la raíz (ignorados por git).

## Gates (T0)

`pnpm lint` · `pnpm typecheck` · `pnpm test` (Vitest) · `pnpm test:rules` (emuladores; exige Java 21 en el `PATH`) · `pnpm build`.

## Lo que sigue

Carriles A, B, C1, C2 y D en paralelo desde `feat/base` (worktrees); después T5 integra (orden C1 → C2 → D → A → B), mide el bundle y prueba con emuladores; T6 e2e; T7 revisión; T8 despliegue (pendiente de Juan: proyecto Firebase en Blaze, su UID y la cuenta de Vercel).
