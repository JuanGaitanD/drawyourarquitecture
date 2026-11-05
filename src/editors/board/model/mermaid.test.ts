import { describe, expect, it } from 'vitest';
import { emptyBoard, makeNode, type BoardContent } from './board';
import { fixtureBoard } from './fixtures';
import { parseFlowchart, toFlowchart } from './mermaid';
import { validateBoardContent } from './validate';

const ok = (src: string) => {
  const r = parseFlowchart(src);
  if (!r.ok) throw new Error(`esperaba éxito: ${r.error}`);
  return r;
};
const fail = (src: string) => {
  const r = parseFlowchart(src);
  if (r.ok) throw new Error('esperaba error');
  return r;
};
const byLabel = (c: BoardContent, label: string) => {
  const n = c.nodes.find((x) => x.data.label === label);
  if (!n) throw new Error(`no hay nodo «${label}»`);
  return n;
};

describe('parseFlowchart · directiva', () => {
  it.each([
    ['flowchart TD', 'TB'],
    ['flowchart TB', 'TB'],
    ['flowchart BT', 'TB'],
    ['graph LR', 'LR'],
    ['graph RL', 'LR'],
    ['flowchart', 'TB'],
    ['graph td;', 'TB'],
  ])('«%s» → %s', (head, dir) => {
    expect(ok(`${head}\nA --> B`).direction).toBe(dir);
  });

  it('rechaza una dirección desconocida con su línea', () => {
    const r = fail('\n\nflowchart XX\nA-->B');
    expect(r.line).toBe(3);
    expect(r.error).toMatch(/^Línea 3:.*dirección no válida/);
  });

  it('rechaza texto sin directiva y texto vacío', () => {
    expect(fail('A --> B').error).toMatch(/Línea 1: se esperaba «flowchart»/);
    expect(fail('  \n%% solo un comentario').error).toMatch(/vacío/);
  });
});

describe('parseFlowchart · nodos', () => {
  const shapeOf = (src: string) => byLabel(ok(`flowchart LR\n${src}`).value, 'Texto').data.shape;
  it.each([
    ['A[Texto]', 'rectangle'],
    ['A(Texto)', 'round_rectangle'],
    ['A([Texto])', 'terminator'],
    ['A{Texto}', 'rhombus'],
    ['A((Texto))', 'ellipse'],
    ['A[(Texto)]', 'cylinder'],
    ['A{{Texto}}', 'hexagon'],
    ['A[/Texto/]', 'parallelogram'],
  ])('%s → %s', (src, shape) => {
    expect(shapeOf(src)).toBe(shape);
  });

  it('un id suelto usa el id como texto', () => {
    const { value } = ok('flowchart LR\nCliente --> Servidor');
    expect(value.nodes.map((n) => n.data.label)).toEqual(['Cliente', 'Servidor']);
    expect(value.nodes.every((n) => n.data.shape === 'rectangle')).toBe(true);
  });

  it('redeclarar con texto actualiza etiqueta y forma sin duplicar el nodo', () => {
    const { value } = ok('flowchart LR\nA --> B\nA{Decide}');
    expect(value.nodes).toHaveLength(2);
    expect(byLabel(value, 'Decide').data.shape).toBe('rhombus');
  });

  it('admite texto entre comillas con delimitadores dentro, <br/> y #quot;', () => {
    const { value } = ok('flowchart LR\nA["Hola (mundo) [x]<br/>línea #quot;2#quot;"]');
    expect(value.nodes[0]?.data.label).toBe('Hola (mundo) [x]\nlínea "2"');
  });

  it('admite espacios y acentos en el texto, e ids con acentos', () => {
    const { value } = ok('flowchart LR\nñandú[Base de datos ñ]');
    expect(value.nodes[0]?.data.label).toBe('Base de datos ñ');
  });

  it('construye con makeNode: type = kind, tamaño y estilo por defecto', () => {
    const { value } = ok('flowchart LR\nA[x]');
    const ref = makeNode('shape', { x: 0, y: 0 });
    const n = value.nodes[0];
    expect(n?.type).toBe('shape');
    expect(n?.data.kind).toBe('shape');
    expect({ width: n?.width, height: n?.height }).toEqual({ width: ref.width, height: ref.height });
    expect(n?.data.style).toEqual(ref.data.style);
  });

  it('el contenido pasa validateBoardContent', () => {
    const { value } = ok('flowchart LR\nA --> B --> C\nsubgraph s[S]\n D\nend');
    expect(validateBoardContent(value).ok).toBe(true);
  });

  it('errores: delimitador sin cerrar, comillas sin cerrar, id ausente', () => {
    expect(fail('flowchart LR\nA[sin cerrar').error).toMatch(/Línea 2: falta «\]»/);
    expect(fail('flowchart LR\nA["abierta]').error).toMatch(/Línea 2: comillas sin cerrar/);
    expect(fail('flowchart LR\nA --> ').error).toMatch(/Línea 2/);
    expect(fail('flowchart LR\n[solo texto]').error).toMatch(/Línea 2: se esperaba un nodo/);
  });
});

