// DSETTINGS and OSNAP (M3-06 part 1): the Drafting Settings dialog (AutoCAD 2024 Help,
// "DSETTINGS (Command)", "OSNAP (Command)"). DSETTINGS (DS, SE) opens it on the tab shown last;
// OSNAP (OS) on its Object Snap tab. Both run transparently ('DSETTINGS), as AutoCAD's do.
// What it sets (the running object snaps, polar tracking, Quick Properties) are the app's
// per-user settings, which AutoCAD keeps in the registry and Triya in its preferences: the
// dialog sets them itself on OK and the drawing is not edited, so the command only waits while
// the dialog is open. Cancel (Esc) closes it with nothing changed.
import type { CommandDef } from './command';
import type { DraftingSettingsTab } from './prompt';

function draftingSettingsCommand(name: string, tab?: DraftingSettingsTab): CommandDef {
  return {
    name,
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      yield ctx.prompt.dialog({
        message: 'Drafting Settings',
        dialog: { type: 'dsettings', ...(tab && { tab }) },
      });
    },
  };
}

export const DRAFTING_SETTINGS_COMMANDS: readonly (() => CommandDef)[] = [
  () => draftingSettingsCommand('DSETTINGS'),
  () => draftingSettingsCommand('OSNAP', 'osnap'),
];
