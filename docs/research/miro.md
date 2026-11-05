# Investigación: funciones de diagramación de Miro

Pregunta: ¿qué funciones del board de Miro debemos incluir en un lienzo propio (React Flow) y cómo se comportan?
Fecha de captura: 2026-11-05. Usuario objetivo: quien diseña arquitecturas de software en laptop.

## 0. Método y niveles de evidencia

Herramienta: REA (`rea-agents` 6.x, MCP `mcp__rea__*` conectado; no se usó la CLI de respaldo). Chrome lanzado por REA con perfil temporal, sin sesión de Miro.

Etiquetas de evidencia usadas en las tablas:

- **[REA-JS]** `capture_browser_scenario` sobre el board + `export_web_scripts`: 118 bundles JS exportados (21 MB, `mirostatic.com/app/static/*`), minados con búsquedas de texto. Observado en código enviado al cliente.
- **[REA-i18n]** Las mismas capturas incluyeron 55 ficheros `trans/*.json` (10 590 cadenas de interfaz en inglés). Observado: nombres de herramientas, menús y modales de atajos.
- **[WEB]** Páginas públicas de miro.com leídas con WebFetch (subagente): `/diagramming/`, `/templates/`, `/mind-map/`, `/mermaid-diagram/`.
- **[CONOC]** Conocimiento previo del producto y del Web SDK público de Miro. **No verificado en esta sesión**; tratar como hipótesis.

## 1. Tabla de funciones del lienzo

Prioridad: P0 = sin esto el lienzo no sirve para arquitectura; P1 = esperado en uso diario; P2 = diferenciador o diferible.

