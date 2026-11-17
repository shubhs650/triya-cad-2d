// M4-10 part 3: fields updated as the drawing is opened, saved and plotted (AutoCAD 2024 Help,
// "FIELDEVAL (System Variable)": 1 on open, 2 on save, 4 on plot, 8 eTransmit, 16 regeneration;
// initially 31). A field is evaluated on an event only when FIELDEVAL and its own options (the
// FIELD's DXF 91) both have the event's bit; a Date field is AutoCAD's on demand only (32).
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  EngineSession,
  FIELDEVAL,
  fieldEval,
  fieldEventChange,
  fieldOfText,
  type DrawingField,
  type HeaderValue,
  type InsertGeometry,
  type MTextGeometry,
  type TextGeometry,
} from '../../src/index';
import { LAYER_0, MODEL_SPACE, PAPER_SPACE, entityInit, sampleInit } from '../model/fixtures';

const NOW = new Date(2026, 10, 16, 9, 30);

const child = (code: string, value: string, options?: number): DrawingField => ({
  evaluator: 'AcVar',
  code,
  children: [],
  objects: [],
  value,
  ...(options === undefined ? {} : { options }),
});

const root = (code: string, ...children: DrawingField[]): DrawingField => ({
  evaluator: '_text',
  code,
  children,
  objects: [],
});

const text = (value: string, field: DrawingField): TextGeometry => ({
  kind: 'TEXT',
  value,
  field,
  style: '0',
  position: { x: 0, y: 0 },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});

const mtext = (contents: string, field: DrawingField): MTextGeometry => ({
  kind: 'MTEXT',
  contents,
  field,
  style: '0',
  position: { x: 0, y: 20 },
  height: 2.5,
  width: 0,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
});

/** A title block's fields: the file, today's date (on demand), the plot and save dates. */
function drawing(header: [string, HeaderValue][] = []) {
  const base = sampleInit();
  return DocumentModel.create({
    ...base,
    header: new Map([...(base.header ?? []), ...header]),
    entities: [
      ...base.entities!,
      entityInit(
        '60',
        mtext(
          'FILE: Old.dxf\\PDATE: 1/1/2020',
          root(
            'FILE: %<\\_FldIdx 0>%\\PDATE: %<\\_FldIdx 1>%',
            child('\\AcVar Filename \\f "%fn6"', 'Old.dxf'),
            child('\\AcVar Date \\f "M/d/yyyy"', '1/1/2020', 32),
          ),
        ),
        { owner: PAPER_SPACE },
      ),
      entityInit(
        '61',
        text('PLOTTED ----', root('PLOTTED %<\\_FldIdx 0>%', child('\\AcVar PlotDate', ''))),
      ),
      entityInit(
        '62',
        text(
          'SAVED 2020',
          root('SAVED %<\\_FldIdx 0>%', child('\\AcVar SaveDate \\f "yyyy"', '2020')),
        ),
      ),
      entityInit('63', {
        kind: 'INSERT',
        block: MODEL_SPACE,
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [
          {
            handle: '64',
            layer: LAYER_0,
            color: { kind: 'byLayer' },
            linetype: 'ByLayer',
            lineweight: 'ByLayer',
            transparency: 'ByLayer',
            ltScale: 1,
            visible: true,
            ...text('Old', root('%<\\_FldIdx 0>%', child('\\AcVar Filename \\f "%fn2"', 'Old'))),
            tag: 'NAME',
            flags: 0,
          },
        ],
      } satisfies InsertGeometry),
    ],
  });
}

const base = (model: DocumentModel) => ({ model, now: NOW, fileName: 'Plan.dxf', folder: '' });

function geomOf<T>(model: DocumentModel, handle: string): T {
  return model.entityByHandle(handle)!.geom as T;
}

