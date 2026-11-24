// M9-03 part 7: DCDISPLAY shows or hides the dynamic constraints of the objects selected (AutoCAD
// 2024 Help, "DCDISPLAY (Command)": "Displays or hides the dynamic constraints associated with a
// selection set of objects", Select objects, then Show or Hide). Annotational constraints are not
// dynamic ones and stay as they are.
import { describe, expect, it } from 'vitest';
import { isDimensionalConstraint, type DimensionalConstraintObject } from '../../src/index';
import { setup } from './edit-harness';
import { lineGeom } from '../model/fixtures';

const dimension = (
  handle: string,
  entity: string,
  parameter: string,
  o: Partial<DimensionalConstraintObject> = {},
): DimensionalConstraintObject => ({
  handle,
  type: 'TRIYA_DIMCONSTRAINT',
  owner: 'C',
  dimension: 'aligned',
  refs: [
    { entity, point: 'start' },
    { entity, point: 'end' },
  ],
  parameter,
  expression: '10',
  location: { x: 0, y: 0 },
  form: 'dynamic',
  ...o,
});

/**
 * Line 30 (0,0)-(10,0) and line 40 (10,0)-(10,10). D1 constrains 30, D2 40, D3 (annotational)
 * 30, and D4 runs between the two.
 */
function drawing(objects?: DimensionalConstraintObject[]) {
  const s = setup([lineGeom(10, 0, 10, 10)], {
    objects: objects ?? [
      dimension('D1', '30', 'd1'),
      dimension('D2', '40', 'd2'),
      dimension('D3', '30', 'd3', { form: 'annotational' }),
      dimension('D4', '30', 'd4', {
        refs: [
          { entity: '30', point: 'start' },
          { entity: '40', point: 'end' },
        ],
      }),
    ],
  });
  /** The handles of the dimensional constraints hidden. */
  const hidden = () =>
    [...s.model.objects.values()]
      .filter(isDimensionalConstraint)
      .filter((d) => d.hidden)
      .map((d) => d.handle);
  return { ...s, hidden };
}

describe('DCDISPLAY (M9-03 part 7)', () => {
  it("hides the dynamic constraints of the objects selected, each one's own flag", async () => {
    const d = drawing();
    await d.bus.script(['DCDISPLAY']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.submit('');
    expect(d.bus.promptText).toBe('Enter an option [Show/Hide] <Show>:');
    await d.bus.submit('H');
    // Line 30's dynamic constraints, the one also on 40 included; the annotational one and
    // line 40's own are left.
    expect(d.hidden()).toEqual(['D1', 'D4']);
  });

  it('shows them again, Show being the default, and U takes back each as one step', async () => {
    const d = drawing();
    await d.bus.script(['DCDISPLAY']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    await d.bus.submit('Hide');
    expect(d.hidden()).toEqual(['D1', 'D2', 'D4']);
    await d.bus.script(['DCDISPLAY']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    await d.bus.submit('');
    expect(d.hidden()).toEqual(['D1']);
    await d.bus.script(['U']);
    expect(d.hidden()).toEqual(['D1', 'D2', 'D4']);
    await d.bus.script(['U']);
    expect(d.hidden()).toEqual([]);
  });

  it('says so when the objects have no dynamic constraints, and changes nothing', async () => {
    const d = drawing([dimension('D3', '30', 'd3', { form: 'annotational' })]);
    const before = d.model.objects.get('D3');
    await d.bus.script(['DCDISPLAY']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.submit('');
    await d.bus.submit('H');
    expect(d.log.at(-1)).toBe('No dynamic constraints are associated with the objects selected.');
    expect(d.model.objects.get('D3')).toBe(before);
    expect(d.hidden()).toEqual([]);
  });

  it('ends at an empty selection, and makes no undo step when nothing changes', async () => {
    const d = drawing();
    await d.bus.script(['DCDISPLAY']);
    await d.bus.submit('');
    expect(d.bus.promptText).toBe('Command:');
    const before = d.model.objects.get('D2');
    await d.bus.script(['DCDISPLAY']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    await d.bus.submit('S');
    // Already shown: the drawing is as it was.
    expect(d.model.objects.get('D2')).toBe(before);
    expect(d.bus.undo.state.undoable).toBe(0);
  });

  it('takes the objects selected before it starts (PICKFIRST)', async () => {
    const d = drawing();
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.script(['DCDISPLAY']);
    await d.bus.submit('H');
    expect(d.hidden()).toEqual(['D2', 'D4']);
  });
});