| Función | Comportamiento observado/inferido | Prio | Evidencia |
|---|---|---|---|
| Lienzo infinito con pan/zoom | Sin bordes ("canvas doesn't have edges"). Zoom in/out, zoom a 100 %, zoom a ajustar, zoom al objeto seleccionado, minimapa, mano (Hand) | P0 | [REA-i18n] `shortcutsModal.general.zoom*`, `tools.minimap`, `tools.selectToolHand`; [WEB] mind-map |
| Selección | Clic, multiselección (Shift/arrastre), seleccionar todo, deseleccionar/salir de edición/volver a cursor, seleccionar el objeto más cercano en una dirección, foco siguiente/anterior objeto | P0 | [REA-i18n] `general.selectAll`, `selectMultipleItems`, `deselect`, `navigation.closestObject/nextObject/previousObject` |
| Formas (shapes) | Widget `shape` con 39 tipos de catálogo: básicas (rectangle, round_rectangle, circle, triangle, rhombus, parallelogram, star, pentagon, hexagon, octagon, trapezoid, cross, can, cloud, left/right/left_right_arrow, left/right_brace, wedge_round_rectangle_callout) y 25+ de diagrama de flujo (`flow_chart_process`, `_decision`, `_terminator`, `_input_output`, `_document`, `_multidocument`, `_predefined_process`, `_magnetic_disk`, `_internal_storage`, `_online_storage`, `_delay`, `_display`, `_manual_input`, `_manual_operation`, `_merge`, `_or`, `_summing_junction`, `_preparation`, `_connector`, `_offpage_connector`, `_note_square/curly_left/curly_right`…). Texto dentro, relleno, borde | P0 | [REA-JS] enum `r.Rectangle="rectangle"…` en `c~Board.d3e7580c…js` |
| Bibliotecas de formas especializadas | BPMN, UML, ERD, AWS, Azure, Google Cloud, Kubernetes. Las básicas/flujo son gratis; la biblioteca completa es de pago ("3,900+ shapes and icons"). Existe widget `stencil_shape` (texts + style) | P1 (iconos AWS/Azure/GCP/K8s son P0 de contenido para arquitectura, pero se resuelven con un paquete de iconos propio) | [WEB] /diagramming/; [REA-JS] `stencil_shape`, enum `uml-class`/`uml-interface` |
| Conectores (connection lines) | Widget `connector`: `shape` por defecto `curved` (también `straight`, y codo/elbowed según SDK), `start`/`end` (extremos enlazados a un item o libres), `style`, `captions[]` (textos sobre la línea). Herramienta "Connection line, arrow" | P0 | [REA-JS] `class{…this.type="connector",this.shape="curved",this.start=void 0,this.end=void 0,this.style={},this.captions=[]…}`; [REA-i18n] `board.common.connectionLine`, `tools.connectionLineArrow` |
| Conectores: anclaje y reenrutado | Extremo se ancla a un lado/punto del objeto ("snap") y sigue al objeto al moverlo; borrar objeto desconecta el extremo (`disconnectedWidgetId`, `deletedByKeyboardShortcut` en analítica). Estilo de trazo, flechas en extremos, etiquetas | P0 | [REA-JS] eventos de analítica `disconnected_widget_id`; [CONOC] `startStrokeCap/endStrokeCap`, `snapTo` (no aparecen en los bundles cargados sin sesión) |
| Texto libre | Widget `text` con `content`, `fontFamily` (arial), `fontSize` (14), `textAlign` (left), `color`, `fillColor` transparente | P0 | [REA-JS] clase `text` |
| Notas adhesivas (sticky notes) | Widget `sticky_note`: `shape` `square` (también `rectangle`), `content`, `tagIds[]`, `style.fillColor` con 16 colores (gray, light_yellow, yellow, orange, light_green, green, dark_green, cyan, light_pink, pink, violet, red, light_blue, blue, dark_blue, black), alineación centrada | P1 (útil para anotar supuestos/riesgos sobre el diagrama) | [REA-JS] clase `sticky_note` + enum de colores |
| Frames (marcos) | Widget `frame`: `title` (nombre por defecto "Frame N"), `childrenIds[]`, `style.fillColor` transparente. Contiene objetos; `add/remove/getChildren`; mostrar/ocultar frames; mover slide adelante/atrás; exportar frames a PDF; se redimensiona salvo mientras se edita contenido | P0 (equivale a "zona/límite de sistema/contexto" en arquitectura) | [REA-JS] clase `frame` (`FRAME_GET_CHILDREN`); [REA-i18n] `hideFrame.tooltip`, `reordering.*`, `exportHelpers.PDFTooltip`, `defaultFrameName` |
| Grupos | Widget `group` con `itemsIds[]`; comandos `GROUP_GET_ITEMS`, `GROUP_UNGROUP`; agrupar/desagrupar desde menú contextual | P0 | [REA-JS] clase `group`; [REA-i18n] `groupObjects.tooltip`, `general.group/ungroup` |
| Mapa mental | Widget experimental `mindmap_node` con `nodeView` (shape o text) y `childrenIds[]`; botón "+" a cada lado crea ramas; doble clic edita; "Auto layout" reubica ramas; opciones de tipo/estilo/opacidad de nodo; ampliar con IA | P2 | [REA-JS] `mindmap_node`; [REA-i18n] `MindmapAutoLayoutItem.autoLayout`; [WEB] /mind-map/ |
| Diagrama desde código | Pegar Mermaid (flowchart, sequence, class, ER, state, gantt; "cloud") y obtener formas editables; edición bidireccional lienzo↔código vía MCP; también PlantUML. El chunk `diagram-as-code` (372 KB) incluye editor Ace con modo `mermaid` | P1 (alto valor para el nicho: texto→diagrama y exportar a Mermaid) | [WEB] /mermaid-diagram/, /diagramming/; [REA-JS] `diagram-as-code.*.js`, `ace/mode/mermaid` |
| Tablas | Widget `table`: `addRows/addCols/removeRows/removeCols`, estilos de celda, fusionar celdas, eliminar fila/columna, exportar CSV | P2 | [REA-JS] clase `table` (`TABLE_ADD_ROWS_AND_COLUMNS`…); [REA-i18n] `gridMergeCellsItemDef.mergeCells`, `exportToCSV` |
| Tarjetas, doc estructurado, data_table, app_card, insights_card | `card` (title, description, dueDate, assignee, taskStatus, fields), `struct_doc` (title + markdown), `data_table`, `app_card` (integraciones Jira/Azure) | P2 | [REA-JS] clases correspondientes |
| Imágenes, embeds, previews | `image` (title, alt, getFile/getDataUrl), `embed` (previewUrl, mode inline), `preview` (enlace con vista previa); recortar imagen | P1 (imagen/logos) / P2 (embed) | [REA-JS] clases `image/embed/preview`; [REA-i18n] `crop.tooltip` |
| Dibujo libre y borrador | Pluma (`pen`), borrador y borrador de precisión; reconocimiento de dibujo → forma/conector (`drawingrecognition`) | P2 | [REA-i18n] `tools.pen/eraser/precisionEraser`, `drawingrecognition.*` |
| Formato de texto en objetos | Negrita, cursiva, subrayado; fuente, tamaño, alineación horizontal/vertical, color; opacidad de relleno; borde (estilo, color, grosor, opacidad) | P0 (fuente/tamaño/color/borde/relleno), P1 (negrita/cursiva) | [REA-i18n] `shortcutsModal.font.*`, `contextMenu groups.typography/colors`; [REA-JS] props `style` |
| Alinear y distribuir | Alinear izquierda/centro/derecha/arriba/medio/abajo; distribuir horizontal/vertical; "Organize" en menú contextual | P0 | [REA-i18n] `organize.align.*`, `organize.distribute.*`, `contextMenu.alignObjects.tooltip` |
| Cuadrícula y guías | Alternar cuadrícula (atajo "Toggle grid"); ajuste a la cuadrícula; guías inteligentes de alineación al arrastrar | P0 (grid+snap), P1 (guías) | [REA-i18n] `general.toggleGrid`; guías: [CONOC] |
| Capas / orden Z | Traer al frente / enviar atrás; también "poner delante/detrás de X" (`BRING_IN_FRONT_OF`, `SEND_BEHIND_OF`, `getLayerIndex`). "Layers" de producto: mostrar/ocultar/agrupar objetos en el mismo board (plan Free) | P0 (orden Z), P2 (capas de visibilidad) | [REA-JS] SDK `bringToFront/sendToBack/bringInFrontOf/sendBehindOf`; [WEB] /diagramming/, precios |
| Bloquear/desbloquear | Bloquear objeto; variante "protegido" (solo propietario/co-propietario desbloquea); clic con modificador selecciona objeto bloqueado | P1 | [REA-i18n] `general.lockUnlock`, `protectedLock`, `contextMenu.horizontal.lockedTooltip*`, `gotolink.hintTooltip.selectLockedHint` |
| Deshacer/rehacer | Historial `HISTORY_UNDO/REDO/CAN_UNDO/CAN_REDO` | P0 | [REA-JS] clase `$`; [REA-i18n] `tools.undo/redo` |
| Copiar/pegar/duplicar/cortar/borrar | Portapapeles (con modal de ayuda si el navegador lo bloquea), duplicar, cortar, eliminar; copiar como SVG, copiar a Figma | P0 (copiar/pegar/duplicar/borrar), P2 (copiar a Figma) | [REA-i18n] `general.copyPaste/cut/duplicate/delete`, `exportAsImageItemDef.copyAsSvg` |
| Mover con teclado / redimensionar | Flechas mueven objetos o lienzo; atajo para aumentar/disminuir tamaño; relación de aspecto bloqueable en panel de dimensiones | P1 | [REA-i18n] `general.moveItemsCanvas`, `increaseDecreaseObjectSize`, `dimensions.a11y.aspectRatioLockedDesc` |
| Menú contextual flotante | Grupos "Formatting tools", "Arrangement tools", "Borders and Styling", "Links and Connections", "Frame Options"; insertar enlace a objeto | P0 (barra flotante de estilo) | [REA-i18n] `contextMenu*` |
| Enlaces a objeto | Añadir/editar enlace a un objeto; "go to link" | P2 | [REA-i18n] `general.linkToObject`, `contextMenuTooltips.insertLink`; [REA-JS] `goToLink` |
| Etiquetas (tags) | Widget `tag` y campo `tagIds[]` en sticky/card; filtrar/buscar por etiqueta | P1 | [REA-JS] `.widget("tag",…)`, `tagIds`; detalle UI: sin evidencia |
| Comentarios | Herramienta Comment, mostrar/ocultar, siguiente/anterior comentario; mencionar a compañeros; permisos ver/comentar/editar | P2 (producto de un solo usuario primero) | [REA-i18n] `tools.comment`, `navigation.nextComment`; [WEB] mind-map |
| Búsqueda y paleta de comandos | Buscar en el board; abrir paleta de comandos | P1 | [REA-i18n] `general.search`, `openCommandPalette` |
| Exportar | Exportar como imagen, como PDF (frames), copiar SVG, CSV (tablas), exportar a Mermaid | P0 (PNG/SVG), P1 (JSON propio/Mermaid), P2 (PDF) | [REA-i18n] `exportAsImageItemDef.*`, `common.exportAsPDF`; [WEB] /mermaid-diagram/ |
| Importar | Desde Visio, draw.io, Lucidchart, Mermaid, PlantUML, CSV (organigramas) | P2 (Mermaid P1) | [WEB] /diagramming/ |
| Plantillas | Catálogo "Miroverse" (>7 000): "Use template", "Quick view", filtros New/Popular, categorías | P2 (3–5 plantillas de arquitectura propias, P1) | [WEB] /templates/ |
| Colaboración | Cursores en vivo, chat de cursor, usuarios en línea, votación, temporizador, presentación | P2 (fuera de alcance v1) | [REA-i18n] `general.cursorChat`, `timer.*`; [REA-JS] `GET_ONLINE_USERS`, `GET_VOTING_RESULTS` |
| Barra de herramientas | Creación (cursor/mano, formas, sticky, texto, conector, frame, pluma), "More tools", apps instalables, paneles de IA ("Create with AI") | P0 (barra mínima) | [REA-i18n] `boardTools.toolbar.moreTools`, `toolbar.*`; modal de atajos: "números 1–9 cambian de herramienta" |
| IA generativa | Generar diagrama/mapa mental/estructura desde texto; sidekicks | P2 | [REA-i18n] `genai_panel_ai_generate_diagram`, `ai_mindmap_expand`; [WEB] |

