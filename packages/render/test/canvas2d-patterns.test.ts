// User hatch patterns (M1-50): .pat files the user adds join the renderer's pattern library
// ahead of the bundled set, so a hatch stored without its pattern lines draws from them, both
// when the renderer is made with them and when they arrive while a drawing is open.
import type { HatchGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type Canvas2DRendererOptions } from '../src/index';
import { drawing, entity, MODEL, surface } from './fixtures';

const STYLE = { background: '#000000', foreground: '#ffffff', showLineweights: false };

/** Horizontal lines 1 apart, then (as a second file) vertical ones 1 apart. */
const HORIZONTAL = '*MY_LINES, user lines\n0, 0,0, 0,1\n';
const VERTICAL = '*my_lines, the same name in another case\n90, 0,0, 0,1\n';

/** A predefined/custom pattern hatch over (0,0)–(4,4) that stores no pattern lines. */
const hatch = (pattern: string): HatchGeometry => ({
  kind: 'HATCH',
  pattern,
  solid: false,
  associative: false,
  style: 0,
  patternType: 2,
  patternAngle: 0,
  patternScale: 1,
  double: false,
  seedPoints: [],
  loops: [
    {
      flags: 2,
      polyline: {
        closed: true,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 4, y: 0, bulge: 0 },
          { x: 4, y: 4, bulge: 0 },
          { x: 0, y: 4, bulge: 0 },
        ],
      },
    },
  ],
  patternLines: [],
});

function setup(pattern: string, patterns?: Canvas2DRendererOptions['patterns']) {
  const d = drawing([entity('20', hatch(pattern))]);
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index: d.index,
    block: MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: STYLE,
    requestIdle: () => {},
    ...(patterns ? { patterns } : {}),
  });
  r.resize(100, 100, 1);
  r.setView({ center: { x: 2, y: 2 }, scale: 20 });
  const scene = layers[0]!;
  const draw = () => {
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  return { r, draw };
}

/** The line segments of the scene's strokes, as [x0, y0, x1, y1] in screen pixels. */
function segments(c: ReturnType<ReturnType<typeof setup>['draw']>): number[][] {
  const out: number[][] = [];
  let from: number[] | undefined;
  for (const [name, ...args] of c.calls) {
    if (name === 'moveTo') from = args as number[];
    if (name === 'lineTo' && from) {
      out.push([...from, ...(args as number[])].map((v) => Math.round(v)));
      from = args as number[];
    }
  }
  return out;
}
const horizontal = (s: number[][]) => s.length > 0 && s.every(([, y0, , y1]) => y0 === y1);
const vertical = (s: number[][]) => s.length > 0 && s.every(([x0, , x1]) => x0 === x1);

describe('user hatch patterns (M1-50)', () => {
  it('draws nothing for a pattern no library holds', () => {
    const { draw } = setup('MY_LINES');
    expect(draw().named('stroke')).toHaveLength(0);
  });

  it('draws a hatch stored without lines from a user .pat the renderer was made with', () => {
    const { draw } = setup('MY_LINES', [HORIZONTAL]);
    const c = draw();
    expect(c.named('stroke')).toHaveLength(1);
    expect(horizontal(segments(c))).toBe(true);
  });

  it('redraws open hatches when the user patterns change, later files winning by name', () => {
    const { r, draw } = setup('MY_LINES');
    draw();
    r.setPatterns([HORIZONTAL]);
    expect(horizontal(segments(draw()))).toBe(true);
    r.setPatterns([HORIZONTAL, VERTICAL]);
    expect(vertical(segments(draw()))).toBe(true);
    r.setPatterns([]);
    expect(draw().named('stroke')).toHaveLength(0);
  });

  it('puts user patterns ahead of a bundled pattern of the same name', () => {
    // TRIYA_LINES0 is bundled as horizontal lines; the user's file redefines it.
    const { draw } = setup('TRIYA_LINES0', ['*TRIYA_LINES0, mine\n90, 0,0, 0,1\n']);
    expect(vertical(segments(draw()))).toBe(true);
  });

  it('skips a source that holds no patterns', () => {
    const { draw } = setup('MY_LINES', ['not a pattern file', HORIZONTAL]);
    expect(horizontal(segments(draw()))).toBe(true);
  });
});
