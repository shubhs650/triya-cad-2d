// M7-08 (PRD §8 G6, TESTING.md §6 "a second test"): the error report holds no drawing content.
// The drawing is MARKER-FILE-error-report.dxf (scripts/fixtures/error-report-markers.py), whose
// text, names, xdata and file name all hold a string starting with MARKER; the error's message
// and stack name them too, as a careless `throw new Error(\`layer ${name} ...\`)` would. The
// payload must hold none of them, yet keep what triage needs, and pass the report worker's check.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChangeSet, Entity } from '@triya/engine';
import { ioApi } from '@triya/io';
import { describe, expect, it } from 'vitest';
import {
  browserOf,
  buildReport,
  drawingStatistics,
  scrubMessage,
  stackFrames,
  type ReportContext,
  type ReportDrawingInput,
} from '../src/error-report/build';
import { validReport, type ErrorReport } from '../src/error-report/schema';

const NAME = 'MARKER-FILE-error-report.dxf';
const FILE = fileURLToPath(
  new URL(`../../../packages/testkit/fixtures/error-report/${NAME}`, import.meta.url),
);
const BYTES = readFileSync(FILE);
/** Every marker the file holds, read from its text. */
const MARKERS = [...new Set(BYTES.toString('latin1').match(/MARKER_[A-Z_]+/g))];

const ORIGIN = 'https://triya-cad-2d.openengtools.com';
const CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

async function drawing(changes: readonly ChangeSet[] = []): Promise<ReportDrawingInput> {
  const opened = await ioApi.open(new Uint8Array(BYTES));
  return { name: NAME, opened, changes, edits: changes.length, bytes: new Uint8Array(BYTES) };
}

const context = (d?: ReportDrawingInput): ReportContext => ({
  appVersion: '0.0.0',
  userAgent: CHROME,
  origin: ORIGIN,
  features: ['engine-in-worker', 'offscreen-canvas'],
  commands: new Set(['LINE', 'MOVE']),
  ...(d ? { drawing: d } : {}),
});

/** An error whose message and stack carry every marker, as careless code would make. */
function leakyFault() {
  const all = MARKERS.join(' ');
  return {
    source: 'command' as const,
    name: 'TypeError',
    command: 'move',
    message: `Cannot move ${all} on layer "MARKER_LAYER_WALLS" at 12.5,30.25 from C:\\Users\\me\\MARKER\\plan.dxf`,
    stack: [
      `TypeError: Cannot move ${all}`,
      `    at moveEntities (${ORIGIN}/assets/engine-Ab12.js:10:200)`,
      `    at async Session.command (${ORIGIN}/assets/engine-Ab12.js:99:7)`,
      `    at blob:${ORIGIN}/0b7c-1a:1:2`,
      '    at file:///C:/Users/me/MARKER_PATH/x.js:3:4',
      `    at ${all} (https://evil.example/MARKER_URL.js:1:1)`,
    ].join('\n'),
  };
}

describe('error report payload (M7-08)', () => {
  it('reads the marker drawing (the test would prove nothing without them)', async () => {
    expect(MARKERS.length).toBeGreaterThanOrEqual(15);
    for (const m of ['MARKER_TEXT_ROOM', 'MARKER_LAYER_WALLS', 'MARKER_XDATA_STRING']) {
      expect(MARKERS).toContain(m);
    }
    const d = await drawing();
    expect(JSON.stringify(d.opened.init)).toContain('MARKER_XDATA_STRING');
  });

  it('holds none of the drawing content, file name or paths, the message and stack naming them', async () => {
    const report = buildReport(leakyFault(), context(await drawing()));
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/MARKER/i);
    expect(json).not.toContain('Users');
    expect(json).not.toContain('12.5');
    expect(json).not.toContain('evil.example');
    expect(validReport(report)).toBe(true);
  });

  it('keeps what triage needs: the error, its frames, the browser and the drawing counts', async () => {
    const report = buildReport(leakyFault(), context(await drawing()));
    expect(report.schema).toBe(1);
    expect(report.app).toBe('0.0.0');
    expect(report.browser).toEqual({ name: 'Chrome', version: '141', os: 'Linux' });
    expect(report.error.source).toBe('command');
    expect(report.error.name).toBe('TypeError');
    expect(report.error.command).toBe('MOVE');
    expect(report.error.message).toMatch(/^Cannot move /);
    expect(report.error.message).toContain('"…"');
    expect(report.error.stack).toEqual([
      'moveEntities (/assets/engine-Ab12.js:10:200)',
      'async Session.command (/assets/engine-Ab12.js:99:7)',
      '<worker>:1:2',
      '<external>:3:4',
      '<external>:1:1',
    ]);
    const d = report.drawing!;
    expect(d.version).toBe('AC1032');
    expect(d.units).toBe(4);
    expect(d.measurement).toBe('metric');
    expect(d.entities['LINE']).toBeGreaterThanOrEqual(2);
    expect(d.entities['TEXT']).toBeGreaterThanOrEqual(2);
    expect(d.entities['MTEXT']).toBeGreaterThanOrEqual(1);
    expect(d.counts.layers).toBeGreaterThanOrEqual(2);
    expect(d.counts.layouts).toBeGreaterThanOrEqual(2);
    expect(report.features).toEqual(['layouts', 'offscreen-canvas', 'engine-in-worker']);
  });

  it('counts the drawing as edited, and leaves out text typed since it opened', async () => {
    const d0 = await drawing();
    const line = d0.opened.init.entities!.find((e) => e.geom.kind === 'LINE')! as Entity;
    const typed: Entity = {
      ...line,
      handle: 'FFFF',
      geom: { kind: 'TEXT', text: 'MARKER_TYPED_LATER' } as unknown as Entity['geom'],
    };
    const changes: ChangeSet[] = [
      { entities: { added: [{ entity: typed, index: 0 }], removed: [{ entity: line, index: 0 }] } },
    ];
    const before = drawingStatistics(d0);
    const d1 = await drawing(changes);
    const after = drawingStatistics(d1);
    expect(after.entities['LINE']).toBe(before.entities['LINE']! - 1);
    expect(after.entities['TEXT']).toBe(before.entities['TEXT']! + 1);
    expect(after.counts.edits).toBe(1);
    const report = buildReport(
      { source: 'window', message: 'bad MARKER_TYPED_LATER' },
      context(d1),
    );
    expect(JSON.stringify(report)).not.toContain('MARKER');
  });

  it('builds a report with no drawing open, and names only registered commands', () => {
    const report = buildReport(
      { source: 'promise', name: 'not a name!', message: 'x', command: 'MARKER_CMD' },
      context(),
    );
    expect(report.drawing).toBeUndefined();
    expect(report.error.name).toBe('Error');
    expect(report.error.command).toBe('');
    expect(report.error.stack).toEqual([]);
    expect(validReport(report)).toBe(true);
  });
});

