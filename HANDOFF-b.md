# HANDOFF — carril B · Editor de nota

Rama `lane/b-note-editor` (desde `feat/base`, sin push). Solo se tocó `src/editors/note/**` y este fichero.

## Qué hay

| Pieza    | Fichero                                         | Notas                                                                                                                                                                         |
| -------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codec    | `codec.ts`                                      | `NoteContent` intacto + `buildNoteContent` (sin borrados; `files` solo de imágenes vivas), `decodeNote` (valida), `encodeNote`, `referencedFileIds`                           |
| Archivos | `files.ts`                                      | `diffNewFiles`, `rejectReason` (PNG/JPEG/GIF/WebP ≤ 4 MiB), `createUploadQueue` (3 reintentos: 1-2-4 s)                                                                       |
| Embed    | `embed.ts`                                      | `parseBoardLink`, `validateEmbeddable` (true solo mismo origen `/embed/board/<id>`, `undefined` el resto), `newEmbeddable` (elemento completo, se pasa por `restoreElements`) |
| Lienzo   | `NoteCanvas.tsx` (lazy) → `NoteCanvasInner.tsx` | Excalidraw en chunk propio; hidratación, subida, embed, «Insertar diagrama», librería                                                                                         |
| Embed UI | `BoardEmbed.tsx`, `InsertBoardDialog.tsx`       | `BoardViewer` lazy; «Abrir» y «Recargar»; «Diagrama privado o inexistente»                                                                                                    |
| Editor   | `NoteEditor.tsx`, `TopBar.tsx`                  | Autosave, título, compartir (público + copiar), borrador, conflicto                                                                                                           |
| Librería | `library.ts`                                    | `localStorage['dya:note-library']`                                                                                                                                            |

## Decisiones y desviaciones

1. **Props opcionales añadidas a `NoteCanvasProps`** (superconjunto, la firma de T0 sigue válida): `topRight?: ReactNode` (se pinta en `renderTopRightUI`, solo en edición) y `onHandle?(h: NoteHandle | null)` (para «Recuperar»). Quien use `NoteCanvas readonly` (carril A) no necesita nada más.
2. **No se usa `serializeAsJSON` ni `getSceneVersion`**: el contenido se construye con `buildNoteContent` (forma exacta de `NoteContent`); el diff de `useAutosave` por string evita escrituras idénticas.
3. **Avisos de conflicto, error de guardado, demasiado grande y «Recuperar cambios» van en un banner bajo la barra de herramientas** (centrado), no dentro de `renderTopRightUI`: la esquina no cabe a 1024 px. En la esquina quedan volver, título, estado y compartir. El borrador recuperado se conserva en memoria hasta decidir aunque el siguiente guardado reescriba el de `localStorage`.
4. **`onChange` con respiro de 150 ms** (y emisión inmediata al desmontar) para no escribir el borrador en cada fotograma de un arrastre. Salir de la nota en esos 150 ms puede perder el último trazo (el `flush` de `useAutosave` solo ve lo ya empujado).
5. **El archivo se registra en `content.files` al detectarlo**, no al terminar la subida (plan). Si la subida agota los reintentos, el binario solo sigue **en memoria** (no en el borrador: el borrador del `saveQueue` solo guarda `data`); hay `beforeunload` mientras haya subidas pendientes.
6. **Formato/tamaño no admitido (SVG, > 4 MiB)**: Excalidraw los acepta, Storage no; se borra la imagen de la escena (`CaptureUpdateAction.NEVER`) y se avisa con un toast.
7. **Recuperar borrador** sustituye la escena con `CaptureUpdateAction.NEVER` (no es deshacible).
8. `MainMenu` propio: «Insertar diagrama», guardar como imagen, exportar, buscar, ayuda, fondo, borrar lienzo. Sin cambio de tema de Excalidraw (manda el tema de la app) ni abrir/guardar fichero.

## Lo que necesito de fuera (T5 / otros carriles)

- **Carril A (`Viewer`)**: con `NoteCanvas readonly` el «Abrir» de un embed va a `/view/board/:id` (no `/board/:id`). Un board incrustado solo se ve en una nota pública si **el board también es público** (si no, `BoardEmbed` muestra «Diagrama privado o inexistente»): conviene avisarlo en el panel al publicar una nota con embeds.
- **C1 (`BoardViewer`)**: `BoardEmbed` lo monta en un contenedor `width/height: 100%` y lo carga con `import()`. Debe llenar su contenedor y no capturar atajos globales.
- **T5**: probar `NoteCanvas readonly` + embed sin sesión (en este carril no hay visor real; solo se probó en edición). Los `Abrir`/`Recargar` del embed solo reciben el ratón cuando Excalidraw activa el embed (doble clic), comportamiento de Excalidraw.
- Bundle: `NoteCanvas` arrastra el chunk de Excalidraw (≈ 1,58 MB gzip) solo al montarse; los chunks de Mermaid/diagramas los trae `@excalidraw/mermaid-to-excalidraw` y son lazy.

## Comprobado en Chrome (emuladores, `demo-dya`)

Dibujar → recargar persiste · pegar PNG (portapapeles) → sube a Storage, recarga y vuelve · insertar diagrama → deshacer → rehacer → recargar conserva el embed · dos pestañas: la segunda que guarda ve «Conflicto» con Recargar / Guardar como copia (la copia se crea y se abre) · «Nuevo diagrama» crea e inserta · compartir (público, copiar), renombrar · tema oscuro y 1024 px. Sin errores de página; solo el 400 esperado del emulador de Auth al recrear el usuario de prueba.

## Pendiente

- Prueba manual del toast «Reintentar» de subida con Storage caído (cubierto por test de la cola, no por navegador).
- Sin e2e (T6).
