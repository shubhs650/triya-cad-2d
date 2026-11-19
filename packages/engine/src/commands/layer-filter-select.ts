// A group filter's Select Layers (M5-07 part 9), started from the Layer Properties Manager's
// filter tree (AutoCAD 2024 Help, "Layer Properties Manager", the tree view's shortcut menu,
// Select Layers):
//
//   - Add: "Adds the layers of the selected objects to the group filter."
//   - Replace: "Replaces the layers of the selected group filter with the layers of the objects
//     that are selected in the drawing."
//
// The manager stays open and the command line asks "Select objects:"; Enter ends the selection
// and changes the group, one LAYER undo step as the manager's other edits are. Nothing selected,
// or Esc, changes nothing. Objects selected before are not taken: the menu asks for a pick in
// the drawing, so the prompt always shows.
//
// Ambiguities, settled for the common drafter expectation (noted in the PR): the help does not
// say which layer an object nested in a block reference gives; the reference's own layer is
// taken (Block selection None, `nested-pick.ts`), as a selection set holds the reference, not
// what is in it. Objects on locked layers can be selected: the layer, not the object, is used.
// The help quotes no message; Triya says how many layers the group gained or now lists. The
// command is the manager's, not one a drafter types, so Enter at `Command:` does not repeat it.
import type { CommandDef } from './command';
import type { Handle } from '../model/handle';
import { isLayerFilter, type LayerFilter } from '../model/types';
import { selectedLayers } from './nested-pick';

const layers = (n: number) => `${n} layer${n === 1 ? '' : 's'}`;

/** Select Layers' Add (`replace` false) or Replace on the group filter `filter`. */
export function layerFilterSelectCommand(filter: Handle, replace: boolean): CommandDef {
  return {
    // The manager's edits are LAYER undo steps (AutoCAD names them so).
    name: 'LAYER',
    usesSelection: 'during',
    async *run(ctx) {
      const f = ctx.model.objects.get(filter);
      if (!isLayerFilter(f)) return ctx.message(`No layer filter ${filter}.`);
      if (f.filterType !== 'group')
        return ctx.message(`${f.name} is a property filter: only a group filter takes layers.`);
      const a = yield ctx.prompt.selection({ message: 'Select objects', pickfirst: false });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      const picked = (await selectedLayers(ctx, a, 'None')).map((l) => l.handle);
      // The filter may have gone while the drafter selected (the manager stays open).
      const now = ctx.model.objects.get(filter);
      if (!isLayerFilter(now)) return ctx.message(`No layer filter ${filter}.`);
      const next = replace
        ? picked
        : [...now.layers, ...picked.filter((h) => !now.layers.includes(h))];
      if (next.join() !== now.layers.join())
        ctx.edit((b) => b.updateObject(filter, { layers: next } as Partial<LayerFilter>));
      ctx.message(
        replace
          ? `Group filter "${now.name}" now lists ${layers(next.length)}.`
          : `${layers(next.length - now.layers.length)} added to group filter "${now.name}".`,
      );
    },
  };
}
