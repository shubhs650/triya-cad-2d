// M5-19 part 3: LAYEREVAL 2 evaluates the drawing's own new layers too (AutoCAD 2024 Help,
// "LAYEREVAL": 2 "Detects when new layers have been added in the drawing and xrefs"; "About
// Receiving Notification of New Layers": "New layers might be added when you attach external
// references or insert blocks"). A layer another drawing brings in (PASTECLIP, PASTEBLOCK, INSERT
// of a drawing, DesignCenter) is unreconciled; one the drafter makes is not. LAYEREVALCTL 0 (per
// user) turns the evaluation off whatever LAYEREVAL says.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  LAYEREVALCTL,
  addDesignCenterItem,
  blockFromClipboard,
  copyToClipboard,
  designCenterItem,
  drawingContent,
  layerEvaluation,
  pasteAsBlock,
  pasteObjects,
  type Clipboard,
  type DocumentInit,
  type HeaderValue,
} from '../../src/index';
import { MODEL_SPACE, entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';

// What the app keeps arrives through postMessage (engine tests have no DOM or Node types).
declare function structuredClone<T>(value: T): T;

/** The other drawing: layers 0, WALLS (the target has it), DOORS and GLASS (flagged there). */
function sourceInit(): DocumentInit {
  const s = sampleInit();
  return {
    ...s,
    tables: {
      ...s.tables,
      layers: [
        layer('10', '0'),
        layer('11', 'WALLS'),
        layer('12', 'DOORS'),
        { ...layer('13', 'GLASS'), unreconciled: true },
      ],
    },
    entities: [
      entityInit('30', lineGeom(0, 0, 10, 0), { layer: '11' }),
      entityInit('31', lineGeom(0, 1, 10, 1), { layer: '12' }),
      entityInit('32', lineGeom(0, 2, 10, 2), { layer: '13' }),
    ],
  };
}

/** The drawing pasted into (layers 0 and WALLS), LAYEREVAL `evaluate`, LAYEREVALCTL `ctl`. */
function target(evaluate?: string, ctl?: 0): DocumentModel {
  const s = sampleInit();
  return DocumentModel.create({
    ...s,
    header: new Map<string, HeaderValue>([
      ...(s.header ?? []),
      ...(evaluate === undefined ? [] : ([['LAYEREVAL', evaluate]] as const)),
      ...(ctl === undefined ? [] : ([[LAYEREVALCTL, ctl]] as const)),
    ]),
  });
}

function clipboard(): Clipboard {
  const source = DocumentModel.create(sourceInit());
  const ids = ['30', '31', '32'].map((h) => source.entityByHandle(h)!.id);
  return structuredClone(copyToClipboard(source, ids, { x: 0, y: 0 }).clipboard);
}

const unreconciled = (model: DocumentModel) =>
  [...model.tables.layers.values()]
    .filter((l) => l.unreconciled)
    .map((l) => l.name)
    .sort();

function paste(model: DocumentModel): void {
  const b = new ChangeSetBuilder(model);
  pasteObjects(b, model, clipboard(), MODEL_SPACE, { x: 100, y: 0 });
  model.apply(b.build());
}

describe('layerEvaluation (M5-19 part 3)', () => {
  it("is the drawing's LAYEREVAL, 0 while LAYEREVALCTL is 0", () => {
    expect(layerEvaluation(target())).toBe(0);
    expect(layerEvaluation(target('1'))).toBe(1);
    expect(layerEvaluation(target('2'))).toBe(2);
    expect(layerEvaluation(target('2', 0))).toBe(0);
  });
});

describe('a paste under LAYEREVAL 2 flags the layers it adds (M5-19 part 3)', () => {
  it('PASTECLIP flags the layers new to the drawing, not those it has', () => {
    const model = target('2');
    paste(model);
    expect(unreconciled(model)).toEqual(['DOORS', 'GLASS']);
  });

  it("flags none under LAYEREVAL 0 or 1, the source's own flag left behind", () => {
    for (const evaluate of [undefined, '0', '1']) {
      const model = target(evaluate);
      paste(model);
      expect(unreconciled(model)).toEqual([]);
    }
  });

  it('flags none while LAYEREVALCTL is 0', () => {
    const model = target('2', 0);
    paste(model);
    expect(unreconciled(model)).toEqual([]);
  });

  it('PASTEBLOCK flags the layers its block brings', () => {
    const model = target('2');
    const b = new ChangeSetBuilder(model);
    pasteAsBlock(b, model, clipboard(), MODEL_SPACE, '10', { x: 0, y: 0 });
    model.apply(b.build());
    expect(unreconciled(model)).toEqual(['DOORS', 'GLASS']);
  });

  it('INSERT of a drawing flags the layers the drawing brings', () => {
    const model = target('2');
    const content = structuredClone(drawingContent(DocumentModel.create(sourceInit())).clipboard);
    const b = new ChangeSetBuilder(model);
    blockFromClipboard(b, model, content, 'PLAN');
    model.apply(b.build());
    expect(unreconciled(model)).toEqual(['DOORS', 'GLASS']);
  });

  it('a layer DesignCenter adds is flagged', () => {
    const model = target('2');
    const item = designCenterItem(DocumentModel.create(sourceInit()), 'layers', 'DOORS')!;
    const b = new ChangeSetBuilder(model);
    expect(addDesignCenterItem(b, model, structuredClone(item))).toBe(true);
    model.apply(b.build());
    expect(unreconciled(model)).toEqual(['DOORS']);
  });
});
