# Arquitectura — drawyourarquitecture

Contratos, invariantes y modelo de datos: `docs/plan.md` (fuente única). Stack y estructura: `docs/stack.md`.

```mermaid
flowchart LR
  subgraph Browser["Navegador · SPA Vite 8 + React 19"]
    direction TB
    subgraph app["app/ — rutas, shell, hooks, composición"]
      Router["wouter: / · /note/:id · /board/:id · /view/:type/:id · /embed/board/:id"]
      Dash["dashboard/"]
      Viewer["viewer/"]
    end
    subgraph editors["editors/"]
      Note["note/<br/>NoteCanvas (Excalidraw) · BoardEmbed"]
      Board["board/<br/>model · store por instancia · canvas React Flow · ui · extras"]
    end
    UI["ui/ — tokens, tema, primitivas Radix"]
    subgraph application["application/ — puertos y casos de uso"]
      Ports["ProjectRepo · ContentRepo · FileStore · Identity"]
      Save["saveQueue (debounce · revisión · borrador)"]
    end
    Domain["domain/ — Project · codec"]
    Infra["infrastructure/firebase/ — único que importa el SDK"]
    app --> editors
    app --> application
    app --> Infra
    editors --> application
    editors --> UI
    app --> UI
    application --> Domain
    Infra --> application
    Note -. "renderEmbeddable → BoardViewer (sin iframe)" .-> Board
  end
  subgraph Firebase["Firebase (plan Blaze)"]
    FAuth["Auth · Google · solo OWNER_UID escribe"]
    FS[("Firestore<br/>projects/{id}<br/>projects/{id}/content/main {data, schemaVersion, revision}")]
    ST[("Storage<br/>projects/{id}/files/{fileId}")]
  end
  Vercel["Vercel Pro · estáticos + rewrites"] --> Browser
  Infra --> FAuth
  Infra --> FS
  Infra --> ST
```

## Regla de dependencia
`domain ← application ← infrastructure`; `editors` y `app` consumen `application`/`domain`; solo `app/` conecta las implementaciones (`app/services.ts`). La regla la impone ESLint (`no-restricted-imports`).

SOLID sin ceremonia:
- **S**: repo de proyectos ≠ repo de contenido ≠ archivos ≠ cola de guardado ≠ editor.
- **O**: los nodos se registran en `nodeTypes`; un tipo nuevo no toca el canvas.
- **L/I**: puertos pequeños (`ContentRepo` = `load` + `save` con revisión esperada).
- **D**: editores y pantallas dependen de puertos; Firebase se inyecta desde `app/`. En la fase 2, la colaboración en tiempo real se monta como otra implementación del puerto de contenido (por ejemplo, Yjs), sin tocar los editores.

## Seguridad
- Solo el `OWNER_UID` crea y escribe. Lo público se lee con `get`, nunca con `list`. `ownerId` y `type` son inmutables, los campos van en lista cerrada y la `revision` es monótona.
- Storage: lectura cruzada con Firestore (dueño o público); solo imágenes rasterizadas de hasta 4 MiB; la descarga se hace con `getBlob`, sin URLs con token.
- Si una nota pública incrusta un board privado, el embed muestra «Diagrama privado».

## Embed de board en nota
`validateEmbeddable` devuelve `true` solo para el mismo origen con `/embed/board/<id>`. `renderEmbeddable` pinta `<BoardEmbed/>` con `BoardViewer` de solo lectura y un store propio. Se descarta el iframe porque el sandbox de Excalidraw dejaría el board sin sesión. Los boards no incrustan notas, así que no hay ciclos.
