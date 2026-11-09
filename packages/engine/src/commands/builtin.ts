// The commands every document runs (M2-02 onwards): each document's engine session makes its
// own registry, so a command's remembered state (LINE's last end point) is per drawing.
import { CommandRegistry } from './command';
import { lineCommand } from './draw/line';
import { EDIT_COMMANDS } from './modify/edit';
import { selectCommand } from './select';
import { viewCommand } from './view/named-view';
import { panCommand, regenCommand, zoomCommand } from './view/zoom';

export function builtinCommands(): CommandRegistry {
  return new CommandRegistry([
    lineCommand(),
    zoomCommand(),
    panCommand(),
    regenCommand(false),
    regenCommand(true),
    viewCommand(),
    selectCommand(),
    ...EDIT_COMMANDS.map((make) => make()),
  ]);
}
