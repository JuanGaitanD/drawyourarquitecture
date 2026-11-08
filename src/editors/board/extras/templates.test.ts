import { describe, expect, it } from 'vitest';
import { validateBoardContent } from '../model/validate';
import { toFlowchart, parseFlowchart } from '../model/mermaid';
import { instantiateTemplate, TEMPLATES } from './templates';

describe('plantillas', () => {
  it('son las tres pedidas, con nombre y descripción', () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(['Web de 3 capas', 'C4 · Contexto', 'Event-driven']);
    for (const t of TEMPLATES) expect(t.description.length).toBeGreaterThan(20);
  });

  it.each(TEMPLATES.map((t) => [t.name, t] as const))(
    '«%s» pasa validateBoardContent y tiene contenido real',
    (_n, t) => {
      const v = validateBoardContent(t.raw);
      if (!v.ok) throw new Error(v.error);
      expect(v.value.nodes.filter((n) => n.data.kind !== 'text').length).toBeGreaterThanOrEqual(7);
      expect(v.value.edges.length).toBeGreaterThanOrEqual(6);
      expect(v.value.nodes.some((n) => n.data.kind === 'frame')).toBe(true);
    },
  );

  it.each(TEMPLATES.map((t) => [t.name, t] as const))(
    '«%s» exporta a Mermaid y se vuelve a importar',
    (_n, t) => {
      const c = instantiateTemplate(t);
      const back = parseFlowchart(toFlowchart(c));
      expect(back.ok).toBe(true);
    },
  );

  it('instantiateTemplate da ids nuevos cada vez y conserva la estructura', () => {
    const t = TEMPLATES[0];
    if (!t) throw new Error('sin plantillas');
    const a = instantiateTemplate(t);
    const b = instantiateTemplate(t);
    const ids = new Set([...a.nodes, ...b.nodes].map((n) => n.id));
    expect(ids.size).toBe(a.nodes.length * 2);
    expect(validateBoardContent(a).ok).toBe(true);
    expect(a.edges).toHaveLength(b.edges.length);
    expect(a.nodes.filter((n) => n.parentId)).toHaveLength(b.nodes.filter((n) => n.parentId).length);
  });

  it('una plantilla rota se rechaza con un error claro', () => {
    expect(() =>
      instantiateTemplate({ id: 'x', name: 'Rota', description: '', raw: { schemaVersion: 2 } }),
    ).toThrow(/Rota/);
  });

  // D16: un texto suelto tiene alto automático y ancho fijo; si el ancho no cabe, el título se parte en dos líneas.
  it.each(TEMPLATES.map((t) => [t.name, t] as const))('«%s»: los textos sueltos caben en una línea', (_n, t) => {
    for (const n of instantiateTemplate(t).nodes.filter((x) => x.data.kind === 'text')) {
      const longest = Math.max(...n.data.label.split(/\r?\n/).map((l) => l.length));
      const estimated = longest * n.data.style.fontSize * 0.62 + 16; // media de una sans en negrita + relleno
      expect(n.width ?? 0, n.data.label).toBeGreaterThanOrEqual(estimated);
    }
  });
});
