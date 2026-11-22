// The commands behind AutoCAD's window keys (M7-06). The windows are the app's, so each asks the
// host and ends; none edits the drawing or is an undo step, and each runs inside another command
// too ('TEXTSCR), as AutoCAD's do.
//
// AutoCAD 2024 Help: "CLEANSCREENON (Command)": "Clears the screen of the ribbon, toolbars, and
// dockable windows, excluding the command line" (Ctrl+0, the status bar's Clean Screen);
// "CLEANSCREENOFF": "Restores display of user interface elements". "HIDEPALETTES": "Hides
// currently displayed palettes"; "SHOWPALETTES": "Restores the display of hidden palettes"
// (Ctrl+Shift+H). Help counts the command window among the palettes HIDEPALETTES hides; Triya's
// command line is part of its window, not a palette, and stays (noted in the PR), as it does for
// Clean Screen. "TEXTSCR": "Opens the text window" (Ctrl+F2); "GRAPHSCR": "Switches from the text
// window to the drawing area": here the Command History palette (M7-03 part 2), which F2 shows.
// "COMMANDLINE": "Displays the Command Line window"; "COMMANDLINEHIDE": "Hides the Command Line
// window" (Ctrl+9, part 3). AutoCAD asks first whether to hide it; Ctrl+9 shows it again, so
// Triya hides it at once (noted in the PR).
import type { CommandDef } from './command';
import type { ViewRequest } from './view/host';
import { viewRequest } from './view/zoom';

function windowCommand(name: string, request: ViewRequest): CommandDef {
  return {
    name,
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    // eslint-disable-next-line require-yield -- the app shows or hides its windows
    async *run(ctx) {
      await viewRequest(ctx, request);
    },
  };
}

export const INTERFACE_COMMANDS: readonly (() => CommandDef)[] = [
  () => windowCommand('CLEANSCREENON', { op: 'cleanScreen', on: true }),
  () => windowCommand('CLEANSCREENOFF', { op: 'cleanScreen', on: false }),
  () => windowCommand('HIDEPALETTES', { op: 'palettes', shown: false }),
  () => windowCommand('SHOWPALETTES', { op: 'palettes', shown: true }),
  () => windowCommand('TEXTSCR', { op: 'palette', palette: 'history', open: true }),
  () => windowCommand('GRAPHSCR', { op: 'palette', palette: 'history', open: false }),
  () => windowCommand('COMMANDLINE', { op: 'commandLine', shown: true }),
  () => windowCommand('COMMANDLINEHIDE', { op: 'commandLine', shown: false }),
];
