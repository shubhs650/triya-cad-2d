// The Dimension Style Manager's preview image (M4-03 part 3; AutoCAD 2024 Help, "Dimension Style
// Manager": "Preview of: displays a graphic representation of the style selected in the Styles
// list", and "New, Modify, and Override Dimension Style Dialog Boxes": "the sample image shows
// the effects of each option" as it is set).
//
// The preview is a small drawing of its own: a plate with a slanted edge and a rounded corner,
// dimensioned with a horizontal and a vertical linear dimension, an angle and a radius, drawn by
// the dimension engine and the renderer as any dimension of the drawing is. The sample is ours
// (no AutoCAD picture is copied); like AutoCAD's it is sized from the style's text height, so a
// metric style and an imperial one both read at the size of the box, and the values shown are
// what the style makes of the sample's lengths (units, precision, suffixes, tolerances).
//
// - A style of the drawing (the manager's list) is shown as the drawing draws it: each kind of
//   dimension with the style's sub-style for that kind where it has one (part 2).
// - The DIMVARs a New, Modify or Override dialog holds are shown on a style of their own,
//   without sub-styles, every kind drawn with what the dialog shows.
// - A sub-style (Use for) is shown on its own kind alone: a diameter on a hole, ordinate
//   dimensions from the plate's corner, a leader for "Leaders and Tolerances".
//
// The preview drawing copies the source drawing's tables (text styles and their fonts,
// linetypes, the dimension styles and their sub-styles) and the arrowhead blocks the styles use;
// an arrowhead first chosen in the dialog is added to the preview only, as Modify's OK adds it
// to the drawing. Layer 0 is made plain (on, continuous, the foreground colour) so the drawing's
// layer settings never hide or dash the sample.
import type { Vec2 } from '../geom/types';
import { ChangeSetBuilder } from '../model/builder';
import { DocumentModel, type DocumentInit } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  BlockDefinition,
  DimStyleRecord,
  DimVarValue,
  EntityGeometry,
  EntityInit,
} from '../model/types';
import { DIMSTYLE_REFERENCES, type DimStyleVars } from '../annotation/dimstyle-fields';
import { type DimStyleUse } from '../annotation/dimstyle-family';
import { isDimStyleXdataVar, withDimStyleXdata } from '../annotation/dimstyle-xdata';
import { addArrowheadBlock } from './arrowhead-blocks';
import { newDimension, placeDimension, type DimPlacement } from './dimension';

/** What the preview shows. */
export interface DimStylePreview {
  /** A style of the drawing, by name, drawn as the drawing draws it. */
  readonly style?: string;
  /** Or the DIMVARs a style dialog holds (with its xdata settings), drawn on a style of their own. */
  readonly vars?: DimStyleVars;
  /** The one kind of dimension shown (a sub-style's Use for); absent or `all`, the full sample. */
  readonly use?: DimStyleUse;
  /**
   * The DIMVARs the sample is sized from (a dialog's as it opened), so that changing the text
   * height or DIMSCALE in the dialog shows the text growing on the same sample; absent, the
   * style's own.
   */
  readonly sizedBy?: DimStyleVars;
}

/** The name the dialog's DIMVARs are given in the preview drawing: no style can be named it. */
const PREVIEW_STYLE = '*PREVIEW';
const BLOCK_VARS = ['DIMBLK', 'DIMBLK1', 'DIMBLK2', 'DIMLDRBLK'];
const LINETYPE_VARS = new Set(['DIMLTYPE', 'DIMLTEX1', 'DIMLTEX2']);
/** The size the sample is drawn for when the style gives no text height. */
const FALLBACK_HEIGHT = 0.18;

const upper = (s: string) => s.toUpperCase();
const p = (x: number, y: number): Vec2 => ({ x, y });

/**
 * The preview drawing for `preview` over `model`'s tables, its sample in model space; undefined
 * when there is nothing to show (no model space, or a style the drawing does not have).
 */
