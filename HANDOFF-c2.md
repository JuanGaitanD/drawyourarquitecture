# HANDOFF-c2 — carril C2 · UI del board

Rama `lane/c2-board-ui` (desde `feat/base`, sin push). Propiedad: `src/editors/board/ui/**` y `model/ops.ts` (+ test).

## Cómo debe montarlos C1 (`BoardEditor`)

Todos los componentes leen el store con `useBoard` y usan `useReactFlow`, así que van **dentro de `<BoardStoreProvider>` y de `<ReactFlowProvider>`**. `useShortcuts(ref)` también: si `BoardEditor` es quien crea el provider, llámalo desde un componente hijo.

```tsx
<BoardStoreProvider store={store}>
  <ReactFlowProvider>
    <div ref={ref} tabIndex={-1} style={{ position: 'relative' /* ocupa el área del lienzo */ }}>
      <ReactFlow ... deleteKeyCode={null} />   {/* los atajos ya borran; ver abajo */}
      <Toolbar />      {/* izquierda, centrada en vertical */}
      <StylePanel />   {/* arriba, centrado; solo existe con selección */}
      <ActionBar />    {/* abajo, centrada */}
      <SearchBox />    {/* arriba a la derecha */}
      <Shortcuts container={ref} />   {/* o useShortcuts(ref) en un hijo del provider */}
    </div>
  </ReactFlowProvider>
</BoardStoreProvider>
```

- Los cuatro componentes **se posicionan solos** (`position: absolute`, `z-index: var(--z-canvas-ui)`); el contenedor debe ser `position: relative` y empezar bajo la cabecera. Si C1 prefiere sus propias ranuras, basta con quitar la posición en `ui/chrome.module.css` (`.bar`) y los `top/left/bottom/right` de cada `*.module.css`.
- El contenedor necesita **`tabIndex={-1}`** (así un clic en el lienzo le da el foco y los atajos solo valen con el editor enfocado, invariante 11). Hay que montar el `BoardMenu` de D fuera o dentro: da igual.
- `useShortcuts` escucha `keydown` en **captura** y hace `stopPropagation` de lo que atiende, de modo que manda sobre los atajos de React Flow (flechas con un nodo enfocado, Supr). Aun así conviene `deleteKeyCode={null}` y no duplicar el borrado. Con un nodo enfocado, React Flow movía 5/20 px con las flechas además de mi movimiento de 1/10 px (comprobado en un harness); la captura lo evita.
- Atajos (lista del plan): V H R O T S F L I · Mod+Z, Mod+Shift+Z/Y · Mod+C/V/X/D · Mod+A · Supr/Retroceso · Mod+G (marco alrededor de la selección) · Mod+L (bloquear; sin selección, desbloquea todo) · Mod+Shift+] / [ · Shift+1 (ajustar) y Shift+2 (a la selección) · Mod+' (cuadrícula) · flechas 1 px, 10 px con Shift (un solo paso de deshacer por pulsación continua) · Mod+F (abre `SearchBox`) · Esc (vuelve a «seleccionar» o deselecciona). `R` y `O` fijan `pendingShape` en rectángulo y elipse.
- `Tool = 'image'` solo se fija desde `Toolbar` (botón «Imagen»): **C1 debe abrir el selector de archivo y crear el nodo** cuando la herramienta sea `image`. Igual con `icon` (usa `pendingIcon`) y `shape` (`pendingShape`).

## Qué asume C2 del store de C1

- `selected` vive en `nodes[i].selected` y `edges[i].selected` (lo mantiene React Flow vía `onNodesChange`).
- `setNodes(fn)` / `replaceAll(nodes, edges)` / `updateEdgeData` son **una** entrada de historial cada uno; la interfaz agrupa en una sola llamada (duplicar y pegar usan `replaceAll`).
- Los cambios de solo-`selected` **no** deben crear paso de historial (el `partialize` con equality por JSON del plan ya lo garantiza); «Seleccionar todo», deseleccionar y la búsqueda dependen de eso.
- `gridOn`, `snapOn`, `pendingShape` y `pendingIcon` se cambian con `store.setState(...)` (el contrato no trae acciones para ellos).
- Historial: `store.temporal.getState().{undo, redo, pastStates, futureStates}` (zundo). `beginGesture`/`endGesture` se usan solo para las flechas.
- El estilo de nodos se cambia con `setNodes` + `ops.patchStyle` (fusiona por nodo), **no** con `updateNodeData(ids, {style})`, que reemplazaría el estilo entero de nodos que difieren.

## Pedidos fuera de mi propiedad (para T5 / C1)

1. **Bloqueados y selección.** El plan dice que `locked` bloquea `selectable`; entonces un nodo bloqueado no se puede volver a seleccionar para desbloquearlo. C2 lo resuelve con «Desbloquear todo (n)» (botón de `ActionBar` y Mod+L sin selección). Si C1 prefiere mantenerlos seleccionables (solo sin arrastrar ni borrar), `ops` ya ignora los bloqueados al alinear/distribuir/mover.
2. `removeSelected` debe respetar `locked` (el `deletable:false` de React Flow lo hace si C1 lo fija) y limpiar las aristas colgantes.
3. `ActionBar` no trae zoom (lo dan los `Controls` de React Flow de C1).
4. `ui/glyphs.tsx` duplica el mapa icono→lucide y los paths de las 14 formas (viñetas de 24 px del toolbar). Si C1 exporta uno, T5 puede unificarlos.

## Extras de `model/ops.ts` (además de la firma del contrato)

`rootsOf`, `nudge`, `patchStyle`, `setLocked`, `selectOnly`. Decisiones: los bloqueados no participan en alinear/distribuir/mover; un padre y su hijo seleccionados juntos se mueven una sola vez (el hijo viaja con el padre); `bringToFront`/`sendToBack` arrastran a los descendientes y `sendToBack` de un hijo lleva a su padre con él; `wrapInFrame` inserta el frame justo antes del primer seleccionado y lo mete en el padre común si lo hay (si no, nivel superior); `duplicate` incluye a los descendientes de lo seleccionado.

## Probado y no probado

- Probado (Vitest): `ops` (47 casos: 6 alineaciones, distribuir x/y, orden Z con padres, frame con padding 32, reparentado, duplicate con remapeo de ids/aristas/parentId, validación contra `validateBoardContent`) y el mapa de atajos + filtro de inputs/contentEditable/IME (43 casos).
- Probado a mano en un harness temporal (no versionado) con un store mínimo y React Flow: selección → paneles, Mod+D (un paso de historial), Mod+Z, flechas (exactas con captura, un paso por pulsación), Mod+F + búsqueda con Enter, Mod+G, relleno desde el Popover, forma desde el submenú de formas.
- **Sin probar en navegador**: menú de alinear/distribuir (cubierto por los tests de `ops`), tema oscuro, `Mod+C/V/X`, Mod+L, y el aspecto (el navegador del entorno no daba capturas). Los estilos usan solo tokens; revisar la apariencia en T5.
- No hay tests de componentes: el entorno de Vitest es `node` y no hay jsdom ni Testing Library (no se añadió ninguna dependencia).
