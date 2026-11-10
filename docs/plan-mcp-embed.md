# Plan — incrustar un diagrama en una nota por MCP

Objetivo: que un agente incruste un diagrama existente en una nota, con el mismo modelo que la interfaz. Va en
`feat/mcp-carpetas` (PR #4) para salir en el mismo despliegue que las carpetas.

## Modelo que se reutiliza (no cambia)

- Un diagrama incrustado es un elemento `embeddable` de Excalidraw cuyo `link` es la URL absoluta
  `<origen>/embed/board/<id>` (`editors/note/embed.ts`: `newEmbeddable`, `boardEmbedLink`, `EMBED_SIZE` 640 × 400).
  `parseBoardLink` acepta el origen de la pestaña y los de producción (`SITE_ORIGINS`); `read_note` lo devuelve en
  `embeds` por `noteEmbeds` (`src/server/note.ts`).
- El servidor usa `newEmbeddable` y `boardEmbedLink` tal cual (`embed.ts` solo importa `nanoid`, que ya es
  dependencia) con el origen canónico `https://dya.juandgaitan.com` (`SITE_ORIGINS[0]`, se exporta). Así la nota abre
  igual desde cualquier origen de producción y desde el emulador.
- El contenido se guarda como `update_note`: `saveWithRetry` (leer → transformar → `save` con la revisión leída,
  reintento ante conflicto). Las reglas aplican tal cual.

## Herramienta

`embed_board` (nueva) · `{ id, boardId, after? }`

Se elige una herramienta aparte y no un parámetro de `update_note`: `update_note` reemplaza el texto completo y su
emparejamiento por posición no tiene dónde decir «aquí va un diagrama»; mezclar las dos cosas complica las dos.

- `id`: nota. `loadProject(ctx, id, 'note')`; escribir el contenido exige dueño o editor (las reglas rechazan al
  viewer en el commit → 403, como en `update_note`).
- `boardId`: diagrama. `loadProject(ctx, boardId, 'board')` como la persona: si no puede leerlo, las reglas lo
  rechazan → 403; si es una nota → 400. No se incrusta lo que la persona no puede leer.
- `after` (opcional): inicio del texto de un bloque, tal como lo muestra `read_note` (`text`, que no lleva «# »;
  se recortan los espacios de los extremos). Se busca entre los textos vivos en orden de lectura (`readingOrder`) por **prefijo**:
  - 0 coincidencias → 400 «No hay ningún bloque que empiece por «…»».
  - más de 1 → 400 «Hay N bloques que empiezan por «…»: da más texto».
  - 1 → el diagrama va justo debajo de ese bloque (si es la etiqueta de una forma, debajo de la forma), alineado a
    su izquierda.
- Sin `after`: debajo de todo, alineado con el texto más a la izquierda (lo mismo que `update_note` con bloques
  nuevos).
- Hueco: con `after`, todo elemento vivo cuyo borde superior quede en o por debajo del punto de inserción baja
  `400 + 2 × 24` px (alto del embed más el espacio entre bloques), con su `version` subida para que el editor abierto
  lo fusione. Lo que cruza la línea (empieza arriba y acaba abajo, p. ej. un marco grande) no se mueve. Así no se
  solapa nada y el orden de lectura se conserva. ponytail: desplazamiento por la coordenada `y`; una nota con
  columnas en paralelo baja también la otra columna, y una flecha que va de arriba a abajo no se estira: queda
  suelta de su destino hasta que se edita en la app. Mover también esas flechas si molesta.
- Índice fraccionario después del mayor existente y pie de la nota: un helper `appendAt(note)` →
  `{ left, bottom, nextIndex }` sacado de `replaceNoteText` y usado por las dos funciones.
- Ya incrustado (`noteEmbeds(note.elements).includes(boardId)`) → 409 «ya está incrustado» antes de guardar: repetir
  la llamada no duplica.
- Respuesta: `Diagrama «título» (boardId) incrustado en la nota (revisión N)` + «debajo de «…»» o «al final».

## Auditoría

`run(mcp, 'embed_board', a, …)`: registra la nota como `projectId`. Se añade `embed_board` a la lista de `tool` de
`mcpAudit` en `firestore.rules.tpl` (ya se despliegan reglas por las carpetas) y al bucle de nombres de
`tests/rules/mcp.test.ts`.

## Código

- `src/editors/note/embed.ts`: exportar `SITE_ORIGINS` (único cambio).
- `src/server/note.ts`: función pura `embedBoard(note, boardId, after, now)` → `NoteContent`; lanza `RangeError`
  con 0 o varias coincidencias (`tools.ts` lo pasa a 400, como ya hace con `decodeNote`).
- `src/server/tools.ts`: herramienta `embedBoard` (carga nota y diagrama, `saveWithRetry`).
- `src/server/mcpServer.ts`: registro. `api/_mcp.mjs` regenerado.

## Pruebas

`src/server/note.test.ts` (puras):
1. Sin `after`: el embed queda debajo de todo y `noteEmbeds` lo reconoce.
2. Con `after`: queda debajo del bloque; los bloques de debajo bajan 448 px y suben `version`; los de arriba no se
   tocan; el orden de lectura del texto no cambia.
3. `after` por prefijo; 0 o varias coincidencias → error.

`src/server/tools.test.ts` (emulador): dueño incrusta y `read_note` lo lista en `embeds` con su Mermaid; editor de la
nota puede; viewer de la nota → 403; diagrama ajeno sin acceso → 403 y la nota intacta; ya incrustado → 409.

`e2e.test.ts`: lista exacta de herramientas y auditoría de `embed_board`.

## Documentación

`docs/mcp.md` (tabla, errores, apartado corto), `AGENTS.md` (Propósito) y `HANDOFF.md`.

## Prueba real (tras desplegar, junto con las carpetas)

Incrustar en `I4oZ0KH9u9q0a8MYfGPn`: `vyivhmlsnxj3TPbJfevp` al final de la sección «Piezas» (`after` = «SharePoint,
sitio Sistemas de Gestión de Calidad») y `FWeKDa5u3pzaFujrBtrf` al inicio de «Flujo del usuario del plugin» (`after`
= «Diagrama completo:»).
