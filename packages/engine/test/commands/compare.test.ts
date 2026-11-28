// M8-06: COMPARE and COMPARECLOSE open and close the Compare palette, which the app shows (DEC-092),
// and the palette's filters show and hide objects of the compare drawing, one COMPARE undo step.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  type ViewRequest,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

describe('COMPARE and COMPARECLOSE', () => {
  it('ask the app to open and close the Compare palette', async () => {
    const requests: ViewRequest[] = [];
    const bus = new PromptBus({
      model: DocumentModel.create(sampleInit()),
      registry: builtinCommands(),
      view: {
        request: (r) => {
          requests.push(r);
          return Promise.resolve({ ok: true });
        },
      },
    });
    await bus.submit('COMPARE');
    await bus.submit('COMPARECLOSE');
    expect(requests).toEqual([
      { op: 'palette', palette: 'compare', open: true },
      { op: 'palette', palette: 'compare', open: false },
    ]);
  });
});

describe('The compare filters’ visibility edit', () => {
  it('shows and hides the objects named, one COMPARE undo step', () => {
    const s = new EngineSession(sampleInit());
    const visible = (h: string) => s.model.entityByHandle(h)?.visible;
    const r = s.edit({ kind: 'entity-visibility', shown: ['20'], hidden: ['21', '24', 'FFFF'] });
    expect(r.ok).toBe(true);
    expect([visible('20'), visible('21'), visible('23'), visible('24')]).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(s.undoState.undoList).toEqual(['COMPARE']);
    // Shown again; what is already as asked is left alone.
    const again = s.edit({ kind: 'entity-visibility', shown: ['20', '21'], hidden: ['24'] });
    expect(again.ok && again.change.entities?.updated?.length).toBe(1);
    expect(visible('21')).toBe(true);
    expect(s.edit({ kind: 'entity-visibility', shown: ['21'], hidden: [] })).toEqual({
      ok: true,
      change: {},
    });
    expect(s.undoState.undoList).toEqual(['COMPARE', 'COMPARE']);
  });
});
