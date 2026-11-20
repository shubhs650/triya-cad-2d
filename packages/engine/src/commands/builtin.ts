// The commands every document runs (M2-02 onwards): each document's engine session makes its
// own registry, so a command's remembered state (LINE's last end point, CIRCLE's last radius) is
// per drawing.
import { CommandRegistry } from './command';
import { dimensionCommands } from './draw/dimension';
import { moreDimensionCommands } from './draw/dimension-more';
import { qdimCommand } from './draw/qdim';
import { dimensionEditCommands } from './modify/dimension-edit';
import { dimensionAssociateCommands } from './modify/dimension-associate';
import { dimensionBreakCommands } from './modify/dimension-break';
import { centerMarkCommands } from './draw/centermark';
import { arcCommand } from './draw/arc';
import { circleCommand } from './draw/circle';
import { ellipseCommand } from './draw/ellipse';
import { ddptypeCommand, donutCommand, pointCommand } from './draw/point';
import { rayCommand, xlineCommand } from './draw/xline';
import { lastDrawn } from './draw/last-drawn';
import { lineCommand } from './draw/line';
import { plineCommand } from './draw/pline';
import { polygonCommand } from './draw/polygon';
import { tableCommands } from './draw/table';
import { rectangCommand } from './draw/rectang';
import { splineCommand } from './draw/spline';
import { divideCommand, measureCommand } from './draw/divide';
import { MLEADER_COMMANDS } from './draw/mleader';
import { MLEADER_ALIGN_COMMANDS } from './modify/mleader-align';
import { TEXT_TOOL_COMMANDS } from './modify/text-tools';
import { updateFieldCommand } from './modify/fields';
import { fieldCommand } from './draw/field';
import { FIND_COMMANDS } from './modify/find';
import { SPELL_COMMANDS } from './modify/spell';
import { revcloudCommand } from './draw/revcloud';
import { wipeoutCommand } from './draw/wipeout';
import { hatchCommands } from './draw/hatchedit';
import { toleranceCommand } from './draw/tolerance';
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
import { UNITS_COMMANDS } from './drawing-units';
import { dimstyleCommand } from './dimstyle';
import { dashStyleCommand, styleCommand } from './textstyle';
import { tablestyleCommand } from './tablestyle';
import { mleaderstyleCommand } from './mleaderstyle';
import { dashDimstyleCommand } from './dimstyle-dash';
import { SNAP_GRID_COMMANDS } from './snap-grid';
import { mviewCommand } from './mview';
import { mspaceCommand, pspaceCommand } from './mspace';
import { vpclipCommand } from './vpclip';
import { vplayerCommand } from './vplayer';
import { UCS_COMMANDS } from './ucs';
import { changeCommand, chpropCommand } from './modify/chprop';
import { matchpropCommand } from './modify/matchprop';
import { extendCommand, trimCommand, trimSettings } from './modify/trim';
import { FILE_COMMANDS } from './file';
import { CLIPBOARD_COMMANDS } from './modify/clipboard';
import { BLOCK_COMMANDS } from './blocks';
import { BLOCK_EDITOR_COMMANDS } from './block-editor';
import { REFEDIT_COMMANDS } from './refedit';
import { attsyncCommand } from './attsync';
import { attredefCommand } from './attredef';
import { wblockCommand } from './wblock';
import { ATTRIBUTE_COMMANDS } from './modify/attributes';
import { selectCommand } from './select';
import { qselectCommand } from './qselect';
import { GROUP_COMMANDS } from './modify/group';
import { filterCommand } from './filter';
import { selectSimilarCommand } from './select-similar';
import { setvarCommand } from './setvar';
import { PALETTE_COMMANDS } from './palettes';
import { DESIGN_CENTER_COMMANDS } from './design-center';
import { viewCommand } from './view/named-view';
import { panCommand, regenCommand, zoomCommand } from './view/zoom';
import { UNDO_COMMANDS } from './undo-commands';
import { underlayLayersCommand } from './underlay-layers';
import { layerCloseCommand, layerCommand } from './layer';
import { layerStateCommand } from './layer-states';
import { layerToolCommands } from './layer-tools';
import { laydelCommand, laymrgCommand } from './layer-cleanup';
import { purgeCommand } from './purge';
import { layoutCommand } from './layout';
import { laywalkCommand } from './layer-walk';
import { layerpCommand, layerpmodeCommand } from './layer-previous';
import { XREF_COMMANDS } from './xref';
import { xclipCommand } from './xclip';
import {
  imageadjustCommand,
  imageadjustDashCommand,
  imageclipCommand,
  imagequalityCommand,
} from './image';
import { imageattachCommand } from './image-attach';
import { pdfattachCommand } from './pdf-attach';
import { pdfadjustCommand, pdfclipCommand } from './pdf-underlay';
import { attdefCommand, attdispCommand } from './attdef';
import { battmanCommand } from './battman';
import { xattachCommand } from './xref-attach';
import { xbindCommand } from './xbind';
import { linetypeCommand, ltscaleCommand } from './linetype';
import { lweightCommand } from './lweight';
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
    qselectCommand(),
    filterCommand(),
    selectSimilarCommand(),
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
    ...tableCommands(),
    wipeoutCommand(),
    ...hatchCommands(),
    toleranceCommand(),
    ...DRAW_ORDER_COMMANDS.map((make) => make()),
    ...MLEADER_COMMANDS.map((make) => make()),
    ...MLEADER_ALIGN_COMMANDS.map((make) => make()),
    ...TEXT_TOOL_COMMANDS.map((make) => make()),
    updateFieldCommand(),
    fieldCommand(),
    ...FIND_COMMANDS.map((make) => make()),
    ...SPELL_COMMANDS.map((make) => make()),
    ...dimensionCommands(),
    ...moreDimensionCommands(),
    qdimCommand(),
    ...dimensionEditCommands(),
    ...dimensionAssociateCommands(),
    ...dimensionBreakCommands(),
    ...centerMarkCommands(),
    ...ATTRIBUTE_COMMANDS.map((make) => make()),
    ...FILE_COMMANDS.map((make) => make()),
    ...CLIPBOARD_COMMANDS.map((make) => make()),
    ...BLOCK_COMMANDS.map((make) => make()),
    ...BLOCK_EDITOR_COMMANDS.map((make) => make()),
    ...REFEDIT_COMMANDS.map((make) => make()),
    attsyncCommand(),
    attredefCommand(),
    wblockCommand(),
    ...PALETTE_COMMANDS.map((make) => make()),
    ...DESIGN_CENTER_COMMANDS.map((make) => make()),
    ...DRAFTING_SETTINGS_COMMANDS.map((make) => make()),
    ...UNITS_COMMANDS.map((make) => make()),
    dimstyleCommand(),
    styleCommand(),
    dashStyleCommand(),
    tablestyleCommand(),
    mleaderstyleCommand(),
    dashDimstyleCommand(),
    ...SNAP_GRID_COMMANDS.map((make) => make()),
    ...UCS_COMMANDS.map((make) => make()),
    mviewCommand(),
    mspaceCommand(),
    pspaceCommand(),
    vpclipCommand(),
    vplayerCommand(),
    underlayLayersCommand(),
    ...layerToolCommands(),
    laydelCommand(),
    purgeCommand(),
    laymrgCommand(),
    laywalkCommand(),
    layerpCommand(),
    layerpmodeCommand(),
    layerCommand(),
    layerCloseCommand(),
    layerStateCommand(),
    layoutCommand(),
    ...XREF_COMMANDS.map((make) => make()),
    xclipCommand(),
    imageclipCommand(),
    imageattachCommand(),
    pdfattachCommand(),
    pdfclipCommand(),
    pdfadjustCommand(),
    attdefCommand(),
    attdispCommand(),
    battmanCommand(),
    xattachCommand(),
    xbindCommand(),
    linetypeCommand(),
    ltscaleCommand(),
    lweightCommand(),
    imageadjustCommand(),
    imageadjustDashCommand(),
    imagequalityCommand(),
    ...INQUIRY_COMMANDS.map((make) => make()),
    ...ARRAY_COMMANDS.map((make) => make()),
    ...GROUP_COMMANDS.map((make) => make()),
    // UNDO, U, REDO and OOPS (M2-05) keep no state of their own: the bus's history holds it.
    ...UNDO_COMMANDS,
  ]);
}
