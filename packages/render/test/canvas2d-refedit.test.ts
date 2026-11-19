// M5-02 part 5: a reference edited in place (REFEDIT) as the canvas shows it, as AutoCAD 2024 does
// (AutoCAD Help, "REFEDIT (Command)", "XFADECTL (System Variable)"):
//
// - every object not in the working set draws faded by XFADECTL (0 to 90, initially 50; 0 does
//   not fade), the rest of the edited reference and every other object of the drawing alike;
// - the working set is out of the block while it is edited (Triya carries it into the space), but
//   every other reference to the block, here or nested in another block, still draws the whole
//   definition as it was until REFCLOSE saves it; the reference edited draws only the rest.
//
// The display may reach a render worker before or after the change that carried the working set
// out (two message channels): either way the canvas ends showing the same.
import type { ChangeSet, Entity, EntityGeometry, EntityInit } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RefEditDisplay, type RenderStyle } from '../src/index';
import {
  change,
  drawing,
  entity,
  line,
  MODEL,
  surface,
  type Call,
  type FakeContext,
} from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const B = '40';
const P = '41';
const RED = { kind: 'aci', index: 1 } as const;
const GREEN = { kind: 'aci', index: 3 } as const;
const BLUE = { kind: 'aci', index: 5 } as const;

const insertOf = (block: string, x = 0, y = 0): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x, y },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

/**
 * Block B holds a red line (30, the one edited) and a green one (31); model space references it
 * twice (20 at 0,0 and 21 at 5,0) and has a blue line of its own (22). Block P holds a reference
 * to B (32), and model space references P once (23 at 0,3) when `nested`.
 */
function setup(o: { nested?: boolean; style?: RenderStyle } = {}) {
  const entities: EntityInit[] = [
    entity('30', line(0, 0, 1, 0), { owner: B, color: RED }),
    entity('31', line(0, 0.5, 1, 0.5), { owner: B, color: GREEN }),
    entity('20', insertOf(B, 0)),
    entity('21', insertOf(B, 5)),
    entity('22', line(0, 2, 10, 2), { color: BLUE }),
  ];
  if (o.nested) {
    entities.push(entity('32', insertOf(B, 0), { owner: P }));
    entities.push(entity('23', insertOf(P, 0, 3)));
  }
  const d = drawing(entities, {
    blocks: [{ handle: B, name: 'B' }, ...(o.nested ? [{ handle: P, name: 'P' }] : [])],
  });
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    now: () => 0,
    model: d.model,
    index: d.index,
    block: MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: o.style ?? DARK,
    requestIdle: () => {},
  });
  r.resize(200, 100, 1);
  r.setView({ center: { x: 5, y: 2 }, scale: 10 });
  const scene = layers[0]!;
  const redraw = () => {
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  const id = (h: string) => d.model.ids.idOf(h)!;
  /**
   * REFEDIT of the reference path `path` (handles): the red line carried out into model space,
   * and the display the engine sends with it.
   */
  const refedit = (
    path: readonly string[],
    out: readonly string[] = ['30'],
  ): { cs: ChangeSet; display: RefEditDisplay } => {
    const order = [...d.model.blockEntities(B)];
    const held: Entity[] = out.map((h) => d.model.entity(id(h))!);
    const cs = change(d, (b) => {
      for (const h of out) b.moveEntity(id(h), MODEL);
    });
    return {
      cs,
      display: { block: B, path: path.map(id), order, held, working: out.map(id) },
    };
  };
  return { d, r, redraw, id, refedit };
}

/** How many path pieces were stroked in each colour at each alpha, as "colour@alpha". */
function pieces(c: FakeContext): Record<string, number> {
  const out: Record<string, number> = {};
  let alpha = 1;
  let stroke = '';
  let moves = 0;
  for (const call of c.calls as Call[]) {
    const [name, v] = call;
    if (name === 'globalAlpha') alpha = v as number;
    else if (name === 'strokeStyle') stroke = String(v);
    else if (name === 'beginPath') moves = 0;
    else if (name === 'moveTo') moves += 1;
    else if (name === 'stroke') {
      const key = `${stroke}@${Math.round(alpha * 100) / 100}`;
      out[key] = (out[key] ?? 0) + moves;
      moves = 0;
    }
  }
  return out;
}

const RED_HEX = '#ff0000';
const GREEN_HEX = '#00ff00';
const BLUE_HEX = '#0000ff';

