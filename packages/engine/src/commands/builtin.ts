// The commands every document runs (M2-02 onwards): each document's engine session makes its
// own registry, so a command's remembered state (LINE's last end point) is per drawing.
import { CommandRegistry } from './command';
import { dimensionCommands } from './draw/dimension';
import { lineCommand } from './draw/line';
import { MLEADER_COMMANDS } from './draw/mleader';
import { revcloudCommand } from './draw/revcloud';
import { wipeoutCommand } from './draw/wipeout';
import { DRAW_ORDER_COMMANDS } from './modify/draw-order';
import { mtextCommand, textCommand, textEditCommand } from './draw/text';
import { EDIT_COMMANDS } from './modify/edit';
import { FILE_COMMANDS } from './file';
import { CLIPBOARD_COMMANDS } from './modify/clipboard';
import { ATTRIBUTE_COMMANDS } from './modify/attributes';
import { selectCommand } from './select';
import { PALETTE_COMMANDS } from './palettes';
import { viewCommand } from './view/named-view';
import { panCommand, regenCommand, zoomCommand } from './view/zoom';

export function builtinCommands(): CommandRegistry {
  return new CommandRegistry([
    lineCommand(),
    textCommand(),
    mtextCommand(),
    textEditCommand(),
    zoomCommand(),
    panCommand(),
    regenCommand(false),
    regenCommand(true),
    viewCommand(),
    selectCommand(),
    ...EDIT_COMMANDS.map((make) => make()),
    revcloudCommand(),
    wipeoutCommand(),
    ...DRAW_ORDER_COMMANDS.map((make) => make()),
    ...MLEADER_COMMANDS.map((make) => make()),
    ...dimensionCommands(),
    ...ATTRIBUTE_COMMANDS.map((make) => make()),
    ...FILE_COMMANDS.map((make) => make()),
    ...CLIPBOARD_COMMANDS.map((make) => make()),
    ...PALETTE_COMMANDS.map((make) => make()),
  ]);
}
