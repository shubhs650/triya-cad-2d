// M6-03: the current annotation scale (CANNOSCALE naming one of the drawing's ACAD_SCALELIST
// scales) and which annotative objects support it, as ANNOALLVISIBLE 0 hides those that do not
// (AutoCAD 2024 Help, "ANNOALLVISIBLE (System Variable)": "Hides or displays annotative objects
// that do not support the current annotation scale"; 0 "Only annotative objects that support the
// current annotation scale are displayed", 1 "All annotative objects are displayed").
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  annotationHidden,
  currentAnnotationScale,
  supportsAnnotationScale,
  type DocumentInit,
  type EntityInit,
} from '../../src/index';
import { entityInit, lineGeom, sampleInit } from '../model/fixtures';

const SCALES = [
  { name: '1:1', value: 1, handle: 'B7' },
  { name: '1:50', value: 0.02, handle: '12D' },
  { name: '1:100', value: 0.01, handle: '12E' },
];

/** SCALE objects of a scale list (M6-02 part 21), `value` paper units to one drawing unit. */
const scaleObjects = (
  scales: readonly { name: string; value: number; handle?: string }[],
  first = 0xa00,
) =>
  scales.map((s, i) => ({
    type: 'SCALE' as const,
    handle: s.handle ?? (first + i).toString(16).toUpperCase(),
    owner: '9F0',
    key: `A${i}`,
    name: s.name,
    paperUnits: s.value,
    drawingUnits: 1,
    unitScale: false,
  }));

function init(cannoscale: string | undefined, entities: EntityInit[] = []): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([
      ...(base.header ?? []),
      ...(cannoscale === undefined ? [] : [['CANNOSCALE', cannoscale] as const]),
    ]),
    objects: [...(base.objects ?? []), ...scaleObjects(SCALES)],
    entities: [...(base.entities ?? []), ...entities],
  };
}

/** An annotative line whose representations name `scales` (undefined: one Triya does not read). */
const annotative = (handle: string, scales: (string | undefined)[]): EntityInit =>
  entityInit(handle, lineGeom(0, 0, 10, 0), {
    annotative: {
      representations: scales.map((scale, i) => ({
        handle: `${handle}${i}`,
        ...(scale !== undefined && { scale }),
        isDefault: i === 0,
      })),
    },
  });

describe('the current annotation scale (M6-03)', () => {
  it('is the scale of the list CANNOSCALE names', () => {
    expect(currentAnnotationScale(DocumentModel.create(init('1:50')))).toEqual(SCALES[1]);
    expect(currentAnnotationScale(DocumentModel.create(init('1:100')))?.handle).toBe('12E');
  });

  it('is none for a drawing without CANNOSCALE or whose list lacks it', () => {
    expect(currentAnnotationScale(DocumentModel.create(init(undefined)))).toBeUndefined();
    expect(currentAnnotationScale(DocumentModel.create(init('1:3')))).toBeUndefined();
  });
});

describe('annotative objects and the current scale (M6-03)', () => {
  it('supports a scale one of its representations names', () => {
    expect(supportsAnnotationScale(annotative('A1', ['B7', '12D']), '12D')).toBe(true);
    expect(supportsAnnotationScale(annotative('A1', ['B7', '12D']), '12E')).toBe(false);
  });

  it('cannot say for an object that is not annotative or has a representation Triya does not read', () => {
    expect(supportsAnnotationScale(entityInit('A2', lineGeom(0, 0, 1, 1)), 'B7')).toBeUndefined();
    expect(supportsAnnotationScale(annotative('A3', ['B7', undefined]), '12E')).toBeUndefined();
    // One it reads names the scale: supported, whatever the other holds.
    expect(supportsAnnotationScale(annotative('A3', [undefined, '12E']), '12E')).toBe(true);
  });

  it('hides, with ANNOALLVISIBLE 0, only the annotative objects that do not support the scale', () => {
    const model = DocumentModel.create(
      init('1:50', [
        annotative('A1', ['B7', '12D']),
        annotative('A2', ['B7']),
        annotative('A3', ['B7', undefined]),
        entityInit('A4', lineGeom(0, 0, 1, 1)),
      ]),
    );
    const hidden = (h: string, allVisible: boolean) =>
      annotationHidden(model, model.entityByHandle(h)!, allVisible);
    expect(['A1', 'A2', 'A3', 'A4'].map((h) => hidden(h, false))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    // ANNOALLVISIBLE 1 shows them all.
    expect(['A1', 'A2', 'A3', 'A4'].map((h) => hidden(h, true))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('hides nothing while CANNOSCALE names no scale of the list', () => {
    const model = DocumentModel.create(init('1:3', [annotative('A2', ['B7'])]));
    expect(annotationHidden(model, model.entityByHandle('A2')!, false)).toBe(false);
  });
});
