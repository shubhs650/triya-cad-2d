// M5-19 part 4: the Unreconciled New Layers alert (AutoCAD 2024 Help, "LAYERNOTIFY"; "Use New
// Layer Notification": the status bar's icon and its balloon, shown again each time an event
// LAYERNOTIFY names happens until the layers are reconciled; its View Unreconciled New Layers
// opens the Layer Properties Manager with the Unreconciled New Layers filter selected; PLOT asks
// in a dialog instead).
import type { ChangeSet, DocumentInit, LayerRecord } from '@triya/engine';
import { describe, expect, it, vi } from 'vitest';
import {
  LayerNotices,
  NoticeQuestion,
  noticeLayers,
  noticeText,
  UnreconciledView,
} from '../src/layer-notice';

const layer = (handle: string, name: string, extra: Partial<LayerRecord> = {}): LayerRecord => ({
  handle,
  name,
  color: { kind: 'aci', index: 7 },
  linetype: '14',
  lineweight: 'Default',
  transparency: { alpha: 255 },
  plot: true,
  on: true,
  frozen: false,
  locked: false,
  ...extra,
});

const init = (header: [string, unknown][]): DocumentInit =>
  ({
    header: new Map(header),
    tables: {
      layers: [
        layer('10', '0'),
        layer('11', 'WALLS'),
        layer('12', 'DOORS', { unreconciled: true }),
      ],
    },
  }) as unknown as DocumentInit;

describe('the layers an event alerts for (M5-19 part 4)', () => {
  it('reads LAYERNOTIFY, LAYEREVAL and the layers as the drawing’s changes left them', () => {
    const opened = init([
      ['LAYEREVAL', '1'],
      ['LAYERNOTIFY', '2'],
    ]);
    expect(noticeLayers(opened, [], 'open')).toEqual(['DOORS']);
    expect(noticeLayers(opened, [], 'save')).toEqual([]);
    // SETVAR LAYERNOTIFY 16, then WALLS flagged by a paste.
    const changes: ChangeSet[] = [
      { header: [{ name: 'LAYERNOTIFY', before: '2', after: 16 }] },
      {
        tables: {
          layers: {
            updated: [
              { before: layer('11', 'WALLS'), after: layer('11', 'WALLS', { unreconciled: true }) },
            ],
          },
        },
      } as unknown as ChangeSet,
    ];
    expect(noticeLayers(opened, changes, 'save')).toEqual(['DOORS', 'WALLS']);
    expect(noticeLayers(opened, changes, 'open')).toEqual([]);
  });
});

describe('LayerNotices', () => {
  it('raises a drawing’s alert with its balloon, which closes alone; none for no layers', () => {
    const n = new LayerNotices();
    const heard = vi.fn();
    n.subscribe(heard);
    n.raise(1, []);
    expect(n.get(1)).toBeUndefined();
    expect(heard).not.toHaveBeenCalled();
    n.raise(1, ['DOORS']);
    expect(n.get(1)).toEqual({ layers: ['DOORS'], balloon: true });
    expect(n.get(2)).toBeUndefined();
    n.closeBalloon(1);
    expect(n.get(1)).toEqual({ layers: ['DOORS'], balloon: false });
    // Each event raises the balloon again until the layers are reconciled.
    n.raise(1, ['DOORS', 'GLASS']);
    expect(n.get(1)).toEqual({ layers: ['DOORS', 'GLASS'], balloon: true });
    n.forget(1);
    expect(n.get(1)).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(4);
  });
});

describe('noticeText', () => {
  it('says how many layers are new and names up to five', () => {
    expect(noticeText(['DOORS'])).toBe(
      '1 new layer has been added since the layer list was last checked: DOORS.',
    );
    expect(noticeText(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe(
      '7 new layers have been added since the layer list was last checked: A, B, C, D, E and 2 more.',
    );
  });
});

describe('UnreconciledView', () => {
  it('holds a request to show a drawing’s Unreconciled New Layers until its manager takes it', () => {
    const v = new UnreconciledView();
    v.request(3);
    expect(v.take(2)).toBe(false);
    expect(v.take(3)).toBe(true);
    expect(v.take(3)).toBe(false);
  });
});

describe('NoticeQuestion (PLOT’s dialog)', () => {
  it('waits for Yes or No; a second question answers the first No', async () => {
    const q = new NoticeQuestion();
    const first = q.ask(['DOORS']);
    expect(q.get()).toEqual({ layers: ['DOORS'] });
    const second = q.ask(['GLASS']);
    await expect(first).resolves.toBe(false);
    q.answer(true);
    await expect(second).resolves.toBe(true);
    expect(q.get()).toBeUndefined();
  });
});
