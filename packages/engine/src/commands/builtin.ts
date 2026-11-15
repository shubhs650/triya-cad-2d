// The commands every document runs (M2-02 onwards): each document's engine session makes its
// own registry, so a command's remembered state (LINE's last end point, CIRCLE's last radius) is
// per drawing.
import { CommandRegistry } from './command';
import { dimensionCommands } from './draw/dimension';
import { arcCommand } from './draw/arc';
import { circleCommand } from './draw/circle';
import { ellipseCommand } from './draw/ellipse';
import { ddptypeCommand, donutCommand, pointCommand } from './draw/point';
import { rayCommand, xlineCommand } from './draw/xline';
import { lastDrawn } from './draw/last-drawn';
import { lineCommand } from './draw/line';
import { plineCommand } from './draw/pline';
import { polygonCommand } from './draw/polygon';
import { rectangCommand } from './draw/rectang';
import { splineCommand } from './draw/spline';
import { divideCommand, measureCommand } from './draw/divide';
import { MLEADER_COMMANDS } from './draw/mleader';
import { revcloudCommand } from './draw/revcloud';
import { wipeoutCommand } from './draw/wipeout';
import { DRAW_ORDER_COMMANDS } from './modify/draw-order';
import { mtextCommand, textCommand, textEditCommand } from './draw/text';
import { EDIT_COMMANDS } from './modify/edit';
import { chamferCommand, cornerSettings, filletCommand } from './modify/fillet';
import { offsetCommand } from './modify/offset';
import { alignCommand } from './modify/align';
import { breakAtPointCommand, breakCommand, lengthenCommand } from './modify/break';
import { explodeCommand, joinCommand, reverseCommand } from './modify/join';
import { peditCommand } from './modify/pedit';
import { splineditCommand } from './modify/splinedit';
import { overkillCommand } from './modify/overkill';
import { DRAFTING_SETTINGS_COMMANDS } from './drafting-settings';
import { SNAP_GRID_COMMANDS } from './snap-grid';
import { changeCommand, chpropCommand } from './modify/chprop';
import { matchpropCommand } from './modify/matchprop';
import { extendCommand, trimCommand, trimSettings } from './modify/trim';
import { FILE_COMMANDS } from './file';
import { CLIPBOARD_COMMANDS } from './modify/clipboard';
import { ATTRIBUTE_COMMANDS } from './modify/attributes';
import { selectCommand } from './select';
import { setvarCommand } from './setvar';
import { PALETTE_COMMANDS } from './palettes';
import { viewCommand } from './view/named-view';
import { panCommand, regenCommand, zoomCommand } from './view/zoom';
import { UNDO_COMMANDS } from './undo-commands';
import { underlayLayersCommand } from './underlay-layers';
import { INQUIRY_COMMANDS } from './inquiry/inquiry';
import { ARRAY_COMMANDS } from './modify/array';

export function builtinCommands(): CommandRegistry {
  // LINE and ARC continue from the last line or arc either drew (M3-01).
  const last = lastDrawn();
  // TRIM and EXTEND share their Mode, Edge and Project settings, as AutoCAD's variables.
  const trim = trimSettings();
  // FILLET and CHAMFER share their Trim mode (TRIMMODE).
  const corner = cornerSettings();
  return new CommandRegistry([
    lineCommand(last),
    arcCommand(last),
    circleCommand(),
    plineCommand(last),
    rectangCommand(),
    polygonCommand(),
    splineCommand(),
    divideCommand(),
    measureCommand(),
    ellipseCommand(),
    xlineCommand(),
    rayCommand(),
    pointCommand(),
    donutCommand(),
    ddptypeCommand(),
    textCommand(),
    mtextCommand(),
    textEditCommand(),
    zoomCommand(),
    panCommand(),
    regenCommand(false),
    regenCommand(true),
    viewCommand(),
    selectCommand(),
    setvarCommand(),
    ...EDIT_COMMANDS.map((make) => make()),
    offsetCommand(),
    trimCommand(trim),
    extendCommand(trim),
    filletCommand(corner),
    chamferCommand(corner),
    breakCommand(),
    breakAtPointCommand(),
    joinCommand(),
    explodeCommand(),
    lengthenCommand(),
    reverseCommand(),
    alignCommand(),
    peditCommand(),
    splineditCommand(),
    overkillCommand(),
    chpropCommand(),
    changeCommand(),
    matchpropCommand(),
    revcloudCommand(),
    wipeoutCommand(),
    ...DRAW_ORDER_COMMANDS.map((make) => make()),
    ...MLEADER_COMMANDS.map((make) => make()),
    ...dimensionCommands(),
    ...ATTRIBUTE_COMMANDS.map((make) => make()),
    ...FILE_COMMANDS.map((make) => make()),
    ...CLIPBOARD_COMMANDS.map((make) => make()),
    ...PALETTE_COMMANDS.map((make) => make()),
    ...DRAFTING_SETTINGS_COMMANDS.map((make) => make()),
    ...SNAP_GRID_COMMANDS.map((make) => make()),
    underlayLayersCommand(),
    ...INQUIRY_COMMANDS.map((make) => make()),
    ...ARRAY_COMMANDS.map((make) => make()),
    // UNDO, U, REDO and OOPS (M2-05) keep no state of their own: the bus's history holds it.
    ...UNDO_COMMANDS,
  ]);
}
