// M7-08: the error-report worker files a report the app sent as a GitHub issue, and refuses
// anything else: another origin, another method, a body too big, not JSON, or any field the
// app's schema does not list. GitHub is a fake here; nothing leaves the test.
import { describe, expect, it } from 'vitest';
import type { ErrorReport } from '../../../apps/web/src/error-report/schema';
import { DEFAULT_ORIGIN, PER_HOUR, ReportWorker, issueOf, type Env } from '../src/index';

const ENV: Env = { GITHUB_TOKEN: 'token', TRIAGE_REPO: 'owner/triage' };

const REPORT: ErrorReport = {
  schema: 1,
  app: '1.0.0',
  browser: { name: 'Firefox', version: '132', os: 'macOS' },
  error: {
    source: 'command',
    name: 'TypeError',
    message: 'x is `undefined` ```',
    command: 'MOVE',
    stack: ['moveEntities (/assets/engine.js:1:2)'],
  },
  drawing: {
    version: 'AC1032',
    units: 4,
    measurement: 'metric',
    entities: { LINE: 3 },
    counts: {
      layers: 1,
      linetypes: 3,
      textStyles: 1,
      dimStyles: 1,
      blocks: 2,
      layouts: 2,
      objects: 4,
      edits: 0,
    },
  },
  features: ['layouts'],
};

function setup(status = 201) {
  const calls: { url: string; init: RequestInit }[] = [];
  let now = 0;
  const worker = new ReportWorker(
    (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response('{}', { status }));
    },
    () => now,
  );
  return { worker, calls, later: (ms: number) => (now += ms) };
}

const post = (body: string, headers: Record<string, string> = {}, method = 'POST') =>
  new Request('https://report.openengtools.com/', {
    method,
    headers: { origin: DEFAULT_ORIGIN, 'content-type': 'text/plain;charset=utf-8', ...headers },
    ...(method === 'GET' || method === 'OPTIONS' ? {} : { body }),
  });

describe('report worker (M7-08)', () => {
  it('files a valid report as an issue in the triage repository', async () => {
    const { worker, calls } = setup();
    const r = await worker.handle(post(JSON.stringify(REPORT)), ENV);
    expect(r.status).toBe(201);
    expect(r.headers.get('access-control-allow-origin')).toBe(DEFAULT_ORIGIN);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.github.com/repos/owner/triage/issues');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer token');
    const issue = JSON.parse(calls[0]!.init.body as string);
    expect(issue).toEqual(issueOf(REPORT));
    expect(issue.labels).toEqual(['error-report']);
    expect(issue.title).toBe(
      '[error report] TypeError in MOVE at moveEntities (/assets/engine.js:1:2) (v1.0.0)',
    );
    // Nothing in the report can end the fenced block.
    const fenced = issue.body.split('```json\n')[1].split('\n```')[0];
    expect(fenced).not.toContain('`');
    expect(JSON.parse(fenced)).toEqual(REPORT);
  });

  it('answers a preflight, and says when GitHub did not file the issue', async () => {
    const { worker } = setup(500);
    const pre = await worker.handle(post('', {}, 'OPTIONS'), ENV);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    const r = await worker.handle(post(JSON.stringify(REPORT)), ENV);
    expect(r.status).toBe(502);
  });

  it('refuses another origin, another method, a big body, bad JSON and unlisted fields', async () => {
    const { worker, calls } = setup();
    const cases: [Request, number][] = [
      [post(JSON.stringify(REPORT), { origin: 'https://evil.example' }), 403],
      [post('', {}, 'GET'), 405],
      [post('x'.repeat(16 * 1024 + 1)), 413],
      [post('{"schema":1', {}), 400],
      [post(JSON.stringify({ ...REPORT, fileName: 'plan.dxf' })), 400],
      [post(JSON.stringify({ ...REPORT, error: { ...REPORT.error, text: 'room 1' } })), 400],
      [
        post(
          JSON.stringify({
            ...REPORT,
            error: { ...REPORT.error, stack: ['C:\\Users\\me\\plan.dxf:1:1'] },
          }),
        ),
        400,
      ],
    ];
    for (const [req, status] of cases) {
      expect((await worker.handle(req, ENV)).status).toBe(status);
    }
    expect(calls).toEqual([]);
  });

  it('files at most PER_HOUR reports an hour from one address', async () => {
    const { worker, calls, later } = setup();
    const from = { 'cf-connecting-ip': '203.0.113.7' };
    for (let i = 0; i < PER_HOUR; i++) {
      expect((await worker.handle(post(JSON.stringify(REPORT), from), ENV)).status).toBe(201);
    }
    expect((await worker.handle(post(JSON.stringify(REPORT), from), ENV)).status).toBe(429);
    const other = { 'cf-connecting-ip': '203.0.113.8' };
    expect((await worker.handle(post(JSON.stringify(REPORT), other), ENV)).status).toBe(201);
    later(60 * 60 * 1000);
    expect((await worker.handle(post(JSON.stringify(REPORT), from), ENV)).status).toBe(201);
    expect(calls).toHaveLength(PER_HOUR + 2);
  });

  it('files a report with no drawing open and no stack', async () => {
    const { worker, calls } = setup();
    const bare: ErrorReport = {
      ...REPORT,
      error: { ...REPORT.error, command: '', stack: [] },
      features: [],
    };
    delete (bare as { drawing?: unknown }).drawing;
    expect((await worker.handle(post(JSON.stringify(bare)), ENV)).status).toBe(201);
    expect(JSON.parse(calls[0]!.init.body as string).title).toBe(
      '[error report] TypeError (v1.0.0)',
    );
  });
});
