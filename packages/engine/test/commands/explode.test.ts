// M3-12 part 3: EXPLODE on the PromptBus with the services above the engine: a pattern hatch's
// lines (`hatchLines`, `@triya/hatch` in the app) and a multileader's text widths measured on
// the canvas (`textWidths`), so its underline survives the explode.
import { describe, expect, it } from 'vitest';
import {
  PromptBus,
  builtinCommands,
  type BusEvent,
  type EntityGeometry,
  type HatchLinesOf,
  type MultiLeaderGeometry,
  type ViewReply,
} from '../../src/index';
import { MODEL_SPACE } from '../model/fixtures';
import { setup } from './edit-harness';

const ML: MultiLeaderGeometry = {
  kind: 'MULTILEADER',
  overrideFlags: 0,
  pathType: 1,
  lineColor: { kind: 'byBlock' },
  lineweight: 'ByBlock',
  landing: true,
  dogleg: true,
  doglegLength: 2.5,
  arrowheadSize: 3,
  contentType: 2,
  scale: 1,
  annotative: false,
  textLeftAttachment: 5,
  textRightAttachment: 5,
  textTopAttachment: 9,
  textBottomAttachment: 9,
  textAttachmentDirection: 0,
  textAngleType: 1,
  textAlignment: 0,
  textFrame: false,
  contentBase: { x: 112.5, y: 10 },
  landingGap: 0.5,
  text: {
    content: 'NOTE',
    style: '16',
    position: { x: 113, y: 11.25 },
    rotation: 0,
    height: 2.5,
    width: 0,
    boundaryHeight: 0,
    lineSpacing: 1,
    lineSpacingStyle: 1,
    attachment: 1,
    flow: 1,
    color: { kind: 'byBlock' },
  },
  branches: [
    {
      index: 0,
      connection: { x: 110, y: 10 },
      direction: { x: 1, y: 0 },
      doglegLength: 2.5,
      lines: [{ index: 0, vertices: [{ x: 100, y: 0 }] }],
    },
  ],
};

const HATCH: EntityGeometry = {
  kind: 'HATCH',
  pattern: 'ANSI31',
  solid: false,
  associative: false,
  style: 0,
  patternType: 1,
  patternAngle: 0,
  patternScale: 1,
  double: false,
  loops: [],
  patternLines: [],
  seedPoints: [],
};

/** The harness drawing with the multileader and hatch, on a bus given `hatchLines`. */
function drawing(widths: ViewReply, hatchLines?: HatchLinesOf) {
  const { model } = setup([ML, HATCH]);
  const asked: unknown[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    hatchLines,
    view: {
      request: (r): Promise<ViewReply> => {
        if (r.op === 'textWidths') {
          asked.push(...r.texts);
          return Promise.resolve(widths);
        }
        return Promise.resolve({ ok: false, message: 'no' });
      },
    },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const kinds = () => model.blockEntities(MODEL_SPACE).map((id) => model.entity(id)!.geom.kind);
  return { bus, log, kinds, asked };
}

describe('EXPLODE with the hatch engine and the canvas', () => {
  it("explodes a hatch through the hatch engine and keeps a multileader's measured underline", async () => {
    const d = drawing({ ok: true, widths: [7] }, () => ({ segments: [0, 0, 1, 1], dots: [] }));
    await d.bus.script(['EXPLODE', 'ALL', '']);
    // The multileader's text was measured once.
    expect(d.asked).toHaveLength(1);
    expect(d.kinds()).toEqual([
      'LINE',
      'CIRCLE',
      'SOLID',
      'LINE',
      'LINE',
      // The underline.
      'LINE',
      'MTEXT',
      'LINE',
    ]);
    expect(d.log).toContain('1 object was not exploded: a LINE cannot be exploded.');
  });

  it('leaves the hatch and the underline when there is no hatch engine or no canvas', async () => {
    const d = drawing({ ok: false, message: 'no canvas' });
    await d.bus.script(['EXPLODE', 'ALL', '']);
    expect(d.kinds()).toEqual(['LINE', 'CIRCLE', 'HATCH', 'SOLID', 'LINE', 'LINE', 'MTEXT']);
    expect(d.log).toContain(
      '1 object was not exploded: the hatch has no pattern lines to explode.',
    );
  });
});
