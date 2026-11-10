# Plan — carpetas en el servidor MCP

Objetivo: que un agente organice notas y diagramas en carpetas por MCP (`api/mcp.ts`), con el mismo modelo y las
mismas reglas que el panel. Rama `feat/mcp-carpetas`, sobre `feat/mcp-update-note` (lo que corre en producción).

## Modelo que se respeta (no cambia)

- `folders/{id} = { ownerId, name, parentId: string | null, createdAt, updatedAt }`; nombre recortado de 1 a 40
  (`MAX_FOLDER_NAME_LENGTH`, regla `validFolderName`).
- `projects/{id}.folderId?: string | null` (ausente o `null` = Inicio); solo el dueño lo cambia (reglas).
- Las reglas dan cada carpeta solo a su `ownerId`; **no** comprueban que `folderId`/`parentId` apunten a una carpeta
  existente y propia, ni que una carpeta esté vacía al borrarla, ni los ciclos. Eso lo hace el cliente; aquí, el
  servidor MCP, igual que el panel:
  - destino (`folderId`, `parentId`) = una carpeta propia existente o Inicio;
  - mover una carpeta con `canMove` de `domain/folder.ts` (ni a sí misma ni a un descendiente);
  - borrar solo si no tiene proyectos propios (`ownerId == uid && folderId == id`) ni subcarpetas.
- Las carpetas no se comparten: un proyecto compartido conmigo no se puede mover (las reglas dan 403 al no dueño).

**Las reglas de Firestore no cambian** y no hay que desplegarlas.

## Herramientas

| Herramienta | Argumentos | Qué hace |
|---|---|---|
| `list_projects` (cambia) | `type?` | Añade `folderId` a cada proyecto propio y, en `data.folders`, las carpetas propias en orden de árbol (`flatTree`) con `id`, `name` y `depth`. En el texto, cada proyecto lleva su ruta tras el título («WigiLabs / Aplicativo PMO») y las carpetas van al final sangradas por profundidad. Una lectura más (`folders where ownerId == uid`). |
| `create_folder` (nueva) | `name`, `parentId?` | Crea la carpeta; sin `parentId`, en Inicio. |
| `update_folder` (nueva) | `id`, `name?`, `parentId?` (`null` = Inicio) | Renombra y/o mueve una carpeta (al menos uno). Mover sin ciclos (`canMove`). |
| `delete_folder` (nueva) | `id` | Borra la carpeta si está vacía (sin subcarpetas en la lista cargada y `projects where ownerId == uid && folderId == id limit 1` vacío; igualdades, sin índice compuesto); si no, 409 «La carpeta no está vacía». |
| `move_project` (nueva) | `id`, `folderId` (`null` = Inicio) | Mueve un proyecto propio a una carpeta propia o a Inicio. |
| `create_note` / `create_board` (cambian) | `folderId?` | El proyecto nace en esa carpeta (en el mismo batch de creación; la regla ya admite `folderId`). |

Se descarta una herramienta `list_folders` aparte: `list_projects` ya devuelve el árbol (una llamada en vez de dos).

### Validación y errores

- Ids de carpeta: sin regex; se buscan en la lista de carpetas propias (más estricto) y Zod acota la longitud.
- Nombre: una sola comprobación en el código, `trim()` y de 1 a `MAX_FOLDER_NAME_LENGTH` → si no, 400 (no se
  recorta en silencio como en el panel: el agente debe saber que el nombre no cabe). Zod solo pone `.max`.
- Carpeta destino o carpeta a editar/borrar que no está en `folders where ownerId == uid` → 404 «La carpeta no
  existe». (Una carpeta ajena no aparece en esa consulta: mismo 404, no se distingue de inexistente.)
- `update_folder` con ciclo → 400.
- `delete_folder` con contenido → 409.
- Lo que las reglas rechacen sigue saliendo como 403 (`denied`): p. ej. mover un proyecto ajeno o compartido.
- Concurrencia: igual que el panel (límite conocido de `HANDOFF.md`): las comprobaciones de vacía y ciclo leen y
  después escriben, sin transacción. No se añade transacción: las reglas no lo cubren y el panel tampoco lo hace.

### Auditoría

Las herramientas de carpetas pasan `{}` a `run` y no devuelven `data.id` (no es un proyecto); `move_project` sí.

## Código

- `src/server/folders.ts` (nuevo): `loadFolders(ctx)`, `folderTarget(ctx, id | null)` (valida y devuelve el id o
  `null`) y las herramientas `createFolder`, `updateFolder`, `deleteFolder`, `moveProject`. Reutiliza
  `canMove`, `path`, `flatTree` y `MAX_FOLDER_NAME_LENGTH` de `domain/folder.ts` y `denied`/`ID_RE` de `tools.ts`
  (se exportan). No usa `createFolderUseCases`: recorta el nombre en silencio y lanza `Error` en vez de
  `ToolError`, y exigiría un adaptador de `FolderRepo` para el servidor (`infrastructure/firebase/folders.ts` usa
  `loadFirestore`, que lee `import.meta.env`); tres `setDoc`/`updateDoc`/`deleteDoc` cuestan menos.
- `src/server/tools.ts`: `listProjects` con carpetas; `createProject` acepta `folderId` y `createNote`/`createBoard`
  lo validan con `folderTarget`.
- `src/server/mcpServer.ts`: registrar las cuatro herramientas y `folderId` en las de creación.
- `api/_mcp.mjs`: regenerar (`node scripts/bundle-mcp.mjs`).

## Pruebas

`src/server/folders.test.ts` contra los emuladores (como `tools.test.ts`, con `seedAllowedUser` para no arrastrar los
datos de `owner-test`), una por cosa que puede romperse:

1. `create_folder` en Inicio y dentro de otra; nombre vacío/41 caracteres → 400; padre inexistente → 404.
2. `list_projects` devuelve las carpetas en árbol y la ruta del proyecto.
3. `create_note` y `create_board` con `folderId` nacen dentro; con carpeta inexistente → 404 y no crean nada.
4. `move_project` a una carpeta y a Inicio (`null`); proyecto compartido conmigo (editor) → 403.
5. `update_folder`: renombrar, mover, ciclo (a sí misma y a un descendiente) → 400; carpeta de otra persona → 404
   (cubre también la inexistente).
6. `delete_folder`: con proyecto o subcarpeta → 409; vacía → la borra.

`e2e.test.ts`: actualizar la lista exacta de herramientas (`toEqual`), obligatorio. Reglas: sin cambios,
sin pruebas nuevas de reglas.

## Documentación

`docs/mcp.md` (tabla de herramientas, errores, «qué hace»), `HANDOFF.md` (Servidor MCP y producción) y `AGENTS.md`
(Propósito: el MCP organiza carpetas; Carpetas: «Los proyectos del MCP nacen en Inicio» pasa a «en Inicio o en la
carpeta indicada»).

## Despliegue y prueba real

1. Comprobar cuentas: `vercel whoami` (debe ser `juangaitand`, ámbito `juangaitands-projects`) y `firebase login:list`
   / proyecto `drawyourarchitecture`; si no coinciden, parar y avisar. No hay reglas que desplegar.
2. Desplegar la rama a producción como la vez anterior (CLI de Vercel, sin merge a `main`).
3. Prueba con el MCP de producción: `create_folder` «WigiLabs», `create_folder` «Aplicativo PMO» con `parentId`,
   `move_project` de `I4oZ0KH9u9q0a8MYfGPn` y `vyivhmlsnxj3TPbJfevp`, y `list_projects` para comprobar las rutas.
