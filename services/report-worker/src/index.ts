// The error-report worker (M7-08, PRD §8 G6, ARCHITECTURE.md §17, DEC-029): a Cloudflare Worker
// at report.openengtools.com that files each report the app's user chose to send as an issue in
// the private triage repository. It keeps nothing itself: no logs of the body, no storage.
//
// What it accepts is exactly the app's payload (apps/web/src/error-report/schema.ts, imported
// here so the two cannot drift): a POST from the app's origin of at most MAX_REPORT_BYTES whose
// JSON passes `validReport`, which refuses any field the schema does not list. The request is
// a CORS "simple request" (text/plain), so the app sends one request and no preflight; OPTIONS
// is answered anyway for clients that send one.
//
// Deployment (README.md): `wrangler deploy` with GITHUB_TOKEN as a secret (a fine-grained token
// with Issues: write on TRIAGE_REPO only).
import {
  MAX_REPORT_BYTES,
  validReport,
  type ErrorReport,
} from '../../../apps/web/src/error-report/schema';

export interface Env {
  /** A fine-grained GitHub token with Issues: write on TRIAGE_REPO only (a secret). */
  readonly GITHUB_TOKEN: string;
  /** `owner/name` of the private triage repository. */
  readonly TRIAGE_REPO: string;
  /** The app's origin; only its requests are filed. */
  readonly ALLOWED_ORIGIN?: string;
}

export const DEFAULT_ORIGIN = 'https://triya-cad-2d.openengtools.com';

/** Reports filed per client address per hour, in one worker instance (best effort). */
export const PER_HOUR = 10;

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export class ReportWorker {
  readonly #recent = new Map<string, number[]>();

  constructor(
    private readonly fetchImpl: Fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  async handle(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN ?? DEFAULT_ORIGIN;
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
    const reply = (status: number, body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    if (request.headers.get('origin') !== origin) return reply(403, { error: 'origin' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { error: 'method' });
    const length = Number(request.headers.get('content-length') ?? '0');
    if (length > MAX_REPORT_BYTES) return reply(413, { error: 'size' });
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_REPORT_BYTES) {
      return reply(413, { error: 'size' });
    }
    let report: unknown;
    try {
      report = JSON.parse(text);
    } catch {
      return reply(400, { error: 'json' });
    }
    if (!validReport(report)) return reply(400, { error: 'schema' });
    const client = request.headers.get('cf-connecting-ip') ?? '';
    if (!this.#allow(client)) return reply(429, { error: 'rate' });
    const filed = await this.fetchImpl(`https://api.github.com/repos/${env.TRIAGE_REPO}/issues`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'content-type': 'application/json',
        'user-agent': 'triya-report-worker',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify(issueOf(report)),
    });
    return filed.ok ? reply(201, { ok: true }) : reply(502, { error: 'github' });
  }

  /** At most PER_HOUR reports per client address in the last hour, in this instance. */
  #allow(client: string): boolean {
    const now = this.now();
    const hour = 60 * 60 * 1000;
    const recent = (this.#recent.get(client) ?? []).filter((t) => now - t < hour);
    if (recent.length >= PER_HOUR) {
      this.#recent.set(client, recent);
      return false;
    }
    recent.push(now);
    this.#recent.set(client, recent);
    return true;
  }
}

/**
 * The issue for a report: a title triage can scan (class, first frame, version) and the
 * report as JSON in a fenced block, its backticks escaped so nothing in it ends the block.
 */
export function issueOf(report: ErrorReport): { title: string; body: string; labels: string[] } {
  const e = report.error;
  const where = e.stack[0] ? ` at ${e.stack[0]}` : '';
  const command = e.command ? ` in ${e.command}` : '';
  const title = `[error report] ${e.name}${command}${where} (v${report.app})`.slice(0, 200);
  const json = JSON.stringify(report, null, 2).replace(/`/g, '\\u0060');
  const body = [
    `Sent from Triya CAD 2D ${report.app} by a user who reviewed it (${report.browser.name} ${report.browser.version}, ${report.browser.os}).`,
    '',
    '```json',
    json,
    '```',
  ].join('\n');
  return { title, body, labels: ['error-report'] };
}

const worker = new ReportWorker();

export default {
  fetch: (request: Request, env: Env): Promise<Response> => worker.handle(request, env),
};
