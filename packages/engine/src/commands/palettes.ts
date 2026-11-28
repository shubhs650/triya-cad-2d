// PROPERTIES and PROPERTIESCLOSE (M2-21, COMMANDS.md "Properties"). AutoCAD 2024 Help,
// "PROPERTIES (Command)": "Controls properties of existing objects" by opening the Properties
// palette (aliases PR, CH, MO; Ctrl+1); "PROPERTIESCLOSE": closes it. The palette is the app's,
// so each asks the host. Neither deselects: the palette shows the objects selected.
// QUICKPROPERTIES (M2-35 part 21; AutoCAD 2024 Help, "QUICKPROPERTIES (Command)": "Displays
// quick properties data for selected objects") shows the Quick Properties palette for the
// objects selected, or those picked at "Select objects" when none are, whatever QPMODE says
// (QPMODE decides only whether a pick at `Command:` shows it). The objects stay selected, as the
// palette shows a selection. Help is silent on an empty pick: nothing is shown.
// COMPARE and COMPARECLOSE (M8-06, DEC-092): AutoCAD 2024 Help, "COMPARE (Command)": "Compares two
// versions of a drawing", asking for the drawing to compare with; "COMPARECLOSE": "Closes the
// Compare toolbar and exits the compare state". Triya's compare picks its two drawings in the
// Compare palette, which COMPARE opens and COMPARECLOSE closes.
// LIBRARY (alias LIB) and LIBRARYCLOSE (M8-03): Triya's own, as AutoCAD 2024's BLOCKSPALETTE and
// BLOCKSPALETTECLOSE open and close its Blocks palette: the symbol library palette.
import type { CommandDef } from './command';
import type { PaletteName } from './view/host';
import { viewRequest } from './view/zoom';

function paletteCommand(name: string, palette: PaletteName, open: boolean): CommandDef {
  return {
    name,
    usesSelection: 'none',
    keepsSelection: true,
    // eslint-disable-next-line require-yield -- the host opens or closes the palette
    async *run(ctx) {
      await viewRequest(ctx, { op: 'palette', palette, open });
    },
  };
}

function quickPropertiesCommand(): CommandDef {
  return {
    name: 'QUICKPROPERTIES',
    // Takes the objects selected as its "Select objects" answer, and leaves them selected.
    usesSelection: 'during',
    keepsSelection: true,
    async *run(ctx) {
      const a = yield ctx.prompt.selection({ message: 'Select objects' });
      const ids = a.kind === 'selection' ? a.ids : [];
      if (ids.length === 0) return;
      ctx.select(ids);
      await viewRequest(ctx, { op: 'palette', palette: 'quick', open: true });
    },
  };
}

export const PALETTE_COMMANDS: readonly (() => CommandDef)[] = [
  () => paletteCommand('COMPARE', 'compare', true),
  () => paletteCommand('COMPARECLOSE', 'compare', false),
  () => paletteCommand('LIBRARY', 'library', true),
  () => paletteCommand('LIBRARYCLOSE', 'library', false),
  () => paletteCommand('PROPERTIES', 'properties', true),
  () => paletteCommand('PROPERTIESCLOSE', 'properties', false),
  quickPropertiesCommand,
];
