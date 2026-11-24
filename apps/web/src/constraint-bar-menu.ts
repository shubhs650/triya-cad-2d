// A constraint bar's shortcut menu (M9-05 part 4). AutoCAD 2024 Help, "About Displaying and
// Verifying Geometric Constraints": the cursor on a constraint icon highlights the objects the
// constraint is on, and a right-click on it lists Delete, Hide, Hide All Constraints and
// Constraint Bar Settings. Delete deletes the constraint (one DELCONSTRAINT undo step); Hide
// hides the bar right-clicked (CONSTRAINTBAR Hide on its object: the Help does not say whether
// the bars of the constraint's other objects go too, and a drafter hiding one bar expects the
// others to stay); a Coincident square has no bar, so its objects' bars go. Hide All
// Constraints is CONSTRAINTBAR Hideall; Constraint Bar Settings opens Constraint Settings on its
// Geometric tab.
import type { ShortcutMenuItem } from '@triya/engine';
import type { ConstraintBarHit } from '@triya/render';

/** The menu's items; each one's keyword names what it does. */
export function constraintBarMenu(hit: ConstraintBarHit): ShortcutMenuItem[] {
  return [
    { label: 'Delete', keyword: 'delete', ...(hit.constraint === undefined && { disabled: true }) },
    { label: 'Hide', keyword: 'hide' },
    { label: 'Hide All Constraints', keyword: 'hideAll', separatorBefore: true },
    { label: 'Constraint Bar Settings...', keyword: 'settings' },
  ];
}

/** What the menu acts through: the drawing's engine and the app's bar states. */
export interface ConstraintBarMenuDeps {
  readonly deleteConstraints: (handles: readonly string[]) => void;
  readonly hideBars: (entities: readonly string[]) => void;
  /** Runs a command, its first prompts answered by `keys`, as a ribbon macro does. */
  readonly invoke: (name: string, keys?: readonly string[]) => void;
  /** Constraint Settings opens on its Geometric tab next. */
  readonly geometricTabNext: () => void;
}

/** Does what `item` of the menu for `hit` says. */
export function runConstraintBarItem(
  hit: ConstraintBarHit,
  item: ShortcutMenuItem,
  deps: ConstraintBarMenuDeps,
): void {
  switch (item.keyword) {
    case 'delete':
      if (hit.constraint !== undefined) deps.deleteConstraints([hit.constraint]);
      return;
    case 'hide':
      deps.hideBars(hit.entity !== undefined ? [hit.entity] : hit.entities);
      return;
    case 'hideAll':
      deps.invoke('CONSTRAINTBAR', ['Hideall']);
      return;
    case 'settings':
      deps.geometricTabNext();
      deps.invoke('CONSTRAINTSETTINGS');
      return;
  }
}
