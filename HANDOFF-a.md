# HANDOFF-a — carril A · Panel y visor

Rama `lane/a-dashboard-viewer` (desde `feat/base`). Solo se tocó `src/app/dashboard/**` y `src/app/viewer/**`.

## Estado

Hecho: panel (Nuevo, grilla, tabs, búsqueda, menú de tarjeta, estados), `/view/:type/:id` y `/embed/board/:id`.
Gates en verde: `pnpm lint`, `typecheck`, `test` (70), `build`.

## Parches propuestos fuera de mi carpeta (para T5)

Ninguno bloquea. Ordenados por utilidad:

1. **`src/ui/Dialog.tsx`: foco inicial en «Cancelar».** `DialogContent` no expone `onOpenAutoFocus`; en el diálogo de borrar, Radix enfoca la X de la cabecera. Propuesta: prop opcional `initialFocus?: RefObject<HTMLElement>` que haga `onOpenAutoFocus={(e) => { e.preventDefault(); initialFocus.current?.focus(); }}`. Hoy el borrado ya exige abrir menú → «Borrar…» → «Borrar», así que no es grave.
2. **`src/ui/Dialog.tsx` / menús: foco al cerrar un diálogo abierto desde un menú.** Radix intenta devolver el foco al ítem del menú, que ya no existe, y el foco cae en `body`. En `ProjectCard` se resolvió a mano (efecto que enfoca el botón de opciones). Si otro carril abre diálogos desde menús, conviene un helper común.

## Lo que el visor espera de otros carriles

- **B (`NoteCanvas`) y C1 (`BoardViewer`)** se pintan dentro de un contenedor `position: absolute; inset: 0` bajo la cabecera (o a pantalla completa en el embed). Deben ocupar el 100 % de alto y ancho de su padre; no deben fijar su propia altura en `vh`.
- `Viewer` y `EmbedPage` cargan ambos motores con `lazy()`: no hace falta que los exporten distinto, pero deben mantener el export con nombre (`NoteCanvas`, `BoardViewer`).
- El visor pasa a `BoardViewer` el contenido ya validado con `validateBoardContent` (invariante 8) y a `NoteCanvas` el contenido con forma comprobada (`schemaVersion 1`, `elements[]`, `files{}`); la nota no se sanea más, eso lo hace Excalidraw.
- Sigue en pantalla el `Stub` de ambos carriles hasta que se integren; no se pudo comprobar el dibujo real.

## Decisiones y notas

- **«Error de red, reintentar»**: título «Error de red» + botón «Reintentar». Se usa también si el contenido existe pero no se puede leer (JSON roto o inválido), porque la única acción útil es reintentar; si se prefiere un mensaje distinto para contenido corrupto, es un cambio en `useProjectView.ts`.
- **Tipo equivocado** (`/view/note/<id de un board>`): se trata como «No existe o es privado».
- **Dueño en el visor**: si hay sesión y `uid === ownerId`, la cabecera muestra «Editar».
- **Tabs** manuales (`role="tablist"` con flechas, Inicio y Fin): no hay `@radix-ui/react-tabs` instalado y no se añadió dependencia.
- **Público**: un único ítem de menú alterna «Compartir con enlace público» / «Dejar de compartir»; con el proyecto público aparece «Copiar enlace» (`/view/<type>/<id>`) y un toast con la misma acción al activarlo. `projectRepo.update` sube `updatedAt`, así que renombrar o publicar mueve la tarjeta al principio.
- **Emuladores compartidos**: otros carriles crean proyectos con la misma cuenta de prueba, por eso la grilla de pruebas mostraba proyectos ajenos.

## Comprobado en navegador (Chrome, emuladores, 1280 y 1024 px, claro y oscuro)

Crear nota y diagrama, estado vacío, cargando, renombrar (teclado, Enter, Escape, foco de vuelta), duplicar, publicar, copiar enlace (portapapeles), tabs con flechas, búsqueda sin resultados, borrar con diálogo (Escape cancela y devuelve el foco), enlace público abierto en otro contexto sin sesión, privado e inexistente («No existe o es privado»), tipo equivocado, embed y embed inexistente, error de red (Firestore bloqueado) con «Reintentar» que recupera, `noindex` presente.

## Pendiente

- Comprobar con los editores reales (B y C1) el tamaño del lienzo en `/view` y `/embed`.
- Dashboard: el estado de error (`useMyProjects` con error) no se pudo provocar contra el emulador; el código sigue el mismo patrón que el del visor y no tiene prueba automática.
- Sin tests de componentes (Vitest corre en `node`, sin DOM): solo la lógica pura (filtro, fecha relativa, lectura de contenido).
