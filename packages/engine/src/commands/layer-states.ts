// LAYERSTATE (LAS, M5-07 part 2): the Layer States Manager. AutoCAD 2024 Help, "LAYERSTATE
// (Command)": "Saves, restores, and manages named layer states", by opening the Layer States
// Manager. The dialog is the app's (it reads and writes `.las` files), so the command asks the
// host and waits for it to close, as VIEW waits for the View Manager.
import type { CommandDef } from './command';
import { viewRequest } from './view/zoom';

export function layerStateCommand(): CommandDef {
  return {
    name: 'LAYERSTATE',
    usesSelection: 'none',
    keepsSelection: true,
    // eslint-disable-next-line require-yield -- the host shows the dialog
    async *run(ctx) {
      await viewRequest(ctx, { op: 'file', action: 'layerstates' });
    },
  };
}
