// M3-15: a layout viewport's UCS per viewport in the Properties palette (AutoCAD 2024's palette
// for a viewport, Misc: "UCS per viewport", Yes or No; UCSVP, DXF 71).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  propertySheet,
  type BusEvent,
  type PropertyRow,
  type PropertySheet,
  type ViewportGeometry,
} from '../../src/index';
import { PAPER_SPACE, entityInit, sampleInit } from '../model/fixtures';

const viewport = (over: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 100, y: 50 },
  width: 40,
  height: 20,
  id: 2,
  status: 1,
  flags: 32,
  viewCenter: { x: 10, y: 10 },
  viewHeight: 10,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
  ...over,
});

function setup() {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    entities: [
      ...(base.entities ?? []),
      entityInit('50', viewport(), { owner: PAPER_SPACE }),
      entityInit('51', viewport({ ucsPerViewport: true }), { owner: PAPER_SPACE }),
    ],
  });
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: () => Promise.resolve({ ok: true }) },
    space: () => PAPER_SPACE,
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const id = (h: string) => model.entityByHandle(h)!.id;
  const geom = (h: string) => model.entityByHandle(h)!.geom as ViewportGeometry;
  return { model, bus, log, id, geom };
}

const rowOf = (sheet: PropertySheet, label: string): PropertyRow | undefined =>
  sheet.sections.flatMap((s) => s.rows).find((r) => r.label === label);

describe('a viewport’s UCS per viewport (M3-15)', () => {
  it('shows UCSVP as Yes or No under Misc', () => {
    const s = setup();
    const row = (...hs: string[]) =>
      rowOf(propertySheet(s.model, hs.map(s.id)), 'UCS per viewport');
    expect(row('50')).toMatchObject({ kind: 'choice', value: 'no' });
    expect(row('51')).toMatchObject({ kind: 'choice', value: 'yes' });
    expect(row('50', '51')?.varies).toBe(true);
    expect(row('50')?.options?.map((o) => o.label)).toEqual(['Yes', 'No']);
    const misc = propertySheet(s.model, [s.id('50')]).sections.find((x) =>
      x.rows.some((r) => r.label === 'UCS per viewport'),
    );
    expect(misc?.title).toBe('Misc');
  });

  it('sets it on the viewports selected, one undo step', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'ucsPerViewport', value: 'yes' }, 'VIEWPORT');
    expect(s.geom('50').ucsPerViewport).toBe(true);
    await s.bus.setProperty({ key: 'ucsPerViewport', value: 'no' }, 'VIEWPORT');
    expect(s.geom('50').ucsPerViewport).toBe(false);
    expect(s.geom('51').ucsPerViewport).toBe(false);
    await s.bus.setProperty({ key: 'ucsPerViewport', value: 'maybe' }, 'VIEWPORT');
    expect(s.log.at(-1)).toBe('Invalid input.');
    await s.bus.submit('U');
    expect(s.geom('51').ucsPerViewport).toBe(true);
  });
});
