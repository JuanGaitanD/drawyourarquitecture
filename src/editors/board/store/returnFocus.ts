/**
 * Al terminar de editar un texto con el teclado (Enter o Esc), el campo desaparece y el foco caería en `body`:
 * los atajos (solo valen con el foco dentro del editor, invariante 11) dejarían de responder hasta volver a
 * hacer clic. Devuelve el foco al nodo que se editaba o, si no hay, al contenedor del editor (`tabIndex={-1}`).
 */
export function returnFocus(from: HTMLElement | null): void {
  const target =
    from?.closest<HTMLElement>('.react-flow__node') ?? from?.closest<HTMLElement>('[tabindex="-1"]');
  target?.focus({ preventScroll: true });
}