export function dimStylePreviewModel(
  model: DocumentModel,
  preview: DimStylePreview,
): DocumentModel | undefined {
  const records = model.tables.blockRecords;
  const modelSpace = [...records.values()].find((r) => upper(r.name) === '*MODEL_SPACE');
  const spaceDef = modelSpace && model.blocks.get(modelSpace.handle);
  if (!modelSpace || !spaceDef) return undefined;
  const named =
    preview.style === undefined
      ? undefined
      : [...model.tables.dimStyles.values()].find((s) => upper(s.name) === upper(preview.style!));
  if (preview.style !== undefined && !named) return undefined;

  // The arrowhead blocks any style (or the dialog) names, with what they hold.
  const arrows = new Set<Handle>();
  const arrowsOf = (vars: Readonly<Record<string, DimVarValue>> | undefined) => {
    for (const n of BLOCK_VARS) {
      const v = vars?.[n];
      if (typeof v === 'string' && model.blocks.has(v)) arrows.add(v);
    }
  };
  for (const s of model.tables.dimStyles.values()) arrowsOf(s.vars);
  arrowsOf(preview.vars);
  const pm = previewDrawing(model, arrows)!;

  const b = new ChangeSetBuilder(pm);
  const zero = plainLayerZero(b, pm);
  if (zero === undefined) return undefined;
  const style = named ?? previewStyle(b, pm, preview.vars ?? {});
  const unit = sampleUnit(pm, preview.sizedBy ?? style.vars);
  const space = modelSpace.handle;
  const add = (geom: EntityGeometry) => b.addEntity({ owner: space, layer: zero, geom });
  for (const geom of sample(style.handle, preview.use ?? 'all', unit)) add(geom);
  pm.apply(b.build());
  return pm;
}

/**
 * A drawing of its own for a style dialog's preview: `model`'s tables and header, an empty model
 * space, and the blocks `keep` names with what they hold (a style's arrowheads and content
 * blocks). Undefined when `model` has no model space.
 */
export function previewDrawing(
  model: DocumentModel,
  keep: ReadonlySet<Handle>,
): DocumentModel | undefined {
  const modelSpace = [...model.tables.blockRecords.values()].find(
    (r) => upper(r.name) === '*MODEL_SPACE',
  );
  const spaceDef = modelSpace && model.blocks.get(modelSpace.handle);
  if (!modelSpace || !spaceDef) return undefined;
  const blocks: BlockDefinition[] = [{ ...spaceDef }];
  const entities: EntityInit[] = [];
  for (const h of keep) {
    const def = model.blocks.get(h);
    if (h === modelSpace.handle || !def) continue;
    blocks.push(def);
    for (const id of model.blockEntities(h)) {
      const { id: _id, ...e } = model.entity(id)!;
      entities.push(e);
    }
  }
  const tables: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(model.tables)) tables[name] = [...table.values()];
  return DocumentModel.create({
    meta: model.meta,
    handSeed: model.handSeed,
    header: model.header,
    tables: tables as NonNullable<DocumentInit['tables']>,
    blocks,
    entities,
  });
}

/** Layer 0 as the preview draws on it: shown, continuous, in the foreground colour. */
export function plainLayerZero(b: ChangeSetBuilder, pm: DocumentModel): Handle | undefined {
  const zero = [...pm.tables.layers.values()].find((l) => l.name === '0');
  if (!zero) return undefined;
  const continuous = [...pm.tables.linetypes.values()].find((l) => upper(l.name) === 'CONTINUOUS');
  b.updateTableRecord('layers', zero.handle, {
    on: true,
    frozen: false,
    color: { kind: 'aci', index: 7 },
    lineweight: 'Default',
    transparency: { alpha: 255 },
    ...(continuous && { linetype: continuous.handle }),
  });
  return zero.handle;
}

/** The dialog's DIMVARs as a style record of the preview drawing. */
function previewStyle(
  b: ChangeSetBuilder,
  pm: DocumentModel,
  edited: DimStyleVars,
): DimStyleRecord {
  const vars: Record<string, DimVarValue> = {};
  const xdata = new Map<string, DimVarValue>();
  const added = new Map<string, Handle | undefined>();
  for (const [name, value] of Object.entries(edited)) {
    if (isDimStyleXdataVar(name)) {
      xdata.set(name, value);
      continue;
    }
    if (!DIMSTYLE_REFERENCES.has(name)) {
      vars[name] = value;
      continue;
    }
    // A reference: a record of the drawing, or an AutoCAD arrowhead first chosen in the dialog.
    if (typeof value !== 'string' || value === '') continue;
    if (name === 'DIMTXSTY') {
      if (pm.tables.textStyles.has(value)) vars[name] = value;
    } else if (LINETYPE_VARS.has(name)) {
      if (pm.tables.linetypes.has(value)) vars[name] = value;
    } else if (pm.blocks.has(value)) vars[name] = value;
    else {
      if (!added.has(value)) added.set(value, addArrowheadBlock(b, pm, value));
      const block = added.get(value);
      if (block !== undefined) vars[name] = block;
    }
  }
  const settings = withDimStyleXdata(b, pm, undefined, xdata);
  return b.addTableRecord('dimStyles', {
    name: PREVIEW_STYLE,
    flags: 0,
    vars,
    ...(settings && { xdata: settings }),
  });
}

