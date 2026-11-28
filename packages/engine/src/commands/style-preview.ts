// The Text Style and Multileader Style dialogs' preview images (M4-14), drawn as M4-03 part 3
// draws the Dimension Style Manager's: a small drawing of its own (`previewDrawing`: the source
// drawing's tables, an empty model space, layer 0 made plain) that the renderer draws.
//
// - Text Style (AutoCAD 2024 Help, "Text Style Dialog Box", Preview: "Displays sample text that
//   changes dynamically as you change fonts and modify the effects"): the sample "AaBb123" as a
//   TEXT in a style holding the dialog's font, big font, width factor, oblique angle, backwards,
//   upside down and vertical, at the style's height (1 when the height is asked for as text is
//   placed; the picture is fitted to what it draws either way).
// - Insert (M5-01 part 3; AutoCAD Help, "Insert Dialog Box"): a reference to the block at its
//   base point, unscaled and unturned, the blocks it nests copied with it.
// - The library palette (M8-03): a block the drawing does not have yet, pasted into the preview
//   drawing as DesignCenter's Add pastes it and inserted as Insert's is.
// - Multileader Style (AutoCAD 2024 Help, "Multileader Style Manager", Preview of: "Displays a
//   preview image of the style that is selected in the Styles list", and "Modify Multileader
//   Style Dialog Box": the image shows the settings as they are made): one multileader in a style
//   holding the dialog's settings, its leader rising from the arrowhead at the lower left to the
//   landing, with "Default Text" (the style's default text where it has one), the style's block
//   or no content, as MLEADER would place it. The sample is ours, sized from the style's text
//   height; an arrowhead or built-in block first chosen in the dialog is added to the preview
//   only, as OK adds it to the drawing.
import type { Vec2 } from '../geom/types';
import { ChangeSetBuilder } from '../model/builder';
import { pasteDefinitions, type Clipboard } from '../edit/clipboard';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  InsertGeometry,
  MLeaderStyleRecord,
  MultiLeaderGeometry,
  TextGeometry,
} from '../model/types';
import type { MLeaderStyleSettings } from '../annotation/mleaderstyle-fields';
import { plainLayerZero, previewDrawing } from '../edit/dimstyle-preview';
import {
  MLEADER_BLOCK,
  MLEADER_MTEXT,
  blockAnchor,
  blockExtentsOf,
  blockScaleOf,
  landingAt,
  newMultiLeader,
  settingsOf,
  textAnchor,
} from '../edit/mleader';
import { currentTextStyle } from './draw/text';
import { attributeDefaults } from '../properties/multileader-block';
import { recordFields, type TextStyleSettings } from './textstyle';
import { addStyle } from './mleaderstyle';

/** What a style dialog's preview shows. */
export type StylePreview =
  | {
      readonly kind: 'textstyle';
      /** The Text Style dialog's fields as they stand. */
      readonly settings: TextStyleSettings;
    }
  | {
      readonly kind: 'mleaderstyle';
      /** The Multileader Style dialog's fields (or a listed style's) as they stand. */
      readonly settings: MLeaderStyleSettings;
      /** The style they were read from, whose fields the dialog does not show are kept. */
      readonly from?: string;
    }
  | {
      /**
       * The Insert dialog's preview of a block (M5-01 part 3; AutoCAD Help, "Insert Dialog Box":
       * "Displays a preview of the specified block to insert"): a reference to it, unscaled.
       */
      readonly kind: 'block';
      readonly block: Handle;
    }
  | {
      /**
       * The library palette's preview (M8-03): block `block` as `content` carries it (copied out
       * as DesignCenter copies a block), not yet in the drawing, inserted unscaled.
       */
      readonly kind: 'library';
      readonly block: string;
      readonly content: Clipboard;
    };

