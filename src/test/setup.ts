// Preparación común de Vitest. Solo actúa en jsdom (pruebas de componentes con `// @vitest-environment jsdom`):
// jsdom no trae lo que usan Radix y React Flow, y Testing Library no se limpia sola sin `globals`.
import { afterEach } from 'vitest';

if (typeof window !== 'undefined') {
  const g = globalThis as Record<string, unknown>;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  g.DOMMatrixReadOnly ??= class {
    m22 = 1;
  };
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  // Radix usa la captura de puntero y `scrollIntoView` al abrir menús y popovers.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;

  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);
}