/**
 * The sample's unit: the style's text height in the drawing (DIMTXT × DIMSCALE, or its text
 * style's fixed height), as AutoCAD's sample grows with it.
 */
function sampleUnit(pm: DocumentModel, vars: DimStyleVars): number {
  const num = (v: DimVarValue | undefined, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const textStyle = vars.DIMTXSTY;
  const fixed =
    typeof textStyle === 'string' ? (pm.tables.textStyles.get(textStyle)?.height ?? 0) : 0;
  const scale = num(vars.DIMSCALE, 1) || 1;
  const h = fixed > 0 ? fixed : num(vars.DIMTXT, FALLBACK_HEIGHT) * scale;
  return h > 0 ? h : FALLBACK_HEIGHT;
}

/**
 * The sample in units `u`: the plate (0,0)–(9,0)–(9,4), a corner rounded at radius 2 about
 * (7,4), along the top to the slanted edge back to the origin at 60°, and its dimensions.
 */
function sample(style: Handle, use: DimStyleUse, u: number): EntityGeometry[] {
  const q = (x: number, y: number) => p(x * u, y * u);
  const slant = q(6 / Math.tan(Math.PI / 3), 6);
  const corner = q(7, 4);
  const plate: EntityGeometry[] = [
    { kind: 'LINE', start: q(0, 0), end: q(9, 0) },
    { kind: 'LINE', start: q(9, 0), end: q(9, 4) },
    { kind: 'ARC', center: corner, radius: 2 * u, startAngle: 0, endAngle: Math.PI / 2 },
    { kind: 'LINE', start: q(7, 6), end: slant },
    { kind: 'LINE', start: slant, end: q(0, 0) },
  ];
  const base = newDimension(style);
  const dim = (placement: DimPlacement, at: Vec2): EntityGeometry[] => {
    const g = placeDimension(placement, at);
    return g ? [g] : [];
  };
  const out45 = (r: number) => p(corner.x + r * u * Math.SQRT1_2, corner.y + r * u * Math.SQRT1_2);
  const linear = [
    ...dim({ kind: 'linear', first: q(0, 0), second: q(9, 0), rotation: 0, base }, q(4.5, -3)),
    ...dim(
      { kind: 'linear', first: q(9, 0), second: q(9, 4), rotation: Math.PI / 2, base },
      q(12, 2),
    ),
  ];
  const angular = dim(
    { kind: 'angular', line1: [q(0, 0), q(9, 0)], line2: [q(0, 0), slant], base },
    p(4.5 * u * Math.cos(Math.PI / 6), 4.5 * u * Math.sin(Math.PI / 6)),
  );
  const radius = dim({ kind: 'radius', center: corner, radius: 2 * u, base }, out45(4.5));
  switch (use) {
    case 'linear':
      return [...plate, ...linear];
    case 'angular':
      return [...plate, ...angular];
    case 'radius':
      return [...plate, ...radius];
    case 'diameter': {
      // A hole through the plate, dimensioned across.
      const hole = { center: q(4.5, 2.5), radius: 1.5 * u };
      const at = p(hole.center.x + 4 * u * Math.SQRT1_2, hole.center.y + 4 * u * Math.SQRT1_2);
      return [
        ...plate,
        { kind: 'CIRCLE', ...hole },
        ...dim({ kind: 'diameter', ...hole, base }, at),
      ];
    }
    case 'ordinate': {
      const ucs = { origin: q(0, 0), angle: 0 };
      return [
        ...plate,
        ...dim({ kind: 'ordinate', feature: q(9, 0), ucs, axis: 'x', base }, q(9, -3)),
        ...dim({ kind: 'ordinate', feature: q(9, 4), ucs, axis: 'y', base }, q(12, 4)),
      ];
    }
    case 'leader':
      return [
        ...plate,
        {
          kind: 'LEADER',
          style,
          vertices: [q(9, 2), q(11, 4), q(13, 4)],
          arrowhead: true,
          spline: false,
          creationType: 3,
          textHeight: 0,
          textWidth: 0,
          horizontalDirection: p(1, 0),
          blockOffset: p(0, 0),
          annotationOffset: p(0, 0),
        },
      ];
    case 'all':
      return [...plate, ...linear, ...angular, ...radius];
  }
}