/** A reference to `block` at `position`, unscaled and unturned. */
const unscaled = (block: Handle, position: Vec2): InsertGeometry => ({
  kind: 'INSERT',
  block,
  position,
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

/** The sample text, AutoCAD's own words for it. */
export const TEXT_STYLE_SAMPLE = 'AaBb123';
/** The multileader's text when its style states none. */
export const MLEADER_STYLE_SAMPLE = 'Default Text';
/** The name the dialog's settings take in the preview drawing: no record can be named it. */
const PREVIEW = '*PREVIEW';

const upper = (s: string) => s.toUpperCase();

/**
 * The preview drawing for `preview` over `model`'s tables, its sample in model space; undefined
 * when there is nothing to show it with (no model space or layer 0, a multileader style without
 * a text style to name).
 */
export function stylePreviewModel(
  model: DocumentModel,
  preview: StylePreview,
): DocumentModel | undefined {
  const keep = new Set<Handle>();
  if (preview.kind === 'block') {
    if (!model.blocks.has(preview.block)) return undefined;
    nestedBlocks(model, preview.block, keep);
  }
  if (preview.kind === 'mleaderstyle') {
    for (const h of [preview.settings.arrowhead, preview.settings.block])
      if (model.blocks.has(h as Handle)) keep.add(h as Handle);
  }
  const pm = previewDrawing(model, keep);
  if (!pm) return undefined;
  const space = [...pm.tables.blockRecords.values()].find(
    (r) => upper(r.name) === '*MODEL_SPACE',
  )!.handle;
  const b = new ChangeSetBuilder(pm);
  const layer = plainLayerZero(b, pm);
  if (layer === undefined) return undefined;
  if (preview.kind === 'textstyle') {
    b.addEntity({ owner: space, layer, geom: textSample(b, preview.settings) });
    pm.apply(b.build());
    return pm;
  }
  if (preview.kind === 'library') {
    pasteDefinitions(b, pm, preview.content);
    pm.apply(b.build());
    const name = upper(preview.block);
    const def = [...pm.blocks.values()].find((d) => upper(d.name) === name);
    if (!def) return undefined;
    const placed = new ChangeSetBuilder(pm);
    placed.addEntity({ owner: space, layer, geom: unscaled(def.handle, def.basePoint) });
    pm.apply(placed.build());
    return pm;
  }
  if (preview.kind === 'block') {
    const geom: InsertGeometry = {
      kind: 'INSERT',
      block: preview.block,
      position: pm.blocks.get(preview.block)!.basePoint,
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [],
    };
    b.addEntity({ owner: space, layer, geom });
    pm.apply(b.build());
    return pm;
  }
  // The style first, with the blocks it adds, so that its content block can be measured.
  const style = mleaderStyle(b, pm, preview.settings, preview.from);
  if (!style) return undefined;
  pm.apply(b.build());
  const e = new ChangeSetBuilder(pm);
  e.addEntity({ owner: space, layer, geom: mleaderSample(pm, style) });
  pm.apply(e.build());
  return pm;
}

/**
 * `block` and every block its objects name (nested references, a dimension's block,
 * arrowheads), added to `out`: what a preview drawing needs to draw it.
 */
function nestedBlocks(model: DocumentModel, block: Handle, out: Set<Handle>): void {
  if (out.has(block)) return;
  out.add(block);
  for (const id of model.blockEntities(block)) {
    const g = model.entity(id)?.geom;
    if (!g) continue;
    for (const v of Object.values(g))
      if (typeof v === 'string' && model.blocks.has(v as Handle))
        nestedBlocks(model, v as Handle, out);
  }
}

/** "AaBb123" in a style of the dialog's settings. */
function textSample(b: ChangeSetBuilder, s: TextStyleSettings): TextGeometry {
  const { bigFont, ...fields } = recordFields(s, undefined);
  const style = b.addTableRecord('textStyles', {
    name: PREVIEW,
    ...fields,
    ...(bigFont !== undefined && { bigFont }),
    lastHeight: 1,
  });
  return {
    kind: 'TEXT',
    value: TEXT_STYLE_SAMPLE,
    style: style.handle,
    position: { x: 0, y: 0 },
    height: s.height > 0 ? s.height : 1,
    rotation: 0,
    widthFactor: style.widthFactor,
    oblique: style.obliqueAngle,
    halign: 0,
    valign: 0,
    backward: s.backwards,
    upsideDown: s.upsideDown,
  };
}

/** A style of the dialog's settings, over the one they were read from where there is one. */
function mleaderStyle(
  b: ChangeSetBuilder,
  pm: DocumentModel,
  s: MLeaderStyleSettings,
  from: string | undefined,
): MLeaderStyleRecord | undefined {
  // A multileader style names a text style (an R1 or R2.5 drawing has none).
  const textStyle = s.textStyle !== '' ? s.textStyle : currentTextStyle(pm)?.handle;
  if (textStyle === undefined || !pm.tables.textStyles.has(textStyle)) return undefined;
  const base = [...pm.tables.mleaderStyles.values()].find(
    (x) => from !== undefined && upper(x.name) === upper(from),
  );
  return addStyle(b, pm, PREVIEW, { ...s, textStyle }, base);
}

/** One multileader in `style`, as MLEADER places it from the arrowhead to the landing. */
function mleaderSample(pm: DocumentModel, style: MLeaderStyleRecord): MultiLeaderGeometry {
  const scale = style.scale > 0 ? style.scale : 1;
  // The sample's unit: the text as tall as it is drawn.
  const u = style.textHeight * scale;
  const vertices: Vec2[] = [{ x: 0, y: 0 }];
  // A leader of more than two points bends once on its way, as AutoCAD's sample does.
  if (style.maxLeaderPoints === 0 || style.maxLeaderPoints > 2)
    vertices.push({ x: 2 * u, y: 2 * u });
  const landing = landingAt(vertices.at(-1)!, { x: 4 * u, y: 3 * u }, style, style.dogleg, scale);
  const settings = { ...settingsOf(style), landing: style.dogleg };
  const made = { style, vertices, landing, scale };
  if (style.contentType === MLEADER_MTEXT) {
    return newMultiLeader({
      ...made,
      settings,
      text: {
        content: style.defaultText !== '' ? style.defaultText : MLEADER_STYLE_SAMPLE,
        style: style.textStyle!,
        ...textAnchor(style, landing, scale),
        width: 0,
      },
    });
  }
  if (style.contentType === MLEADER_BLOCK && style.block !== undefined) {
    const placed = blockScaleOf(style, scale);
    const extents = blockExtentsOf(pm, style.block);
    const position = blockAnchor(style, landing, extents, placed.scale, placed.rotation);
    const attributes = attributeDefaults(pm, style.block);
    return newMultiLeader({
      ...made,
      settings,
      block: { block: style.block, position, attributes },
    });
  }
  return newMultiLeader({ ...made, settings: { ...settings, contentType: 0 } });
}
