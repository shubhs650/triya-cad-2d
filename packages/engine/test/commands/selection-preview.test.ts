// M3-04 part 5: which objects the selection preview highlights under the pickbox (AutoCAD 2024
// Help, "SELECTIONPREVIEW (System Variable)", "PREVIEWFILTER (System Variable)"): PREVIEWFILTER
// 1 leaves out objects on locked layers, 2 objects in xrefs, 4 tables, 8 multiline text, 16
// hatches, 32 objects in groups (initially 3); with group selection on (PICKSTYLE 1) a member
// previews with the rest of its selectable groups, as a click would select them.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREVIEWFILTER,
  DEFAULT_SELECTIONPREVIEW,
  DocumentModel,
  PREVIEW_NOT_GROUPED,
  PREVIEW_NOT_HATCHES,
  PREVIEW_NOT_LOCKED,
  PREVIEW_NOT_MTEXT,
  PREVIEW_NOT_TABLES,
  PREVIEW_NOT_XREFS,
  previewObjects,
  type EntityGeometry,
  type EntityId,
  type Group,
} from '../../src/index';
import {
  LAYER_0,
  MODEL_SPACE,
  blockRecord,
  entityInit,
  layer,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const LOCKED = '12';
const XREF = '60';
const DICT = 'A0';

const kind = (k: string): EntityGeometry => ({ kind: k }) as unknown as EntityGeometry;

const GROUPS: Group[] = [
  {
    handle: 'A1',
    type: 'GROUP',
    owner: DICT,
    reactors: [DICT],
    name: 'DOORS',
    description: '',
    selectable: true,
    entities: ['37', '38', '3B'],
  },
  {
    handle: 'A2',
    type: 'GROUP',
    owner: DICT,
    reactors: [DICT],
    name: 'SHUT',
    description: '',
    selectable: false,
    entities: ['39', '38'],
  },
];

/**
 * Line 30 on layer 0 and 31 on the locked layer; an xref INSERT 32 and a plain block's 33; a
 * table 34, an MTEXT 35, a hatch 36; lines 37 and 38 in group DOORS, 39 in the unselectable
 * group SHUT, and 3B in paper space in DOORS too.
 */
function model(): DocumentModel {
  const init = sampleInit();
  return DocumentModel.create({
    ...init,
    meta: { ...init.meta!, groupDictionary: DICT },
    tables: {
      ...init.tables,
      layers: [...(init.tables?.layers ?? []), { ...layer(LOCKED, 'FIXED'), locked: true }],
      blockRecords: [
        ...(init.tables?.blockRecords ?? []),
        blockRecord(XREF, 'SITE'),
        blockRecord('61', 'DOOR'),
      ],
    },
    blocks: [
      ...(init.blocks ?? []),
      { handle: XREF, name: 'SITE', basePoint: { x: 0, y: 0 }, xrefPath: 'site.dwg' },
      { handle: '61', name: 'DOOR', basePoint: { x: 0, y: 0 } },
    ],
    objects: [...(init.objects ?? []), { handle: DICT, type: 'DICTIONARY', owner: 'C' }, ...GROUPS],
    entities: [
      entityInit('30', lineGeom(0, 0, 10, 0)),
      entityInit('31', lineGeom(0, 5, 10, 5), { layer: LOCKED }),
      entityInit('32', {
        kind: 'INSERT',
        block: XREF,
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
      } as EntityGeometry),
      entityInit('33', {
        kind: 'INSERT',
        block: '61',
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
      } as EntityGeometry),
      entityInit('34', kind('ACAD_TABLE')),
      entityInit('35', kind('MTEXT')),
      entityInit('36', kind('HATCH')),
      entityInit('37', lineGeom(0, 10, 10, 10), { reactors: ['A1'] }),
      entityInit('38', lineGeom(0, 15, 10, 15), { reactors: ['A1', 'A2'] }),
      entityInit('39', lineGeom(0, 20, 10, 20), { reactors: ['A2'] }),
      entityInit('3B', lineGeom(1, 1, 2, 2), { owner: '1B', reactors: ['A1'], layer: LAYER_0 }),
    ],
  });
}

describe('previewObjects', () => {
  const m = model();
  const id = (h: string): EntityId => m.ids.idOf(h)!;
  const ids = (...hs: string[]) => hs.map(id);
  const preview = (h: string, filter: number, groups = false) =>
    previewObjects(m, id(h), { filter, groups, space: MODEL_SPACE });

  it("starts at AutoCAD's initial values: SELECTIONPREVIEW 3, PREVIEWFILTER 3", () => {
    expect(DEFAULT_SELECTIONPREVIEW).toBe(3);
    expect(DEFAULT_PREVIEWFILTER).toBe(PREVIEW_NOT_LOCKED | PREVIEW_NOT_XREFS);
  });

  it('previews the object alone when nothing excludes it', () => {
    expect(preview('30', 0)).toEqual(ids('30'));
    expect(preview('30', 63)).toEqual(ids('30'));
  });

  it('leaves out objects on locked layers with bit 1', () => {
    expect(preview('31', DEFAULT_PREVIEWFILTER)).toEqual([]);
    expect(preview('31', 0)).toEqual(ids('31'));
  });

  it('leaves out xrefs with bit 2, not references to the drawing’s own blocks', () => {
    expect(preview('32', PREVIEW_NOT_XREFS)).toEqual([]);
    expect(preview('32', PREVIEW_NOT_LOCKED)).toEqual(ids('32'));
    expect(preview('33', 63 & ~PREVIEW_NOT_GROUPED)).toEqual(ids('33'));
  });

  it('leaves out tables (4), multiline text (8) and hatches (16), each by its own bit', () => {
    expect(preview('34', PREVIEW_NOT_TABLES)).toEqual([]);
    expect(preview('35', PREVIEW_NOT_MTEXT)).toEqual([]);
    expect(preview('36', PREVIEW_NOT_HATCHES)).toEqual([]);
    expect(preview('34', PREVIEW_NOT_MTEXT | PREVIEW_NOT_HATCHES)).toEqual(ids('34'));
    expect(preview('35', PREVIEW_NOT_TABLES | PREVIEW_NOT_HATCHES)).toEqual(ids('35'));
    expect(preview('36', PREVIEW_NOT_TABLES | PREVIEW_NOT_MTEXT)).toEqual(ids('36'));
  });

  it('leaves out an object in any group with bit 32, selectable or not', () => {
    expect(preview('37', PREVIEW_NOT_GROUPED, true)).toEqual([]);
    expect(preview('39', PREVIEW_NOT_GROUPED)).toEqual([]);
    expect(preview('30', PREVIEW_NOT_GROUPED, true)).toEqual(ids('30'));
  });

  it('with group selection on, previews the rest of its selectable groups in the space shown', () => {
    // DOORS holds 37, 38 and 3B (paper space); SHUT is not selectable, so 39 stays out.
    expect(preview('37', 0, true)).toEqual(ids('37', '38'));
    expect(preview('38', 0, true)).toEqual(ids('38', '37'));
    expect(preview('39', 0, true)).toEqual(ids('39'));
    // Group selection off: the object alone.
    expect(preview('37', 0, false)).toEqual(ids('37'));
  });

  it('previews nothing for an object that is gone', () => {
    expect(
      previewObjects(m, 9999 as EntityId, { filter: 0, groups: true, space: MODEL_SPACE }),
    ).toEqual([]);
  });
});
