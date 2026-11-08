import { useReactFlow, useStore } from '@xyflow/react';
import { useEffect } from 'react';
import { usePresence } from '@/app/hooks';
import styles from './presenceCursors.module.css';

/**
 * Cursores de las demás personas en el board. Viajan en coordenadas de flujo (independientes del zoom y del
 * desplazamiento de cada quien) y aquí se proyectan a pantalla con la transformación de React Flow. El propio
 * puntero se publica desde el contenedor del lienzo. Va dentro de `ReactFlowProvider`, dentro del escenario.
 */
export function BoardCursors({ projectId }: { projectId: string }) {
  const { others, move } = usePresence(projectId);
  const { screenToFlowPosition } = useReactFlow();
  const domNode = useStore((s) => s.domNode);
  const [tx, ty, zoom] = useStore((s) => s.transform);

  useEffect(() => {
    if (!domNode) return;
    const onMove = (e: PointerEvent) => {
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      move(p.x, p.y);
    };
    domNode.addEventListener('pointermove', onMove);
    return () => domNode.removeEventListener('pointermove', onMove);
  }, [domNode, screenToFlowPosition, move]);

  return (
    <div className={styles.layer} aria-hidden="true" data-testid="board-cursors">
      {others.map((p) =>
        p.x === undefined || p.y === undefined ? null : (
          <div
            key={p.uid}
            className={styles.cursor}
            data-cursor={p.uid}
            style={{ transform: `translate(${p.x * zoom + tx}px, ${p.y * zoom + ty}px)`, color: p.color }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" className={styles.arrow}>
              <path
                d="M1 1l5.5 13 2-5.2L14 6.8z"
                fill="currentColor"
                stroke="#fff"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span className={styles.label} style={{ background: p.color }}>
              {p.name || 'Alguien'}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
