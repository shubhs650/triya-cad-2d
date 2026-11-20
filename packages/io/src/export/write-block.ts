// WBLOCK's new drawing (M5-01 part 4, AutoCAD 2024 Help "WBLOCK (Command)"): the objects written
// go into the model space of a drawing that starts blank, their base point at its origin.
//
// The blank drawing is acad-ts's own new document (layer 0, the Standard styles, model space and
// a layout), written as an AC1032 DXF; the objects are then pasted into it as PASTECLIP pastes
// into another drawing (records matched by name, new handles above its $HANDSEED) and the result
// saved as every save is (`saveSession`): the change replayed onto a fresh read of that blank
// file, so the new drawing is written from an acad-ts original like any other (ARCHITECTURE.md
// §6.1), never rebuilt from Triya's model alone.
//
// LAYOUT SAveas (M6-01 part 4) writes its template the same way: the blank drawing's layout takes
// the layout saved (its name, page setup, limits and flags) and its sheet the layout's objects,
// its viewports with them, so the template has that one layout, as AutoCAD's has.
import {
  BlockRecord,
  CadDictionary,
  CadDocument,
  DimensionStyle,
  LineType,
  MultiLeaderStyle,
  TextStyle,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  insertLayoutTemplate,
  paperLayouts,
  pasteObjects,
  type ChangeSet,
  type Clipboard,
  type HeaderValue,
  type LayoutTemplate,
} from '@triya/engine';
import { documentInit } from '../map/document';
import { readCadDocument } from '../read';
import { writeCadDocument } from '../write';
import { SAVE_VERSION, saveSession } from './save';

/**
 * A blank AC1032 DXF: acad-ts's new document, nothing drawn, with what AutoCAD's own blank
 * drawings hold beside its tables: the Standard multiline style (two lines 0.5 either side)
 * the default materials and the Standard multileader style, and the Standard dimension style's DIMFIT 3 (AutoCAD's default;
 * acad-ts starts it at 0), so that objects from AutoCAD drawings match them by name.
 */
export function blankDrawing(layouts = false): Uint8Array {
  const doc = new CadDocument(SAVE_VERSION);
  doc.updateCollections(true, true);
  // LAYOUT SAveas (M6-01 part 4): the Model and Layout1 LAYOUTs AutoCAD's blank drawings have,
  // which acad-ts makes with its space records but files nowhere.
  if (layouts) {
    for (const r of [BlockRecord.modelSpaceName, BlockRecord.paperSpaceName]) {
      const layout = doc.blockRecords?.get(r)?.layout;
      if (!layout || doc.layouts?.containsKey(layout.name)) continue;
      layout.tabOrder = r === BlockRecord.paperSpaceName ? 1 : 0;
      doc.layouts?.add(layout);
    }
  }
  const standard = doc.dimensionStyles?.get(DimensionStyle.defaultName);
  if (standard) standard.dimensionFit = 3;
  // AutoCAD's Standard multileader style: ByBlock leader lines, Standard text.
  const styles = doc.rootDictionary?.getEntry(CadDictionary.acadMLeaderStyle);
  if (styles instanceof CadDictionary && !styles.containsKey(MultiLeaderStyle.defaultName)) {
    const ml = new MultiLeaderStyle(MultiLeaderStyle.defaultName);
    styles.add(ml);
    ml.leaderLineType = doc.lineTypes?.get(LineType.byBlockName) ?? null;
    ml.textStyle = doc.textStyles?.get(TextStyle.defaultName) ?? null;
  }
  return writeCadDocument(doc, { format: 'dxf' });
}

/**
 * A new AC1032 DXF holding `content`'s objects in model space, its base point at the origin and
 * unscaled whatever its units, with `header`'s variables set, and `layout` (LAYOUT SAveas) as
 * its layout.
 */
export function writeBlockDrawing(
  content: Clipboard,
  header: Readonly<Record<string, HeaderValue>> = {},
  layout?: LayoutTemplate,
): Uint8Array {
  const bytes = blankDrawing(layout !== undefined);
  const model = DocumentModel.create(documentInit(readCadDocument(bytes, 'dxf')));
  let space: string | undefined;
  for (const r of model.tables.blockRecords.values()) {
    if (r.name.toUpperCase() === '*MODEL_SPACE') space = r.handle;
  }
  if (space === undefined) throw new Error('the blank drawing has no model space');
  // Written as they are: a paste scales by the units only between drawings that both have them.
  const { insUnits: _units, ...unscaled } = content;
  const changes: ChangeSet[] = [];
  // SAveas's layout takes what it lacks from the drawing's units (a paper of no size: the units'
  // own sheet, layout-templates.ts), so they are set first.
  if (layout) {
    const h = new ChangeSetBuilder(model);
    for (const [key, value] of Object.entries(header)) h.setHeader(key, value);
    const set = h.build();
    model.apply(set);
    changes.push(set);
  }
  const b = new ChangeSetBuilder(model);
  pasteObjects(b, model, unscaled, space, { x: 0, y: 0 });
  if (layout) {
    const [blank] = paperLayouts(model);
    if (!blank) throw new Error('the blank drawing has no layout');
    insertLayoutTemplate(b, model, layout, layout.name, blank);
  } else {
    for (const [key, value] of Object.entries(header)) b.setHeader(key, value);
  }
  changes.push(b.build());
  return saveSession(bytes, changes, 'dxf');
}
