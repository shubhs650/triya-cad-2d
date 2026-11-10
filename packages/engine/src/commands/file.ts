// QSAVE, SAVE, SAVEAS and CLOSE (M2-13, COMMANDS.md "Output and file"): the file is the app's (it
// holds the bytes opened, the file handle and the pickers), so each asks the host and reports
// its answer. AutoCAD 2024 Help: QSAVE saves the drawing under its file name, or opens Save
// Drawing As when it has none (here also when its file is a DWG or an older DXF, which Triya never
// overwrites: DEC-047); SAVE and SAVEAS open Save Drawing As; CLOSE closes the drawing and asks
// "Save changes to <file>?" first when it has unsaved changes. CLOSEALL (M2-29) closes every open
// drawing the same way, one after another, and Cancel at a prompt stops it there (AutoCAD 2024
// Help, "CLOSEALL": "Closes all currently open drawings"). None of them is an undo step.
//
// DRAWINGRECOVERY (M2-14 part 2): AutoCAD 2024 Help, "DRAWINGRECOVERY": "Displays a list of
// drawing files that can be recovered after a program or system failure" (the Drawing Recovery
// Manager). Triya's list is the recovery banner (DEC-051), which the app shows again.
//
// PLOT and PRINT (M2-17): AutoCAD 2024 Help, "PLOT": "Plots a drawing to a plotter, printer, or
// file", through the Plot dialog box. The dialog is the app's (it writes the PDF and hands the
// file over), so the command opens it and ends; it is not an undo step. The dialog's Window<
// button (M2-17 part 2) hides it and hands back to PLOT, which asks, as AutoCAD 2024 does,
// "Specify window for printing", "Specify first corner:", "Specify opposite corner:" and opens
// the dialog again with that window. Esc at the corners opens the dialog again as it was, as
// AutoCAD's does (part 3).
//
// -PLOT (part 5) asks for the plot at the command line instead: see plot-script.ts.
//
// PUBLISH (M2-17 part 2): AutoCAD 2024 Help, "PUBLISH": "Publishes drawings to DWF, DWFx, and
// PDF files, or to plotters", through the Publish dialog box, which is the app's too.
//
// PREVIEW (M2-18 part 2): AutoCAD 2024 Help, "PREVIEW": "Displays the drawing as it will be
// plotted", asking "Press ESC or ENTER to exit, or right-click to display shortcut menu." The
// preview is the app's (it plots the space shown and draws that plot), so the command says how to
// leave it and waits until the app closes it.
import type { CommandDef, CommandGenerator } from './command';
import type { FileAction } from './view/host';
import { viewRequest } from './view/zoom';
import { dashPlot } from './plot-script';
import type { Vec2 } from '../geom/types';

function fileCommand(name: string, action: FileAction): CommandDef {
  return {
    name,
    // eslint-disable-next-line require-yield -- the host does the prompting (its dialogs)
    async *run(ctx) {
      await viewRequest(ctx, { op: 'file', action });
    },
  };
}

/** PREVIEW: the plot of the space shown, until the drafter leaves it. */
function previewCommand(): CommandDef {
  return {
    name: 'PREVIEW',
    // eslint-disable-next-line require-yield -- the host shows the preview and takes its keys
    async *run(ctx) {
      ctx.message('Press ESC or ENTER to exit, or right-click to display shortcut menu.');
      await viewRequest(ctx, { op: 'file', action: 'preview' });
    },
  };
}

/**
 * PLOT and PRINT: the dialog, then a window's corners whenever its Window< button asks; -PLOT
 * asks for everything at the command line (part 5).
 */
function plotCommand(name: string): CommandDef {
  return {
    name,
    ...(name === 'PLOT' && { dashVariant: true }),
    async *run(ctx): CommandGenerator {
      if (ctx.dash) return yield* dashPlot(ctx);
      let window: { a: Vec2; b: Vec2 } | undefined;
      let resume = false;
      for (;;) {
        const reply = await viewRequest(ctx, {
          op: 'file',
          action: 'plot',
          ...(resume && { resume }),
          ...(window && { window }),
        });
        if (!reply.ok || !reply.pickWindow) return;
        resume = true;
        window = undefined;
        ctx.message('Specify window for printing');
        const first = yield ctx.prompt.point({ message: 'Specify first corner', escape: true });
        if (first.kind !== 'point') continue;
        const a = first.point;
        const second = yield ctx.prompt.point({
          message: 'Specify opposite corner',
          rubberBand: { from: a, box: true },
          escape: true,
        });
        if (second.kind !== 'point') continue;
        window = { a, b: second.point };
      }
    },
  };
}

export const FILE_COMMANDS: readonly (() => CommandDef)[] = [
  () => fileCommand('QSAVE', 'qsave'),
  () => fileCommand('SAVE', 'saveas'),
  () => fileCommand('SAVEAS', 'saveas'),
  () => fileCommand('CLOSE', 'close'),
  () => fileCommand('CLOSEALL', 'closeall'),
  () => fileCommand('DRAWINGRECOVERY', 'recover'),
  () => plotCommand('PLOT'),
  () => plotCommand('PRINT'),
  () => fileCommand('PUBLISH', 'publish'),
  previewCommand,
];
