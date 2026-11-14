// M2-56 part 1: the Underlay Layers dialog's list and answer, and ULAYERS' request reaching it.
// The list is the PDF's layers in its order, then any layer the underlay turns off that the PDF
// lacks (or every one turned off when the PDF was not supplied); OK answers only the underlays it
// changed.
import { describe, expect, it } from 'vitest';
import type { EntityId, UnderlayLayersInfo, ViewRequest } from '@triya/engine';
import { answerView, NO_DIALOGS, type ViewContext } from '../src/canvas/view-host';
import {
  layerMatches,
  layerRows,
  okReply,
  toggled,
  underlayLayersDialog,
} from '../src/underlay-layers';

const id = (n: number) => n as EntityId;
const info = (n: number, layersOff: string[] = []): UnderlayLayersInfo => ({
  id: id(n),
  name: `plan - 1 [${n}]`,
  fileName: 'plan.pdf',
  page: '1',
  layersOff,
});

describe('layerRows', () => {
  it("lists the PDF's layers in order, then layers turned off that it lacks", () => {
    expect(layerRows(['Walls', 'Notes', 'Draft'], ['Notes', 'Gone'])).toEqual([
      { name: 'Walls', on: true },
      { name: 'Notes', on: false },
      { name: 'Draft', on: true },
      { name: 'Gone', on: false },
    ]);
  });

  it('lists only the layers turned off without the PDF', () => {
    expect(layerRows(undefined, ['Walls'])).toEqual([{ name: 'Walls', on: false }]);
    expect(layerRows(undefined, [])).toEqual([]);
  });
});

describe('layerMatches', () => {
  it('finds a part of the name, case ignored, or matches * and ? wildcards', () => {
    expect(layerMatches('Walls', '')).toBe(true);
    expect(layerMatches('Walls', 'all')).toBe(true);
    expect(layerMatches('Walls', 'NOT')).toBe(false);
    expect(layerMatches('Walls', 'w*')).toBe(true);
    expect(layerMatches('Walls', '?alls')).toBe(true);
    expect(layerMatches('Walls', 'a*')).toBe(false);
    expect(layerMatches('A.B', 'a.b')).toBe(true);
    expect(layerMatches('AxB', 'a.*')).toBe(false);
  });
});

describe('toggled', () => {
  it('turns a layer off at the end or on, keeping the others', () => {
    expect(toggled(['Walls'], 'Notes', false)).toEqual(['Walls', 'Notes']);
    expect(toggled(['Walls', 'Notes'], 'Walls', true)).toEqual(['Notes']);
    expect(toggled(['Walls'], 'Walls', false)).toEqual(['Walls']);
  });
});

describe('okReply', () => {
  it('answers the underlays changed, and nothing when none changed', () => {
    const underlays = [info(1), info(2, ['Walls', 'Notes'])];
    expect(okReply(underlays, new Map())).toEqual({ ok: true });
    expect(okReply(underlays, new Map([[id(2), ['Notes', 'Walls']]]))).toEqual({ ok: true });
    expect(
      okReply(
        underlays,
        new Map([
          [id(1), ['Draft']],
          [id(2), []],
          [id(3), ['Walls']],
        ]),
      ),
    ).toEqual({
      ok: true,
      underlayLayers: [
        { id: id(1), layersOff: ['Draft'] },
        { id: id(2), layersOff: [] },
      ],
    });
  });
});

describe('underlayLayersDialog', () => {
  it('opens for a drawing and answers ULAYERS when it closes; a second opening cancels the first', async () => {
    const first = underlayLayersDialog.show(1, { underlays: [info(1)] });
    expect(underlayLayersDialog.get()).toEqual({ doc: 1, request: { underlays: [info(1)] } });
    const second = underlayLayersDialog.show(2, { underlays: [info(2)], current: id(2) });
    await expect(first).resolves.toEqual({ ok: true });
    expect(underlayLayersDialog.get()?.doc).toBe(2);
    underlayLayersDialog.close({ ok: true, underlayLayers: [{ id: id(2), layersOff: ['W'] }] });
    await expect(second).resolves.toEqual({
      ok: true,
      underlayLayers: [{ id: id(2), layersOff: ['W'] }],
    });
    expect(underlayLayersDialog.get()).toBeUndefined();
  });
});

describe('answerView: underlayLayers', () => {
  const r: ViewRequest = { op: 'underlayLayers', underlays: [info(1)] };
  const base: ViewContext = { target: undefined, all: () => [], views: () => [] };

  it('goes to the dialog, which needs no canvas', async () => {
    const asked: ViewRequest[] = [];
    const ctx: ViewContext = {
      ...base,
      underlayLayers: (q) => {
        asked.push(q);
        return { ok: true };
      },
    };
    expect(await answerView(r, ctx)).toEqual({ ok: true });
    expect(asked).toEqual([r]);
  });

  it('is refused where there are no dialogs', async () => {
    expect(await answerView(r, base)).toEqual({ ok: false, message: NO_DIALOGS });
  });
});
