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
//
// EXPORT (EXP) and EXPORTPDF (M2-39 part 2): AutoCAD 2024 Help, "EXPORT": "Saves the objects in a
// drawing to a different file format" through the Export Data dialog box, whose "Files of type"
// picks the format (here PDF, SVG, PNG and DXF: the formats Triya writes); "EXPORTPDF": "Exports
// drawing to PDF" through the Save As PDF dialog box, whose Export list is Display, Extents or
// Window in model space and Current layout or All layouts in a layout. The dialogs are the app's
// (they plot or save and hand the file over). Window in their Export list hides the dialog and
// asks "Specify first corner:" and "Specify opposite corner:" as PLOT's Window< does, then shows
// it again with that window; Esc at the corners shows it again as it was.
//
// -EXPORT (M2-39 part 5) asks for the export at the command line instead: see export-script.ts.
import type { CommandContext, CommandDef, CommandGenerator } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { FileAction } from './view/host';
import { viewRequest } from './view/zoom';
import { dashPlot } from './plot-script';
import { dashExport } from './export-script';
import type { Vec2 } from '../geom/types';
import type { EntityGeometry } from '../model/types';

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
 * A dialog of the app's that may ask for a window (PLOT's Window<, EXPORTPDF's Export Window, the
 * New View dialog's Define window): the dialog, then the window's corners whenever it asks, then
 * the dialog again.
 */
export async function* windowDialog(
  ctx: CommandContext,
  action: 'plot' | 'export' | 'exportpdf' | 'views',
): CommandGenerator {
  let window: { a: Vec2; b: Vec2 } | undefined;
  let resume = false;
  for (;;) {
    const reply = await viewRequest(ctx, {
      op: 'file',
      action,
      ...(resume && { resume }),
      ...(window && { window }),
    });
    if (!reply.ok || !reply.pickWindow) return;
    resume = true;
    window = undefined;
    if (reply.boundary) {
      window = yield* editBoundary(ctx, reply.boundary);
      continue;
    }
    if (action === 'plot') ctx.message('Specify window for printing');
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
}

type Corners = { readonly a: Vec2; readonly b: Vec2 };

/** A window's outline, as the preview draws it. */
const outline = ({ a, b }: Corners): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  closed: true,
  vertices: [
    { x: a.x, y: a.y, bulge: 0 },
    { x: b.x, y: a.y, bulge: 0 },
    { x: b.x, y: b.y, bulge: 0 },
    { x: a.x, y: b.y, bulge: 0 },
  ],
});

/** How much of a view's size Edit Boundaries shows around it on each side. */
const BOUNDARY_MARGIN = 0.25;

/**
 * The View Manager's Edit Boundaries... (M2-47 part 5). AutoCAD 2024 Help, "View Manager Dialog
 * Box": it "displays the selected view, with the rest of the drawing area displayed in a lighter
 * color to show the boundaries of the named view", and the drafter picks two corners of a new
 * boundary as often as wanted until Enter accepts the last. Here the display shows the view with a
 * quarter of its size around it and its boundary drawn as a preview (the canvas has no lighter
 * colour for the rest), and the display it was asked from comes back with the dialogs; neither
 * change is a ZOOM Previous or undo step, as looking at a view while editing it is no zoom. The help
 * does not word the prompts: "Specify first corner (or press ENTER to accept)" is the most common
 * drafter reading of it. Esc goes back to the dialog with the boundary unchanged, as Esc at PLOT's
 * window corners does; so does Enter before any window was picked.
 */
async function* editBoundary(
  ctx: CommandContext,
  boundary: Corners,
): AsyncGenerator<Prompt, Corners | undefined, PromptAnswer> {
  // Quietly: without a canvas to ask, the display is left as it is.
  const was = await ctx.view.request({ op: 'get' });
  const shown = was.ok ? was.view : undefined;
  if (shown && shown.height > 0 && shown.width > 0) {
    const scale = 1 + 2 * BOUNDARY_MARGIN;
    const w = Math.abs(boundary.b.x - boundary.a.x) * scale;
    const h = Math.abs(boundary.b.y - boundary.a.y) * scale;
    await ctx.view.request({
      op: 'glance',
      view: {
        center: { x: (boundary.a.x + boundary.b.x) / 2, y: (boundary.a.y + boundary.b.y) / 2 },
        // The window fitted into the canvas's proportions.
        height: Math.max(h, (w * shown.height) / shown.width),
      },
    });
  }
  let picked: Corners | undefined;
  for (;;) {
    ctx.preview([outline(picked ?? boundary)]);
    const first = yield ctx.prompt.point({
      message: 'Specify first corner (or press ENTER to accept)',
      escape: true,
    });
    if (first.kind === 'point') {
      const a = first.point;
      const second = yield ctx.prompt.point({
        message: 'Specify opposite corner',
        rubberBand: { from: a, box: true },
        escape: true,
      });
      if (second.kind === 'point') {
        picked = { a, b: second.point };
        continue;
      }
      picked = undefined;
    } else if (first.kind !== 'enter') picked = undefined;
    break;
  }
  ctx.preview([]);
  if (shown) {
    await ctx.view.request({ op: 'glance', view: { center: shown.center, height: shown.height } });
  }
  return picked;
}

/** EXPORT and EXPORTPDF: the Export Data or Save As PDF dialog; -EXPORT asks at the command line. */
function exportCommand(name: string, action: 'export' | 'exportpdf'): CommandDef {
  return {
    name,
    ...(name === 'EXPORT' && { dashVariant: true }),
    async *run(ctx): CommandGenerator {
      if (ctx.dash) return yield* dashExport(ctx);
      return yield* windowDialog(ctx, action);
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
      return yield* windowDialog(ctx, 'plot');
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
  () => exportCommand('EXPORT', 'export'),
  () => exportCommand('EXPORTPDF', 'exportpdf'),
];
