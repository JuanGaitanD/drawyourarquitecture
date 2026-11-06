# Stack — drawyourarquitecture

App web personal, open source, para dos tipos de proyecto (como TinkerCAD):

- **Nota** (`note`): pizarra libre tipo Excalidraw. Puede incrustar boards propios.
- **Diagrama** (`board`): lienzo estructurado tipo Miro (formas, conectores, frames, stickies, iconos, autolayout).

Objetivo de pantalla: laptop en adelante (≥ 1024 px). Fase 1: un solo dueño y enlace público de solo lectura. Fases 2 y 3 (hechas, ver `plan-fases-2-3.md`): colaboración en tiempo real y servidor MCP.

Fuentes: [`architecture.md`](architecture.md), [`plan.md`](plan.md) (rev. 2, manda en alcance y contratos), [`research/`](research/) y la revisión independiente de GPT-6.1 Sol del 2026-11-05: [`review/stack-gpt.md`](review/stack-gpt.md). Las versiones se fijan exactas en T0 (`npm view`, sin `^`) tras comprobar que los dos motores corren juntos.

## Decisiones

| Capa | Elección | Por qué | Descartado |
|---|---|---|---|
| Build | **Vite (react-ts) + TypeScript strict** | SPA estática y rápida. Los dos editores son canvas de cliente. Partir de la rama vigente de Vite (8.3 al 2026-11-05), no de la 7 | Next.js: válido (el editor iría en una frontera solo cliente), pero suma servidor y convenciones sin necesidad hoy |
| Node | **24** (patch fijado en T0) | Vitest 5 pide ≥ 22.12 o 24 | — |
| UI | **React 19** | `@excalidraw/excalidraw` 0.18.1 declara React 19; un solo runtime | Svelte/Solid: dos runtimes |
| Router | **wouter** | Cinco rutas, sin datos de servidor. Con 404, fallback de carga y manejo de errores | react-router: conviene si llegan loaders o páginas públicas renderizadas |
| Motor de notas | **@excalidraw/excalidraw 0.18.1** (MIT), carga diferida | Edición, librería, Mermaid y export propios. Embeds con `validateEmbeddable` (booleano explícito, solo boards propios) y `renderEmbeddable`. Fuentes autoalojadas en `public/` | Reimplementarlo |
| Motor de diagramas | **@xyflow/react** (MIT) + nodos propios | Viewport, selección, handles, edges, minimapa, cuadrícula y resize resueltos. Alinear, distribuir, Z, frames, undo, clipboard y export son trabajo propio | tldraw: licencia source-available con clave de producción; Konva: demasiado bajo nivel |
| Autolayout | **elkjs**, import dinámico | Pedido en el alcance. Licencia `EPL-2.0 OR GPL-3.0-or-later` (no MIT): elegir y cumplir una, y reflejarlo en los avisos | Dagre (MIT, con releases; la nota «sin mantenimiento» era errónea): alternativa si ELK pesa demasiado |
| Estado | **zustand**, un store por instancia de board | Aísla pestañas y embeds. Estado transitorio separado del documento | Redux |
| Historial | **zundo solo en el board** | `partialize` (solo nodes y edges), límite 100, un gesto = un paso. Excalidraw conserva su historial nativo | Segundo historial sobre Excalidraw |
| Estilos | **CSS Modules + custom properties** (tokens) | Sin runtime. Los CSS de Excalidraw y React Flow se importan y se sobrescriben dentro de un wrapper | Tailwind: otra dependencia de build |
| Accesibilidad | **`<dialog>` nativo** + teclado propio; **lucide-react** para iconos | Cubre menús y diálogos sin dependencia. Si aparece un popover o menú complejo, valorar Radix | Radix/React Aria desde el día uno (recomendado por la revisión; se pospone por plazo) |
| Auth | **Firebase Auth** (Google) | Poder autenticarse no autoriza a escribir: crean el `OWNER_UID` y las cuentas con correo verificado en `allowedEmails`; editan el dueño y los invitados como editor | — |
| Datos | **Cloud Firestore** | Contenido como string JSON (sin arrays anidados) en `projects/{id}/content/main`, con codec único. Hasta 900 000 bytes UTF-8 en un documento; por encima, troceado en `content/main/chunks/{i}` con tope de 8 MiB, en una sola transacción | Supabase/Postgres (más operación sin resolver lo difícil) |
| Presencia | **Firebase Realtime Database** (plan Spark) | Presencia y cursores efímeros con `onDisconnect` y escrituras frecuentes que en Firestore gastarían cuota. Reglas propias (`database.rules.json`) con un espejo de acceso por dueño. Se carga con `import()`; sin `VITE_FIREBASE_DATABASE_URL` se apaga | Firestore (cuota de escrituras), WebSocket propio |
| Servidor MCP | **Función de Vercel** (`api/mcp`, Node) con `@modelcontextprotocol/sdk` | Admin solo emite identidad; los datos pasan por el SDK web autenticado como la persona, así que las reglas aplican tal cual. Empaquetado con esbuild en `api/_mcp.mjs` | Admin SDK para los datos (ignora las reglas y duplica la autorización) |
| Archivos | **Firestore troceado** (≤ 900 000 bytes por trozo, `Bytes`) con optimización previa a WebP | Sin Storage ni plan Blaze. Una imagen optimizada rara vez pasa de 1 MiB; el tope son 4 MiB | Firebase Storage (exige Blaze), base64 en el documento |
| Hosting | **Vercel Pro** (estático + rewrites SPA) | Ya lo tienes; previews por PR. El catch-all no intercepta assets ni `/api` | Firebase Hosting (equivalente) |
| Tests | **Vitest** (dominio, codecs, autosave, servidor MCP contra emuladores) y **@firebase/rules-unit-testing** con Emulator Suite (reglas de Firestore y RTDB, `pnpm test:rules`); **Playwright** para tres pruebas de humo (`pnpm test:e2e`) | Una prueba por cosa que puede romperse. Nada de mocks de Firebase para reglas | Playwright en v1 (recortado por tiempo; reevaluar tras v1) |
| Calidad | ESLint flat + Prettier, `tsc --noEmit`, build de producción. Restricciones de imports entre capas en lint | Estándar; la regla de dependencia se hace cumplir en lint | — |
| Gestor | **pnpm 12** (corepack, `pnpm-lock.yaml`, versiones exactas) | Un solo paquete, sin workspaces | Monorepo: solo con segundo consumidor o ciclo de release propio |

