// The commands every document runs (M2-02 onwards): each document's engine session makes its
// own registry, so a command's remembered state (LINE's last end point) is per drawing.
import { CommandRegistry } from './command';
import { lineCommand } from './draw/line';

export function builtinCommands(): CommandRegistry {
  return new CommandRegistry([lineCommand()]);
}
