// M5-19 part 4: the alert LAYERNOTIFY asks for (AutoCAD 2024 Help, "LAYERNOTIFY": "Specifies
// when an alert displays for new layers that have not yet been reconciled"; bits 1 Plot, 2 Open,
// 4 Load/Reload/Attach for xrefs, 8 Restore layer state, 16 Save, 32 Insert). It shows only while
// layers are evaluated (LAYEREVAL 1 or 2, LAYEREVALCTL not 0) and a layer is unreconciled.
import { describe, expect, it } from 'vitest';
import {
  LAYEREVALCTL,
  LAYER_NOTIFY_BITS,
  layerNotice,
  layerNotifyEventOf,
  type HeaderValue,
  type LayerNotifyEvent,
  type LayerRecord,
} from '../../src/index';
import { layer } from '../model/fixtures';

const layers: LayerRecord[] = [
  layer('10', '0'),
  { ...layer('11', 'DOORS'), unreconciled: true },
  layer('12', 'WALLS'),
  { ...layer('13', 'GLASS'), unreconciled: true },
];

const drawing = (entries: [string, HeaderValue][], of: readonly LayerRecord[] = layers) => ({
  header: new Map<string, HeaderValue>(entries),
  layers: of,
});

describe('LAYERNOTIFY (M5-19 part 4)', () => {
  it('numbers the events as AutoCAD 2024 Help does', () => {
    expect(LAYER_NOTIFY_BITS).toEqual({
      plot: 1,
      open: 2,
      xref: 4,
      'layer-state': 8,
      save: 16,
      insert: 32,
    });
  });

  it('names the unreconciled layers, sorted, for an event whose bit is set', () => {
    const d = drawing([
      ['LAYEREVAL', '1'],
      ['LAYERNOTIFY', '15'],
    ]);
    for (const event of ['plot', 'open', 'xref', 'layer-state'] as const) {
      expect(layerNotice(d, event)).toEqual(['DOORS', 'GLASS']);
    }
    expect(layerNotice(d, 'save')).toEqual([]);
    expect(layerNotice(d, 'insert')).toEqual([]);
  });

  it('reads LAYERNOTIFY as a number too (SETVAR) and takes every bit up to 32', () => {
    const d = drawing([
      ['LAYEREVAL', 2],
      ['LAYERNOTIFY', 48],
    ]);
    expect(layerNotice(d, 'save')).toEqual(['DOORS', 'GLASS']);
    expect(layerNotice(d, 'insert')).toEqual(['DOORS', 'GLASS']);
    expect(layerNotice(d, 'open')).toEqual([]);
  });

  it('gives no alert while LAYERNOTIFY is 0, as it is initially', () => {
    const all: LayerNotifyEvent[] = ['plot', 'open', 'xref', 'layer-state', 'save', 'insert'];
    for (const e of all) expect(layerNotice(drawing([['LAYEREVAL', '1']]), e)).toEqual([]);
  });

  it('gives none while layers are not evaluated: LAYEREVAL 0 or LAYEREVALCTL 0', () => {
    expect(layerNotice(drawing([['LAYERNOTIFY', '63']]), 'open')).toEqual([]);
    const off = drawing([
      ['LAYEREVAL', '1'],
      ['LAYERNOTIFY', '63'],
      [LAYEREVALCTL, 0],
    ]);
    expect(layerNotice(off, 'open')).toEqual([]);
  });

  it('gives none when no layer is unreconciled', () => {
    const d = drawing(
      [
        ['LAYEREVAL', '1'],
        ['LAYERNOTIFY', '63'],
      ],
      [layer('10', '0'), layer('12', 'WALLS')],
    );
    expect(layerNotice(d, 'open')).toEqual([]);
  });

  it('knows the commands that insert: those that can bring another drawing’s layers', () => {
    for (const c of ['INSERT', 'PASTECLIP', 'PASTEORIG', 'PASTEBLOCK', 'ADCENTER']) {
      expect(layerNotifyEventOf(c)).toBe('insert');
    }
    for (const c of ['LINE', 'LAYER', 'COPY', 'XBIND', 'QSAVE']) {
      expect(layerNotifyEventOf(c)).toBeUndefined();
    }
  });
});