describe('parseFlowchart · aristas', () => {
  const edge = (arrow: string) => ok(`flowchart LR\nA ${arrow} B`).value.edges[0];

  it('--> flecha sólida', () => {
    expect(edge('-->')?.data).toMatchObject({ markerEnd: true, dashed: false, width: 2 });
  });
  it('--- sin flecha', () => {
    expect(edge('---')?.data).toMatchObject({ markerEnd: false, dashed: false });
  });
  it('-.-> punteada con flecha y -.- punteada sin flecha', () => {
    expect(edge('-.->')?.data).toMatchObject({ markerEnd: true, dashed: true });
    expect(edge('-.-')?.data).toMatchObject({ markerEnd: false, dashed: true });
  });
  it('==> gruesa y === gruesa sin flecha', () => {
    expect(edge('==>')?.data).toMatchObject({ markerEnd: true, width: 4 });
    expect(edge('===')?.data).toMatchObject({ markerEnd: false, width: 4 });
  });
  it('-->|t| etiqueta (con y sin espacios, y entre comillas)', () => {
    expect(edge('-->|SQL|')?.data?.label).toBe('SQL');
    expect(edge('--> |con espacios|')?.data?.label).toBe('con espacios');
    expect(edge('-->|"entre comillas"|')?.data?.label).toBe('entre comillas');
  });
  it('-- t --> etiqueta en medio; también -. t .-> y == t ==>', () => {
    expect(edge('-- HTTPS -->')?.data).toMatchObject({ label: 'HTTPS', markerEnd: true });
    expect(edge('-- sin flecha ---')?.data).toMatchObject({ label: 'sin flecha', markerEnd: false });
    expect(edge('-. opcional .->')?.data).toMatchObject({ label: 'opcional', dashed: true });
    expect(edge('== crítico ==>')?.data).toMatchObject({ label: 'crítico', width: 4 });
  });
  it('sin espacios: A-->B', () => {
    const { value } = ok('flowchart LR\nA-->B');
    expect(value.edges).toHaveLength(1);
    expect(value.nodes.map((n) => n.data.label)).toEqual(['A', 'B']);
  });
  it('cadenas: A --> B --> C produce dos aristas encadenadas, con etiquetas mixtas', () => {
    const { value } = ok('flowchart LR\nA[a] -->|x| B[b] -- y --> C[c] -.-> D');
    expect(value.edges).toHaveLength(3);
    const id = (l: string) => byLabel(value, l).id;
    expect(value.edges.map((e) => [e.source, e.target])).toEqual([
      [id('a'), id('b')],
      [id('b'), id('c')],
      [id('c'), id('D')],
    ]);
    expect(value.edges.map((e) => e.data?.label)).toEqual(['x', 'y', undefined]);
  });
  it('construye con makeEdge: type labeled, path bezier y asas por defecto', () => {
    const e = edge('-->');
    expect(e).toMatchObject({ type: 'labeled', sourceHandle: 'r', targetHandle: 'l' });
    expect(e?.data?.path).toBe('bezier');
  });
  it('varias sentencias en una línea con `;`', () => {
    const { value } = ok('flowchart LR; A-->B; B-->C;');
    expect(value.edges).toHaveLength(2);
  });
  it('un `;` dentro de comillas no parte la sentencia', () => {
    const { value } = ok('flowchart LR\nA["a;b"] --> B');
    expect(byLabel(value, 'a;b')).toBeTruthy();
  });
  it('errores: flecha sin destino, texto suelto y `&`', () => {
    expect(fail('flowchart LR\nA --> B\nA ~~~ B').error).toMatch(/Línea 3: no se entiende/);
    expect(fail('flowchart LR\nA & B --> C').error).toMatch(/Línea 2: «&»/);
    expect(fail('flowchart LR\nA -->|x B').error).toMatch(/Línea 2/);
  });
});

