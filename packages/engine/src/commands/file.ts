// QSAVE, SAVE, SAVEAS and CLOSE (M2-13, COMMANDS.md "Output and file"): the file is the app's (it
// holds the bytes opened, the file handle and the pickers), so each asks the host and reports
// its answer. AutoCAD 2024 Help: QSAVE saves the drawing under its file name, or opens Save
// Drawing As when it has none (here also when its file is a DWG or an older DXF, which Triya never
// overwrites: DEC-047); SAVE and SAVEAS open Save Drawing As; CLOSE closes the drawing and asks
// "Save changes to <file>?" first when it has unsaved changes. None of them is an undo step.
//
// DRAWINGRECOVERY (M2-14 part 2): AutoCAD 2024 Help, "DRAWINGRECOVERY": "Displays a list of
// drawing files that can be recovered after a program or system failure" (the Drawing Recovery
// Manager). Triya's list is the recovery banner (DEC-051), which the app shows again.
//
// PLOT and PRINT (M2-17): AutoCAD 2024 Help, "PLOT": "Plots a drawing to a plotter, printer, or
// file", through the Plot dialog box. The dialog is the app's (it writes the PDF and hands the
// file over), so the command opens it and ends; it is not an undo step.
import type { CommandDef } from './command';
import type { FileAction } from './view/host';
import { viewRequest } from './view/zoom';

function fileCommand(name: string, action: FileAction): CommandDef {
  return {
    name,
    // eslint-disable-next-line require-yield -- the host does the prompting (its dialogs)
    async *run(ctx) {
      await viewRequest(ctx, { op: 'file', action });
    },
  };
}

export const FILE_COMMANDS: readonly (() => CommandDef)[] = [
  () => fileCommand('QSAVE', 'qsave'),
  () => fileCommand('SAVE', 'saveas'),
  () => fileCommand('SAVEAS', 'saveas'),
  () => fileCommand('CLOSE', 'close'),
  () => fileCommand('DRAWINGRECOVERY', 'recover'),
  () => fileCommand('PLOT', 'plot'),
  () => fileCommand('PRINT', 'plot'),
];
