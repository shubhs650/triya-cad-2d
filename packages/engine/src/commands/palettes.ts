// PROPERTIES and PROPERTIESCLOSE (M2-21, COMMANDS.md "Properties"). AutoCAD 2024 Help,
// "PROPERTIES (Command)": "Controls properties of existing objects" by opening the Properties
// palette (aliases PR, CH, MO; Ctrl+1); "PROPERTIESCLOSE": closes it. The palette is the app's,
// so each asks the host. Neither deselects: the palette shows the objects selected.
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

export const PALETTE_COMMANDS: readonly (() => CommandDef)[] = [
  () => paletteCommand('PROPERTIES', 'properties', true),
  () => paletteCommand('PROPERTIESCLOSE', 'properties', false),
];
