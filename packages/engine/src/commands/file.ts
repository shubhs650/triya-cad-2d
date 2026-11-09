// QSAVE, SAVE, SAVEAS and CLOSE (M2-13, COMMANDS.md "Output and file"): the file is the app's (it
// holds the bytes opened, the file handle and the pickers), so each asks the host and reports
// its answer. AutoCAD 2024 Help: QSAVE saves the drawing under its file name, or opens Save
// Drawing As when it has none (here also when its file is a DWG or an older DXF, which Triya never
// overwrites: DEC-047); SAVE and SAVEAS open Save Drawing As; CLOSE closes the drawing and asks
// "Save changes to <file>?" first when it has unsaved changes. None of them is an undo step.
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
];