describe('parseFlowchart · subgraph, comentarios y estilos', () => {
  const src = [
    'flowchart TB',
    '%% comentario',
    'U((Usuario)) --> API',
    'subgraph back [Backend]',
    '  API(API)',
    '  subgraph datos ["Datos"]',
    '    DB[(DB)]',
    '  end',
    '  API --> DB',
    'end',
    'U --> back',
  ].join('\n');

  it('subgraph → frame; los nodos de dentro llevan parentId; anidado', () => {
    const { value } = ok(src);
    const back = byLabel(value, 'Backend');
    const datos = byLabel(value, 'Datos');
    expect(back.data.kind).toBe('frame');
    expect(back.type).toBe('frame');
    expect(datos.parentId).toBe(back.id);
    expect(byLabel(value, 'API').parentId).toBe(back.id);
    expect(byLabel(value, 'DB').parentId).toBe(datos.id);
    expect(byLabel(value, 'Usuario').parentId).toBeUndefined();
  });

  it('los padres van antes que sus hijos en el array', () => {
    const { value } = ok(src);
    const order = value.nodes.map((n) => n.data.label);
    expect(order.indexOf('Backend')).toBeLessThan(order.indexOf('Datos'));
    expect(order.indexOf('Datos')).toBeLessThan(order.indexOf('DB'));
  });

  it('un nodo nombrado antes fuera y luego dentro de un subgraph pasa a pertenecerle, sin duplicarse', () => {
    const { value } = ok(src);
    expect(value.nodes.filter((n) => n.data.label === 'API')).toHaveLength(1);
  });

  it('nombrar un nodo fuera después no lo saca del subgraph', () => {
    const { value } = ok(['flowchart LR', 'subgraph s', 'A', 'end', 'A --> B'].join('\n'));
    expect(byLabel(value, 'A').parentId).toBe(byLabel(value, 's').id);
    expect(byLabel(value, 'B').parentId).toBeUndefined();
  });

  it('un subgraph vale como extremo de arista', () => {
    const { value } = ok(src);
    const back = byLabel(value, 'Backend');
    expect(value.edges.some((e) => e.target === back.id)).toBe(true);
    expect(validateBoardContent(value).ok).toBe(true);
  });

  it('subgraph sin corchetes: id = título (una palabra) o título con espacios', () => {
    const a = ok('flowchart LR\nsubgraph Red\nX\nend');
    expect(a.value.nodes[0]?.data.label).toBe('Red');
    const b = ok('flowchart LR\nsubgraph Mi red privada\nX\nend');
    expect(b.value.nodes[0]?.data.label).toBe('Mi red privada');
    expect(b.value.nodes[1]?.parentId).toBe(b.value.nodes[0]?.id);
  });

  it('ignora comentarios %%, direction y style/classDef/class/linkStyle/click', () => {
    const { value } = ok(
      [
        'flowchart LR',
        '%% nota',
        'A --> B',
        'style A fill:#f00',
        'classDef c fill:#fff',
        'class A c',
        'linkStyle 0 stroke:#000',
        'click A callback',
        'subgraph s',
        '  direction TB',
        '  C',
        'end',
      ].join('\n'),
    );
    expect(value.nodes).toHaveLength(4);
  });

  it('acepta CRLF y BOM', () => {
    const { value } = ok('﻿flowchart LR\r\nA --> B\r\n');
    expect(value.edges).toHaveLength(1);
  });

  it('errores con línea: end sobrante, subgraph sin end, subgraph sin nombre, id repetido', () => {
    expect(fail('flowchart LR\nA\nend').error).toMatch(/^Línea 3: «end» sin subgraph/);
    const unclosed = fail('flowchart LR\nsubgraph s\nA');
    expect(unclosed.line).toBe(2);
    expect(unclosed.error).toMatch(/Línea 2: subgraph sin «end»/);
    expect(fail('flowchart LR\nsubgraph').error).toMatch(/Línea 2: subgraph sin nombre/);
    expect(fail('flowchart LR\nA\nsubgraph A\nend').error).toMatch(/Línea 3: el id «A» ya existe/);
  });

  it('el límite de nodos de validateBoardContent se propaga como error', () => {
    const many = ['flowchart LR', ...Array.from({ length: 5001 }, (_, i) => `n${i}`)].join('\n');
    const r = fail(many);
    expect(r.error).toMatch(/Demasiados nodos/);
  });
});

