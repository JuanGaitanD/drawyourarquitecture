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
- Hueco: con `after`, lo que queda por debajo del punto de inserción baja **460 px** (alto del embed, 400, más
  tres filas de 20: múltiplo de 20 para que `readingOrder`, que agrupa por `round(y / 20)`, conserve el orden), con su
  `version` subida para que el editor abierto lo fusione. Se decide **por unidad**, no por elemento: la raíz de un
  elemento es su marco (`frameId`) si existe; si no, su contenedor (`containerId`, etiquetas); si no, él mismo (se
  sigue `containerId` y después `frameId`). Un elemento baja si el borde superior de su raíz está en o por debajo de
  la línea; así una etiqueta baja con su forma y los hijos con su marco. Un marco o una forma que cruzan la línea no
  se mueven, y con ellos su contenido.
  - Si el bloque `after` está dentro de un marco → 400 «el bloque está dentro de un marco»: el embed quedaría
    encima del resto del marco. No se escribe nada.
  - Guardas finales, sin escribir nada si fallan (400, «usa otro bloque o sin `after`»): (a) el rectángulo del
    embed no puede cortar ningún elemento vivo que no se movió (p. ej. un marco o una forma que cruzan la línea);
    (b) la secuencia de ids de `readingOrder` tiene que ser la misma antes y después (unidades con decisiones
    distintas pueden cambiar de fila). En una nota de bloques apilados —lo normal— no saltan nunca.
  - ponytail: desplazamiento por `y`; una nota con columnas en paralelo baja también la otra columna, y una flecha
    que va de arriba a abajo no se estira: queda suelta de su destino hasta que se edita en la app. Mover también
    esas flechas si molesta.
- Índice fraccionario después del mayor existente y pie de la nota: un helper `appendAt(note)` →
  `{ left, bottom, nextIndex }` sacado de `replaceNoteText` y usado por las dos funciones.
- Ya incrustado → 409 «ya está incrustado», comprobado **dentro** del paso de `saveWithRetry` (tras releer en cada
  reintento: dos llamadas simultáneas no lo insertan ni desplazan dos veces). Se reconoce con la misma política que la
  UI: un `embeddable` vivo cuyo enlace da ese id con `parseBoardLink(link, SITE_ORIGINS[0])` (orígenes de
  producción); un enlace de otro dominio no cuenta.
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
2. Con `after`: queda debajo del bloque; lo de debajo baja 460 px y sube `version`; lo de arriba no se toca; el
   orden de lectura no cambia, también con dos textos en la misma fila de 20 a distinta `y` (100 y 109).
3b. Unidades: una forma que cruza la línea y su etiqueta (debajo) no se mueven; una forma debajo baja con su
   etiqueta; un marco que cruza la línea conserva a sus hijos; `after` dentro de un marco → error.
3d. Guardas: con `after` fuera de un marco que cruza la línea y con una forma que la cruza, el embed los cortaría →
   error; un marco que empieza arriba con un texto hijo por debajo de un texto suelto (el suelto bajaría y
   cambiaría el orden) → error.
3c. Duplicado: un enlace de producción con ese id → error; uno de otro dominio, no.
3. `after` por prefijo; 0 o varias coincidencias → error.

`src/server/embed.excalidraw.test.ts` (jsdom, Excalidraw real como `editors/note/merge.test.ts`): el resultado pasa
por dos recorridos independientes: (1) `restoreElements` como al abrir la nota, y (2) `mergeNoteContent` del
resultado **sin restaurar** contra la escena anterior, como recibe el cambio una pestaña abierta. Los dos conservan el
embed (índice válido, después del resto) y los desplazamientos.

`src/server/tools.test.ts` (emulador): dos `embed_board` simultáneos sobre la misma nota y diagrama → exactamente uno
incrusta, el otro 409, la nota tiene un solo embed, lo de debajo bajó 460 px una sola vez (una sola subida de
`version`) y la revisión final es la inicial + 1; dueño incrusta y `read_note` lo lista en `embeds` con su Mermaid; editor de la
nota puede; viewer de la nota → 403; diagrama ajeno sin acceso → 403 y la nota intacta; ya incrustado → 409.

`e2e.test.ts`: lista exacta de herramientas y auditoría de `embed_board`.

## Documentación

`docs/mcp.md` (tabla, errores, apartado corto), `AGENTS.md` (Propósito) y `HANDOFF.md`.

## Prueba real (tras desplegar, junto con las carpetas)

Incrustar en `I4oZ0KH9u9q0a8MYfGPn`: `vyivhmlsnxj3TPbJfevp` al final de la sección «Piezas» (`after` = «SharePoint,
sitio Sistemas de Gestión de Calidad») y `FWeKDa5u3pzaFujrBtrf` al inicio de «Flujo del usuario del plugin» (`after`
= «Diagrama completo:»).
