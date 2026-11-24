// M9-05 part 4: a constraint bar's icon has a shortcut menu (AutoCAD 2024 Help, "About
// Displaying and Verifying Geometric Constraints": the icons' shortcut menu): Delete deletes the
// constraint, Hide hides the bar right-clicked, Hide All Constraints hides every bar
// (CONSTRAINTBAR Hideall), Constraint Bar Settings opens Constraint Settings on its Geometric tab.
import { describe, expect, it } from 'vitest';
import { constraintBarMenu, runConstraintBarItem } from '../src/constraint-bar-menu';

const parallel = {
  entity: '20',
  constraint: 'E2',
  kind: 'parallel',
  entities: ['20', '21'],
} as const;
const panel = { entity: '20', entities: ['20'] } as const;
const square = { constraint: 'E3', kind: 'coincident', entities: ['20', '21'] } as const;

function deps() {
  const did: string[] = [];
  return {
    did,
    deleteConstraints: (h: readonly string[]) => did.push(`delete ${h.join(',')}`),
    hideBars: (e: readonly string[]) => did.push(`hide ${e.join(',')}`),
    invoke: (name: string, keys: readonly string[] = []) => did.push([name, ...keys].join(' ')),
    geometricTabNext: () => did.push('geometric tab'),
  };
}

describe("a constraint bar icon's shortcut menu (M9-05 part 4)", () => {
  it("lists AutoCAD's four items, Delete greyed on a bar's panel between icons", () => {
    expect(constraintBarMenu(parallel).map((i) => [i.label, i.disabled ?? false])).toEqual([
      ['Delete', false],
      ['Hide', false],
      ['Hide All Constraints', false],
      ['Constraint Bar Settings...', false],
    ]);
    expect(constraintBarMenu(panel)[0]).toMatchObject({ label: 'Delete', disabled: true });
    expect(constraintBarMenu(parallel)[2]!.separatorBefore).toBe(true);
  });

  it('runs each item on the drawing', () => {
    const d = deps();
    for (const item of constraintBarMenu(parallel)) runConstraintBarItem(parallel, item, d);
    expect(d.did).toEqual([
      'delete E2',
      'hide 20',
      'CONSTRAINTBAR Hideall',
      'geometric tab',
      'CONSTRAINTSETTINGS',
    ]);
  });

  it("hides a Coincident square's objects' bars, the square having no bar of its own", () => {
    const d = deps();
    runConstraintBarItem(square, constraintBarMenu(square)[1]!, d);
    expect(d.did).toEqual(['hide 20,21']);
  });

  it('deletes nothing from a panel', () => {
    const d = deps();
    runConstraintBarItem(panel, constraintBarMenu(panel)[0]!, d);
    expect(d.did).toEqual([]);
  });
});