describe('scrubMessage', () => {
  it('takes out quoted text, URLs, paths, decimals and known strings, ignoring case', () => {
    const known = new Set(['Secret Layer', 'Secret']);
    expect(scrubMessage("can't find 'A-WALL' in SECRET layer", known)).toBe(
      "can't find '…' in … …",
    );
    // A word of a known string goes on its own: part of a name, a line of formatted text.
    expect(scrubMessage('missing secret_2 and Secret', new Set(['Top Secret_2']))).toBe(
      'missing … and Secret',
    );
    expect(scrubMessage('see https://x.example/a?b and /home/me/plans/a.dxf', known)).toBe(
      'see <url> and <path>',
    );
    expect(scrubMessage('point 1.5,-2.25 index 3', known)).toBe('point #,# index 3');
    expect(scrubMessage('secret layer is Secret Layer', known)).toBe('… … is … …');
    expect(scrubMessage('x'.repeat(1000), known)).toHaveLength(300);
  });
});

describe('stackFrames', () => {
  it("reads Firefox's and Safari's frames too, and drops what is not a frame", () => {
    const stack = [
      `draw@${ORIGIN}/assets/render.js:5:6`,
      `@${ORIGIN}/src/App.tsx?t=123:7:8`,
      'not a frame at all',
      '[native code]',
    ].join('\n');
    expect(stackFrames(stack, ORIGIN)).toEqual([
      'draw (/assets/render.js:5:6)',
      '/src/App.tsx:7:8',
    ]);
  });
});

describe('browserOf', () => {
  it('names the family, major version and system', () => {
    expect(
      browserOf(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      ),
    ).toEqual({ name: 'Edge', version: '140', os: 'Windows' });
    expect(
      browserOf(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0',
      ),
    ).toEqual({ name: 'Firefox', version: '132', os: 'macOS' });
    expect(
      browserOf(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ name: 'Safari', version: '18', os: 'iOS' });
    expect(browserOf('curl/8')).toEqual({ name: 'Other', version: '', os: 'Other' });
  });
});

describe('validReport', () => {
  const good = (): ErrorReport => ({
    schema: 1,
    app: '1.0.0',
    browser: { name: 'Chrome', version: '141', os: 'Linux' },
    error: { source: 'window', name: 'Error', message: 'm', command: '', stack: ['/a.js:1:2'] },
    features: ['dwg'],
  });

  it('refuses any field not in the schema, and values out of their bounds', () => {
    expect(validReport(good())).toBe(true);
    const bad: unknown[] = [
      { ...good(), extra: 1 },
      { ...good(), schema: 2 },
      { ...good(), app: 'x' },
      { ...good(), features: ['drawing-name'] },
      { ...good(), features: ['dwg', 'dwg'] },
      { ...good(), browser: { name: 'Chrome', version: '141', os: 'Linux', ua: 'x' } },
      { ...good(), error: { ...good().error, message: 'x'.repeat(301) } },
      { ...good(), error: { ...good().error, stack: ['C:\\Users\\me\\a.js:1:2'] } },
      { ...good(), error: { ...good().error, stack: ['https://x.example/a.js:1:2'] } },
      { ...good(), error: { ...good().error, command: 'line' } },
      { ...good(), error: { ...good().error, path: '/x' } },
      {
        ...good(),
        drawing: {
          version: 'AC1032',
          units: 4,
          measurement: 'metric',
          entities: { 'MARKER layer': 1 },
          counts: {},
        },
      },
      null,
      [],
    ];
    for (const b of bad) expect(validReport(b), JSON.stringify(b)).toBe(false);
  });
});
