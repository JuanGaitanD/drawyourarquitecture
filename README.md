# DYA (Draw your Architecture)

App web de código abierto para tomar notas y dibujar diagramas en un solo lugar. Tiene dos tipos de proyecto:

- **Nota**: pizarra libre sobre [Excalidraw](https://github.com/excalidraw/excalidraw). Puede incrustar diagramas propios.
- **Diagrama**: lienzo estructurado sobre [React Flow](https://reactflow.dev) con formas, conectores, frames, stickies, iconos y autolayout.

Sitio: https://dya.juandgaitan.com

## Qué hace

- Autoguardado con control de versión: si otra pestaña guardó antes, ofrece recargar o guardar una copia.
- Carpetas anidadas para organizar los proyectos en el panel.
- Enlaces públicos de solo lectura.
- Invitaciones como editor o lector, con edición, presencia y cursores en tiempo real.
- Imágenes optimizadas (hasta 2048 px, WebP) y guardadas en Firestore, sin Storage.
- Diagramas: importar desde Mermaid, autolayout con dagre, plantillas, exportar a PNG y JSON.
- Servidor [MCP](https://modelcontextprotocol.io) para que un agente lea y cree notas y diagramas como tú. Ver [`docs/mcp.md`](docs/mcp.md).

El acceso es con Google. Crean proyectos el dueño de la instancia y las cuentas con correo verificado que él agregue en Ajustes. Cualquier persona puede abrir un enlace público.

## Stack

React 19, TypeScript estricto, Vite, Firebase (Auth, Firestore y Realtime Database para la presencia), Radix UI, zustand, zod, MCP SDK. Despliegue en Vercel. Las versiones están fijadas en `package.json`.

## Arquitectura

Capas con la regla de dependencia `domain ← application ← infrastructure`. Solo `src/app` conecta `infrastructure/firebase`, y ESLint lo hace cumplir.

```
src/
  domain/          modelo y codec, TypeScript puro
  application/     puertos, casos de uso, cola de guardado
  infrastructure/  adaptadores de Firebase
  editors/         note (Excalidraw) y board (React Flow)
  ui/              tokens y primitivas
  app/             rutas y composición
  server/          servidor MCP
```

Más detalle en [`docs/architecture.md`](docs/architecture.md), [`docs/stack.md`](docs/stack.md) y [`docs/plan.md`](docs/plan.md).

## Ejecutarlo en local

Requisitos: Node 24, pnpm 12 (con corepack) y Java 21 para los emuladores de Firebase.

```
pnpm install
pnpm emulators                    # terminal 1: Auth, Firestore y Realtime Database locales
VITE_USE_EMULATORS=1 pnpm dev     # terminal 2
```

Con `VITE_USE_EMULATORS=1` la pantalla de acceso entra con una cuenta de prueba local y no se necesita ningún proyecto de Firebase.

## Usarlo con tu propio proyecto de Firebase

1. Crea un proyecto en Firebase con Authentication (Google) y Firestore. Realtime Database es opcional: sin `VITE_FIREBASE_DATABASE_URL` la presencia queda desactivada.
2. Copia `.env.example` a `.env` y rellena la configuración del SDK web. Esos valores identifican tu proyecto y no dan acceso a los datos; lo protegen las reglas de Firestore.
3. Entra una vez con tu cuenta y copia tu UID de Authentication en `OWNER_UID`.
4. Genera y despliega las reglas: `pnpm rules:render` y `firebase deploy --only firestore:rules`. El `firestore.rules` generado no se versiona.

El servidor MCP necesita además `FIREBASE_SERVICE_ACCOUNT` como variable de entorno del despliegue. Nunca va en el repositorio. Detalle en [`docs/mcp.md`](docs/mcp.md).

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Vite en desarrollo |
| `pnpm lint` | ESLint, incluida la regla de capas |
| `pnpm typecheck` | `tsc -b --noEmit` |
| `pnpm test` | Vitest |
| `pnpm test:rules` | Reglas de Firestore y Realtime Database contra los emuladores |
| `pnpm test:e2e` | Playwright contra los emuladores |
| `pnpm build` | Compilación de producción |

## Contribuir

Los commits siguen Conventional Commits, en español. Antes de abrir un PR corre `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`. Las convenciones del código están en [`AGENTS.md`](AGENTS.md).

## Licencia

[Apache-2.0](LICENSE)