describe('toFlowchart', () => {
  it('exporta el fixture con subgraph, formas y etiquetas', () => {
    const text = toFlowchart(fixtureBoard(), 'LR');
    expect(text.startsWith('flowchart LR\n')).toBe(true);
    expect(text).toContain('subgraph frame["Backend"]');
    expect(text).toContain('api(API)');
    expect(text).toContain('db[(Base de datos)]');
    expect(text).toContain('user -->|HTTPS| api');
    expect(text).toContain('api -.-> db');
    expect(text).toMatch(/\n {2}end\n/);
  });

  it('usa la dirección pedida', () => {
    expect(toFlowchart(emptyBoard(), 'TB').split('\n')[0]).toBe('flowchart TB');
  });

  it('ids no válidos o reservados pasan a n1, n2…; etiqueta vacía = solo id', () => {
    const a = makeNode('shape', { x: 0, y: 0 }, { label: 'Uno' });
    const b = makeNode('shape', { x: 0, y: 0 }, { label: '' });
    const e = { ...makeNode('shape', { x: 0, y: 0 }, { label: 'Fin' }), id: 'end' };
    const text = toFlowchart({ ...emptyBoard(), nodes: [{ ...a, id: 'a-b' }, { ...b, id: 'x1' }, e] });
    expect(text).toContain('n1[Uno]');
    expect(text).toContain('\n  x1\n');
    expect(text).toContain('n3[Fin]');
  });

  it('escapa comillas y saltos de línea y no rompe con `|` en etiquetas de arista', () => {
    const a = { ...makeNode('shape', { x: 0, y: 0 }, { label: 'dice "hola"\nmundo' }), id: 'a' };
    const b = { ...makeNode('shape', { x: 0, y: 0 }, { label: 'B' }), id: 'b' };
    const content: BoardContent = {
      ...emptyBoard(),
      nodes: [a, b],
      edges: [
        {
          id: 'e',
          type: 'labeled',
          source: 'a',
          target: 'b',
          data: {
            path: 'bezier',
            markerStart: false,
            markerEnd: true,
            dashed: false,
            color: '#000',
            width: 2,
            label: 'x|y',
          },
        },
      ],
    };
    const text = toFlowchart(content);
    expect(text).toContain('a["dice #quot;hola#quot;<br/>mundo"]');
    const back = ok(text).value;
    expect(byLabel(back, 'dice "hola"\nmundo')).toBeTruthy();
    expect(back.edges[0]?.data?.label).toBe('x/y');
  });

  it('formas sin equivalente (triángulo…) salen como rectángulo; clases sin forma (sticky, icono) también', () => {
    const t = makeNode('shape', { x: 0, y: 0 }, { label: 'T', shape: 'triangle' });
    const s = makeNode('sticky', { x: 0, y: 0 }, { label: 'S' });
    const text = toFlowchart({
      ...emptyBoard(),
      nodes: [
        { ...t, id: 't' },
        { ...s, id: 's' },
      ],
    });
    expect(text).toContain('t[T]');
    expect(text).toContain('s[S]');
  });
});

describe('round-trip con el fixture', () => {
  it('parse(toFlowchart(fixture)) conserva etiquetas, formas, jerarquía y aristas', () => {
    const src = fixtureBoard();
    const { value, direction } = ok(toFlowchart(src, 'TB'));
    expect(direction).toBe('TB');
    expect(validateBoardContent(value).ok).toBe(true);

    const idOf = (c: BoardContent, label: string) => byLabel(c, label).id;
    expect(value.nodes).toHaveLength(src.nodes.length);
    expect(new Set(value.nodes.map((n) => n.data.label))).toEqual(
      new Set(src.nodes.map((n) => n.data.label)),
    );

    // Formas: las que Mermaid sabe expresar se conservan.
    expect(byLabel(value, 'API').data.shape).toBe('round_rectangle');
    expect(byLabel(value, 'Base de datos').data.shape).toBe('cylinder');
    expect(byLabel(value, 'Backend').data.kind).toBe('frame');

    // Jerarquía
    expect(byLabel(value, 'API').parentId).toBe(idOf(value, 'Backend'));
    expect(byLabel(value, 'Base de datos').parentId).toBe(idOf(value, 'Backend'));
    expect(byLabel(value, 'Usuario').parentId).toBeUndefined();

    // Aristas: mismos extremos (por etiqueta), etiqueta y estilo
    const shape = (c: BoardContent) => {
      const label = new Map(c.nodes.map((n) => [n.id, n.data.label]));
      return c.edges
        .map((e) => `${label.get(e.source)}>${label.get(e.target)}|${e.data?.label ?? ''}|${e.data?.dashed}`)
        .sort();
    };
    expect(shape(value)).toEqual(shape(src));
  });

  it('exportar de nuevo el resultado del parseo repite el texto (salvo los ids)', () => {
    const src = fixtureBoard();
    const t1 = toFlowchart(src, 'LR');
    const back = ok(t1).value;
    // Se sustituye cada id por el índice de su nodo; el orden de nodos coincide con el del fixture.
    const norm = (text: string, ids: string[]) =>
      ids.reduce((t, id, i) => t.replace(new RegExp(`(?<![\\w-])${id}(?![\\w-])`, 'g'), `#${i}`), text);
    const t2 = norm(
      toFlowchart(back, 'LR'),
      back.nodes.map((n) => n.id),
    ).replace(/(?<![\w#-])n(\d+)(?![\w-])/g, (_, k: string) => `#${Number(k) - 1}`);
    expect(t2).toBe(
      norm(
        t1,
        src.nodes.map((n) => n.id),
      ),
    );
  });
});
