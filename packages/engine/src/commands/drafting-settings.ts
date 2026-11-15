// DSETTINGS and OSNAP (M3-06 part 1): the Drafting Settings dialog (AutoCAD 2024 Help,
// "DSETTINGS (Command)", "OSNAP (Command)"). DSETTINGS (DS, SE) opens it on the tab shown last;
// OSNAP (OS) on its Object Snap tab. Both run transparently ('DSETTINGS), as AutoCAD's do.
// What it sets (the running object snaps, polar tracking, Quick Properties) are the app's
// per-user settings, which AutoCAD keeps in the registry and Triya in its preferences: the
// dialog sets them itself on OK and the drawing is not edited, so the command only waits while
// the dialog is open. Cancel (Esc) closes it with nothing changed. The Snap and Grid tab's
// spacing and snap type (M3-06 part 2) are the drawing's, kept in its `*Active` VPORT as
// AutoCAD keeps them in the current viewport: OK sets them, one DSETTINGS undo step.
// ISOPLANE (part 2) sets the isoplane isometric snap and ELLIPSE's Isocircle follow.
import {
  currentIsoplane,
  currentVport,
  setIsoplane,
  snapGridOf,
  snapGridPatch,
  snapGridProblem,
} from '../edit/snap-grid';
import { ISOPLANE_NAMES, nextIsoplane, type Isoplane } from '../input/isometric';
import type { CommandDef } from './command';
import type { DraftingSettingsTab } from './prompt';

function draftingSettingsCommand(name: string, tab?: DraftingSettingsTab): CommandDef {
  return {
    name,
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      const vport = currentVport(ctx.model);
      const a = yield ctx.prompt.dialog({
        message: 'Drafting Settings',
        dialog: {
          type: 'dsettings',
          ...(tab && { tab }),
          ...(vport && { snapGrid: snapGridOf(vport) }),
        },
      });
      if (a.kind !== 'dialog' || a.action !== 'ok' || !a.snapGrid || !vport) return;
      const patch = snapGridProblem(a.snapGrid) ? undefined : snapGridPatch(vport, a.snapGrid);
      if (patch) ctx.edit((b) => b.updateTableRecord('vports', vport.handle, patch));
    },
  };
}

/**
 * ISOPLANE (AutoCAD 2024 Help, "ISOPLANE (Command)"), transparent:
 *   Current isoplane:  Left
 *   Enter isometric plane setting [Left/Top/Right] <Top>:
 * Enter takes the next plane, as F5 does. The plane is the drawing's (SNAPISOPAIR).
 */
function isoplaneCommand(): CommandDef {
  return {
    name: 'ISOPLANE',
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      if (!currentVport(ctx.model)) {
        ctx.message('The drawing has no current viewport to keep an isoplane in.');
        return;
      }
      const now = currentIsoplane(ctx.model);
      ctx.message(`Current isoplane:  ${ISOPLANE_NAMES[now]}`);
      const next = nextIsoplane(now);
      const a = yield ctx.prompt.keyword({
        message: 'Enter isometric plane setting',
        options: [...ISOPLANE_NAMES],
        default: { kind: 'keyword', keyword: ISOPLANE_NAMES[next] },
      });
      if (a.kind !== 'keyword') return;
      const plane = ISOPLANE_NAMES.indexOf(a.keyword as never) as Isoplane;
      if (plane !== now) ctx.edit((b) => setIsoplane(b, ctx.model, plane));
      ctx.message(`Current isoplane is: ${ISOPLANE_NAMES[plane]}`);
    },
  };
}

export const DRAFTING_SETTINGS_COMMANDS: readonly (() => CommandDef)[] = [
  () => draftingSettingsCommand('DSETTINGS'),
  () => draftingSettingsCommand('OSNAP', 'osnap'),
  isoplaneCommand,
];