## 2. Atajos de teclado principales

El modal de atajos de Miro enumera las **acciones** (observado en [REA-i18n]); las **teclas** no están en los bundles cargados sin sesión ni en la ayuda (bloqueada). Las teclas de abajo son **[CONOC], sin verificar**; `Mod` = Ctrl (Windows/Linux) o Cmd (Mac). Solo `mod+/` (mostrar/ocultar barra lateral) está literalmente en un bundle [REA-JS].

| Acción (observada) | Tecla probable [CONOC] |
|---|---|
| Deshacer / Rehacer | Mod+Z / Mod+Shift+Z (o Mod+Y) |
| Copiar / Cortar / Pegar / Duplicar | Mod+C / Mod+X / Mod+V / Mod+D |
| Seleccionar todo | Mod+A |
| Borrar | Supr / Retroceso |
| Agrupar / Desagrupar | Mod+G / Mod+Shift+G |
| Bloquear / Desbloquear | Mod+L (protegido: Mod+Shift+L) |
| Traer al frente / Enviar atrás | Mod+Shift+] / Mod+Shift+[ |
| Zoom + / − / 100 % / ajustar / a selección | Mod++ / Mod+− / Shift+0 o Mod+0 / Shift+1 / Shift+2 |
| Alternar cuadrícula | Mod+' |
| Editar objeto seleccionado | Enter |
| Salir de edición / volver a cursor | Esc |
| Buscar / Paleta de comandos | Mod+F / Mod+K |
| Mover lienzo | Espacio+arrastrar o rueda con Mod |
| Herramientas | V cursor, H mano, S sticky, T texto, R rectángulo, O óvalo, L conector, P pluma, F frame, C comentario, E borrador (también 1–9 por posición) |
| Mostrar/ocultar comentarios | Shift+C |
| Moverse entre objetos | Tab / Shift+Tab; flechas con Alt para el más cercano |

## 3. Modelo de datos aparente de un widget

Procede del cliente del Web SDK incluido en `c~Board.*.js` [REA-JS]: clases por tipo registradas con `.widget("<tipo>", Clase)` y comandos `WIDGET_CREATE/UPDATE/REMOVE`, `WIDGET_GET/SET_METADATA`. Todas extienden una clase base (módulo `917841`, no localizado en los bundles cargados); sus campos comunes (`id`, `type`, `x`, `y`, `width`, `height`, `rotation`, `parentId`, `createdAt`, `modifiedAt`, `createdBy`) se ven usados (`this.id`, `modifiedAt`) pero la lista completa es [CONOC].

Tipos de widget observados (SDK estable): `app_card, card, connector, embed, frame, image, preview, shape, sticky_note, text, group, tag`. Experimental/ampliados: `mindmap_node, table, struct_doc, insights_card, stencil_shape, data_table, workflow_button, workflow_ai_node, workflow_knowledge_node`.

Propiedades por defecto observadas:

```
shape:        type="shape", shape="rectangle", content="",
              style{ fontFamily:"arial", fontSize:14, textAlign:"center", textAlignVertical:"middle",
                     borderStyle:"normal", borderOpacity:1, borderColor:"#1a1a1a", borderWidth:2,
                     fillOpacity:1, color:"#1a1a1a" }            (fillColor ausente = por defecto)
sticky_note:  type, shape="square", content="", tagIds=[],
              style{ fillColor:"light_yellow", textAlign:"center", textAlignVertical:"middle" }
text:         content="", style{ fillColor:"transparent", fillOpacity:1, fontFamily:"arial",
              fontSize:14, textAlign:"left", color:"#1a1a1a" }
connector:    shape="curved", start, end, style{}, captions[]    // start/end referencian item + posición
frame:        title="", childrenIds[], style{ fillColor:"transparent" }
group:        itemsIds[]
mindmap_node: nodeView{ type:"shape"|"text", shape, content, style{color,fontSize,fillOpacity,borderStyle} },
              childrenIds[]
table:        filas/columnas con estilos por celda; add/remove rows+cols; children con target (fila, col)
card:         title, description, dueDate, startDate, assignee, taskStatus="none", tagIds, fields[]
image:        title, alt;  embed: previewUrl, mode="inline"
stencil_shape:texts{}, style{ fillColor:"transparent", … igual que shape }
```

Otras observaciones de arquitectura:

- El tablero se renderiza con un motor propio en WebAssembly (`@mirohq-internal/surface-engine`, `library-engine_wasm.*.js`) y usa protobuf (`library-descriptor_pb`) — el modelo de objetos de tiempo real no se ve en JSON REST.
- Jerarquía padre/hijo en el motor: `setParent(id, parentId)`, un objeto no puede ser su propio padre; frames, grupos y mapas mentales usan listas `childrenIds`/`itemsIds`.
- Las IDs y el orden Z son enteros/cadenas asignados por el servidor (`getLayerIndex`).
- API REST vista sin sesión: `GET /api/v1/boards/{id}/request-access-info` (200) y `GET /api/v1/boards/{id}?fields=defaultSidekickId` (403 `boardAccessDenied`). La sincronización de contenido del board no se observó.
- Estilo en el esquema: colores de sticky como nombres de paleta (`light_yellow`); colores de forma/texto como hex.

Mapeo sugerido a React Flow (decisión de diseño, no observación): `shape` → nodo personalizado (tipo + `data.shape`), `connector` → arista con `source/target/handle` y etiqueta, `frame` → nodo grupo (`parentId`, `extent`), `group` → selección agrupada o nodo grupo, `sticky_note`/`text` → nodos simples, `mindmap_node`/`table` → posponer.

## 4. Limitaciones

1. **Board del usuario inaccesible**: `uXjVP_4ejdQ=` es privado; sin sesión devuelve 403 `boardAccessDenied` (`request-access-info` sugiere solicitar acceso al propietario). No se inició sesión (instrucción). Por eso no se vio el DOM del canvas, la barra de herramientas real, ni las teclas.
2. **Bundles parciales**: solo se cargan los chunks que Miro sirve sin sesión (118 scripts). El registro real de atajos, los tipos de conector (`elbowed`, `startStrokeCap`, `snapTo`) y la clase base del widget no aparecieron; se marcan [CONOC]. Los chunks cargados con `import()` tras autenticarse no se observaron.
3. **help.miro.com bloqueado**: 403 para fetch automático y desafío Cloudflare/Turnstile con Chrome lanzado por REA. No se eludió. Quedan sin evidencia directa: ayuda de formas, conectores, frames, sticky, cuadrícula/alineación, capas, comentarios, tags y tabla oficial de atajos.
4. **Páginas públicas**: algunas llegaron truncadas y resumidas por el modelo del subagente; las páginas /diagramming/ y /templates/ son de marketing, sin atajos ni límites técnicos (tamaños, nº de objetos).
5. REA capturó cuerpos de red con límite de 64 KB por defecto (la primera captura dejó fuera los chunks grandes); se repitió subiendo `max_network_body_bytes`. Los cuerpos vienen de `Response.body()` de Playwright, no garantizan bytes de red idénticos. El resultado inline superó 10 MiB y se recuperó con `export_evidence_bundle`.
6. Análisis estático: que un tipo/propiedad aparezca en el bundle no prueba que se use en producción ni cuál es su comportamiento en el lienzo. Los comportamientos de la tabla combinan nombres de acciones (i18n) y clases del SDK; las interacciones (arrastre, snapping, enrutado de conectores) son inferidas.
7. Planes: varias funciones (bibliotecas BPMN/UML/AWS, capas, IA) dependen del plan de pago; Free limita a 3 boards editables.
8. No se copió código ni assets de Miro al repo; solo nombres de campo/enum y cadenas de interfaz citadas como evidencia.

Artefactos de trabajo (fuera del repo, scratchpad de la sesión): `.../scratchpad/miro-scripts2/`, `miro-evidence.json`, `trans-all.json`.