describe('a reference edited in place (M5-02 part 5)', () => {
  it('draws everything in full before the edit', () => {
    const { redraw } = setup();
    expect(pieces(redraw())).toEqual({
      [`${RED_HEX}@1`]: 2,
      [`${GREEN_HEX}@1`]: 2,
      [`${BLUE_HEX}@1`]: 1,
    });
  });

  it('fades what is not in the working set; the other reference draws the whole block', () => {
    const { r, redraw, refedit } = setup();
    const { cs, display } = refedit(['20']);
    r.apply(cs);
    r.setRefEdit(display);
    expect(pieces(redraw())).toEqual({
      // The working set, in model space now, in full; the other reference's red line faded.
      [`${RED_HEX}@1`]: 1,
      [`${RED_HEX}@0.5`]: 1,
      // The rest of the edited reference and the whole of the other one, faded.
      [`${GREEN_HEX}@0.5`]: 2,
      [`${BLUE_HEX}@0.5`]: 1,
    });
  });

  it('ends the same when the display comes before the change', () => {
    const { r, redraw, refedit } = setup();
    const { cs, display } = refedit(['20']);
    r.setRefEdit(display);
    r.apply(cs);
    expect(pieces(redraw())).toEqual({
      [`${RED_HEX}@1`]: 1,
      [`${RED_HEX}@0.5`]: 1,
      [`${GREEN_HEX}@0.5`]: 2,
      [`${BLUE_HEX}@0.5`]: 1,
    });
  });

  it('draws the other reference when the whole block went out, though the index finds nothing', () => {
    const { r, redraw, refedit } = setup();
    const { cs, display } = refedit(['20'], ['30', '31']);
    r.apply(cs);
    r.setRefEdit(display);
    expect(pieces(redraw())).toEqual({
      [`${RED_HEX}@1`]: 1,
      [`${RED_HEX}@0.5`]: 1,
      [`${GREEN_HEX}@1`]: 1,
      [`${GREEN_HEX}@0.5`]: 1,
      [`${BLUE_HEX}@0.5`]: 1,
    });
  });

  it('draws the other reference where its block draws, though the index bounds it elsewhere', () => {
    // C holds one line well above its base point; the view shows the line, not the base points.
    const d = drawing(
      [
        entity('33', line(0, 10, 1, 10), { owner: '42', color: RED }),
        entity('24', insertOf('42', 0)),
        entity('25', insertOf('42', 5)),
      ],
      { blocks: [{ handle: '42', name: 'C' }] },
    );
    const layers: ReturnType<typeof surface>[] = [];
    const r = new Canvas2DRenderer({
      now: () => 0,
      model: d.model,
      index: d.index,
      block: MODEL,
      surface: surface('visible'),
      createLayer: () => {
        const s = surface(layers.length === 0 ? 'scene' : 'transient');
        layers.push(s);
        return s;
      },
      style: DARK,
      requestIdle: () => {},
    });
    r.resize(200, 40, 1);
    r.setView({ center: { x: 3, y: 10 }, scale: 10 });
    const id = (h: string) => d.model.ids.idOf(h)!;
    const order = [...d.model.blockEntities('42')];
    const held = [d.model.entity(id('33'))!];
    r.apply(change(d, (b) => b.moveEntity(id('33'), MODEL)));
    r.setRefEdit({ block: '42', path: [id('24')], order, held, working: [id('33')] });
    layers[0]!.ctx.clear();
    r.frame();
    expect(pieces(layers[0]!.ctx)).toEqual({ [`${RED_HEX}@1`]: 1, [`${RED_HEX}@0.5`]: 1 });
  });

  it('follows XFADECTL: other amounts, 0 for none, at most 90', () => {
    const { r, redraw, refedit } = setup();
    const { cs, display } = refedit(['20']);
    r.apply(cs);
    r.setRefEdit(display);
    const blue = (xFade: number) => {
      r.setStyle({ ...DARK, xFade });
      return Object.keys(pieces(redraw())).filter((k) => k.startsWith(BLUE_HEX));
    };
    expect(blue(20)).toEqual([`${BLUE_HEX}@0.8`]);
    expect(blue(0)).toEqual([`${BLUE_HEX}@1`]);
    expect(blue(95)).toEqual([`${BLUE_HEX}@0.1`]);
  });

  it('draws objects the working set takes in (REFSET Add, drawn ones) in full', () => {
    const { r, redraw, refedit, id } = setup();
    const { cs, display } = refedit(['20']);
    r.apply(cs);
    r.setRefEdit({ ...display, working: [...display.working, id('22')] });
    expect(pieces(redraw())[`${BLUE_HEX}@1`]).toBe(1);
  });

  it('draws the whole block in references nested in another block', () => {
    const { r, redraw, refedit } = setup({ nested: true });
    // The edit is of 32 in P through 23: 20 and 21 draw the block whole, 23's B only the rest.
    const { cs, display } = refedit(['23', '32']);
    r.apply(cs);
    r.setRefEdit(display);
    expect(pieces(redraw())).toEqual({
      [`${RED_HEX}@1`]: 1,
      [`${RED_HEX}@0.5`]: 2,
      [`${GREEN_HEX}@0.5`]: 3,
      [`${BLUE_HEX}@0.5`]: 1,
    });
  });

  it('shows the drawing as it is once the edit ends', () => {
    const { d, r, redraw, refedit, id } = setup();
    const { cs, display } = refedit(['20']);
    r.apply(cs);
    r.setRefEdit(display);
    redraw();
    // REFCLOSE Save: the red line back in the block.
    r.apply(change(d, (b) => b.moveEntity(id('30'), B)));
    r.setRefEdit(undefined);
    expect(pieces(redraw())).toEqual({
      [`${RED_HEX}@1`]: 2,
      [`${GREEN_HEX}@1`]: 2,
      [`${BLUE_HEX}@1`]: 1,
    });
  });

  it('draws what the edit changed in the working set, the other reference as it was', () => {
    const { d, r, redraw, refedit, id } = setup();
    const { cs, display } = refedit(['20']);
    r.apply(cs);
    r.setRefEdit(display);
    // The red line erased while it is edited: the other reference keeps it until Save.
    r.apply(change(d, (b) => b.removeEntity(id('30'))));
    expect(pieces(redraw())).toEqual({
      [`${RED_HEX}@0.5`]: 1,
      [`${GREEN_HEX}@0.5`]: 2,
      [`${BLUE_HEX}@0.5`]: 1,
    });
  });
});
