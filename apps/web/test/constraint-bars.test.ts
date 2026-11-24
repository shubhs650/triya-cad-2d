// M9-05 part 2: which constraint bars show, per drawing. CONSTRAINTBAR's Hide hides, Show (and
// Reset, Showall) shows again; a constraint applied shows its objects' bars while
// CONSTRAINTBARDISPLAY bit 1 is set (AutoCAD 2024 Help: "Displays constraint bars as objects are
// geometrically constrained") and hides them while it is clear ("Automatically hides constraint
// bars after applying geometric constraints").
import { describe, expect, it } from 'vitest';
import { ConstraintBarStates } from '../src/constraint-bars';

describe('constraint bar states (M9-05 part 2)', () => {
  it('hides and shows bars per drawing, telling the canvases once per change', () => {
    const s = new ConstraintBarStates();
    let told = 0;
    s.subscribe(() => told++);
    s.apply(1, { action: 'hide', entities: ['30', '40'] }, 3);
    expect([...s.hidden(1)]).toEqual(['30', '40']);
    expect(s.hidden(2).size).toBe(0);
    s.apply(1, { action: 'show', entities: ['40'] }, 3);
    expect([...s.hidden(1)]).toEqual(['30']);
    // Nothing changed: no one is told.
    s.apply(1, { action: 'show', entities: ['40'] }, 3);
    expect(told).toBe(2);
    s.forget(1);
    expect(s.hidden(1).size).toBe(0);
  });

  it('shows or hides the bars of objects just constrained as CONSTRAINTBARDISPLAY says', () => {
    const s = new ConstraintBarStates();
    s.apply(1, { action: 'hide', entities: ['30'] }, 3);
    s.apply(1, { action: 'applied', entities: ['30', '40'] }, 3);
    expect(s.hidden(1).size).toBe(0);
    s.apply(1, { action: 'applied', entities: ['30', '40'] }, 2);
    expect([...s.hidden(1)]).toEqual(['30', '40']);
  });
});

// M9-05 part 6: a bar dragged keeps its offset, display state like Show and Hide; CONSTRAINTBAR
// Reset ("displays constraint bars for the selected objects ... and resets them to their default
// locations") shows the objects' bars and puts every one of them (a polyline's segments too)
// back.
describe('constraint bars dragged (M9-05 part 6)', () => {
  it("keeps each bar's offset per drawing, telling the canvases once per change", () => {
    const s = new ConstraintBarStates();
    let told = 0;
    s.subscribe(() => told++);
    s.move(1, '30', { x: 10, y: -5 });
    s.move(1, '30', { x: 10, y: -5 });
    expect(told).toBe(1);
    expect(s.moved(1).get('30')).toEqual({ x: 10, y: -5 });
    expect(s.moved(2).size).toBe(0);
    s.move(1, '30', undefined);
    expect(s.moved(1).size).toBe(0);
    expect(told).toBe(2);
  });

  it("Reset shows the objects' bars and puts them back, a polyline's segments too", () => {
    const s = new ConstraintBarStates();
    s.apply(1, { action: 'hide', entities: ['30', '40'] }, 3);
    s.move(1, '30', { x: 10, y: 0 });
    s.move(1, '40:0', { x: 0, y: 10 });
    s.move(1, '40:2', { x: 0, y: 10 });
    s.move(1, '400', { x: 5, y: 5 });
    let told = 0;
    s.subscribe(() => told++);
    s.apply(1, { action: 'reset', entities: ['30', '40'] }, 3);
    expect(s.hidden(1).size).toBe(0);
    expect([...s.moved(1).keys()]).toEqual(['400']);
    expect(told).toBe(1);
  });

  it('Show and Hide leave a dragged bar where it is; forgetting the drawing forgets them', () => {
    const s = new ConstraintBarStates();
    s.move(1, '30', { x: 10, y: 0 });
    s.apply(1, { action: 'hide', entities: ['30'] }, 3);
    s.apply(1, { action: 'show', entities: ['30'] }, 3);
    expect(s.moved(1).get('30')).toEqual({ x: 10, y: 0 });
    s.forget(1);
    expect(s.moved(1).size).toBe(0);
  });
});
