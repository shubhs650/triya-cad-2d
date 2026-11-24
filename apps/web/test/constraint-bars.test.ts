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