## Estructura y regla de dependencia

Un `package.json`, un lockfile, un build. Capas según [`architecture.md`](architecture.md): `app → features → data → domain`.

- `domain/` es TypeScript puro (excepción: `import type` de `@xyflow/react`). No importa React ni Firebase y se prueba sin mocks.
- Las features hablan con Firebase solo a través de `data/`; el único sitio que conoce el SDK es `data/firebase.ts`.
- La nota emite una referencia estable al board y `app` inyecta el render (`BoardEmbed`); el board nunca incrusta notas, así que no hay recursión.
- **No crear todavía:** workspaces, paquete de design system, backend propio, bus de eventos, CQRS, repositorio CRUD genérico, registro universal de motores, paquetes de colaboración.

## Rutas

| Ruta | Pantalla |
|---|---|
| `/` | Panel: lista de proyectos, crear nota o diagrama |
| `/note/:id` | Editor de nota (Excalidraw) |
| `/board/:id` | Editor de diagrama (React Flow) |
| `/view/:type/:id` | Solo lectura pública (si `isPublic`); también es el `link` de los embeds de board |

No hay ruta `/embed`.

## Open Graph y SEO

- Fase 1: etiquetas genéricas en `index.html` (título, descripción, imagen de marca) y `noindex` en las vistas públicas.
- Después: una función en `api/` para `/view/:type/:id` que, solo si `isPublic`, devuelve el `index.html` con título, descripción y miniatura propios (escapar títulos, no cachear metadatos privados, invalidar al despublicar). El SDK Admin omite reglas: la función comprueba `isPublic` a mano.

## UI

- Tokens semánticos (superficie, texto, borde, selección, foco, peligro, radios, espaciado, sombra, z-index) y tema `light/dark/system` con una sola fuente de verdad, adaptada a cada motor y a `color-scheme`. Los colores del dibujo persistidos no cambian con el tema.
- Pila tipográfica del sistema al inicio. Atajos solo con el editor enfocado, ignorando inputs e IME.
- Medir rendimiento con un documento representativo antes de prometer capacidad: selectores estrechos, nodos estables, sin escribir en Firestore por frame.
- La skill `disenojg` se usa al implementar el chrome (panel, barras, menús, diálogos) y los nodos propios; no sobre el lienzo de Excalidraw.

## Divergencias con la revisión de GPT (decididas)

La revisión recomendó un MVP más pequeño. El plan mantiene el alcance pedido («todas las funciones»), con estos riesgos aceptados y anotados:

| Recomendación de la revisión | Decisión |
|---|---|
| Posponer elkjs | Se mantiene (autolayout pedido); import dinámico y licencia declarada |
| Board mínimo (4 formas, sin Mermaid, sin agrupación) | Se mantiene el alcance del plan; si el tiempo aprieta, el orden de recorte está en `plan.md` |
| Capas `application/` + `infrastructure/` y puertos por caso de uso | Se mantiene `data/` con puertos pequeños; mismo efecto con menos carpetas |
| Radix Primitives | `<dialog>` nativo por ahora |
| Playwright para el flujo público | Prueba manual en T5 |
| Metadatos Open Graph por board | Posterior a v1 |

## Pendiente de verificar al arrancar (T0)

Excalidraw + Vite + React 19 en dev y en build de producción (texto, imagen, exportación, board embebido); `@vitejs/plugin-react` compatible con la versión de Vite elegida (el 6.x declara Vite 8; con Vite 7 usar el 5.x); fuentes de Excalidraw autoalojadas (`EXCALIDRAW_ASSET_PATH` antes del montaje); tamaño real del bundle inicial; compilación con la versión de TypeScript elegida.

## Cuentas (verificar antes de usar)

Proyecto **personal**: no va en la cuenta de Wigilabs. Antes de desplegar se comprueban `vercel whoami`/equipo y la cuenta de Google del proyecto Firebase. Sin Storage, el proyecto Firebase no necesita el plan Blaze.