describe('FIELDEVAL', () => {
  it('is the drawing’s DICTIONARYVAR, or AutoCAD’s initial 31', () => {
    expect(fieldEval(drawing())).toBe(31);
    expect(fieldEval(drawing([[FIELDEVAL, '5']]))).toBe(5);
    expect(fieldEval(drawing([[FIELDEVAL, 'junk']]))).toBe(31);
  });

  it('updates the fields on open, leaving a Date field and PlotDate as they were', () => {
    const model = drawing();
    const change = fieldEventChange(base(model), 'open')!;
    expect(change).toBeDefined();
    model.apply(change);
    const m = geomOf<MTextGeometry>(model, '60');
    expect(m.contents).toBe('FILE: Plan.dxf\\PDATE: 1/1/2020');
    expect(m.field!.children.map((c) => c.value)).toEqual(['Plan.dxf', '1/1/2020']);
    // Plot dates change only on a plot; a block reference's attributes update too.
    expect(geomOf<TextGeometry>(model, '61').value).toBe('PLOTTED ----');
    expect(geomOf<InsertGeometry>(model, '63').attributes[0]!.value).toBe('Plan');
    // Nothing left to update: no change.
    expect(fieldEventChange(base(model), 'open')).toBeUndefined();
  });

  it('takes the save’s time for SaveDate and the plot’s for PlotDate', () => {
    const model = drawing();
    model.apply(fieldEventChange(base(model), 'save')!);
    expect(geomOf<TextGeometry>(model, '62').value).toBe('SAVED 2026');
    expect(geomOf<TextGeometry>(model, '61').value).toBe('PLOTTED ----');
    model.apply(fieldEventChange(base(model), 'plot')!);
    expect(geomOf<TextGeometry>(model, '61').value).toBe('PLOTTED 11/16/2026');
  });

  it('updates nothing on an event FIELDEVAL leaves out, or one a field’s options do', () => {
    expect(fieldEventChange(base(drawing([[FIELDEVAL, '0']])), 'open')).toBeUndefined();
    const saveOnly = drawing([[FIELDEVAL, '2']]);
    expect(fieldEventChange(base(saveOnly), 'open')).toBeUndefined();
    expect(fieldEventChange(base(saveOnly), 'plot')).toBeUndefined();
    expect(fieldEventChange(base(saveOnly), 'save')).toBeDefined();
    // A Filename field that may be evaluated on save only (DXF 91 = 2).
    const model = drawing();
    const g = geomOf<MTextGeometry>(model, '60');
    const field = { ...g.field!, children: [{ ...g.field!.children[0]!, options: 2 }] };
    const b = new ChangeSetBuilder(model);
    b.updateEntity(model.entityByHandle('60')!.id, { geom: { ...g, field } });
    model.apply(b.build());
    model.apply(fieldEventChange(base(model), 'open') ?? {});
    expect(geomOf<MTextGeometry>(model, '60').contents).toBe('FILE: Old.dxf\\PDATE: 1/1/2020');
  });

  it('gives a new Date field AutoCAD’s on-demand options, others none (all)', () => {
    expect(fieldOfText('%<\\AcVar Date \\f "M/d/yyyy">%')!.children[0]!.options).toBe(32);
    expect(fieldOfText('%<\\AcVar Filename>%')!.children[0]!.options).toBeUndefined();
    expect(fieldOfText('%<\\AcVar SaveDate>%')!.children[0]!.options).toBeUndefined();
  });

  it('is an engine edit that is no undo step', () => {
    const s = new EngineSession({
      ...sampleInit(),
      entities: [
        ...sampleInit().entities!,
        entityInit(
          '70',
          text('Old', root('%<\\_FldIdx 0>%', child('\\AcVar Filename \\f "%fn2"', 'Old'))),
        ),
      ],
    });
    const r = s.edit({ kind: 'fields', event: 'open', now: NOW.getTime(), fileName: 'Plan.dxf' });
    expect(r.ok && Object.keys(r.change)).toEqual(['entities']);
    expect(geomOf<TextGeometry>(s.model, '70').value).toBe('Plan');
    expect(s.undoState.undoable).toBe(0);
    const again = s.edit({
      kind: 'fields',
      event: 'open',
      now: NOW.getTime(),
      fileName: 'Plan.dxf',
    });
    expect(again).toEqual({ ok: true, change: {} });
  });
});
