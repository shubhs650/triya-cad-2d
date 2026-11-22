// The error reports offered (M7-08, PRD §8 G6): an error that reaches the app (an uncaught one,
// a rejected promise nothing handled, a command that threw) is offered as a report the user
// reads and sends, or not. Nothing leaves the page until Send Report: `send` is the only path
// to the network, and it posts exactly the text the dialog showed.
//
// One offer shows at a time; the same error again (by class, message and first frame) is not
// offered twice in a session, and after a few the app stops offering, as a broken page could
// raise errors in a loop. Errors raised while building a report are dropped, never offered.
import type { Fault } from './build';
import type { ErrorReport } from './schema';

export type OfferState = 'review' | 'sending' | 'sent' | 'failed';

export interface ReportOffer {
  readonly id: number;
  readonly report: ErrorReport;
  /** The payload as sent: the dialog shows it, `send` posts it. */
  readonly text: string;
  readonly state: OfferState;
}

export interface ErrorReportDeps {
  /** The report of `fault` as the app is now (build.ts `buildReport`). */
  build(fault: Fault): ErrorReport;
  /** Posts `text` to the report worker; true when it was filed. */
  post(text: string): Promise<boolean>;
  /** Options > System's "Offer to send error reports" (on by default). */
  enabled(): boolean;
}

/** Offers in a session at most: past this the page is likely broken in a loop. */
export const MAX_OFFERS = 5;

export class ErrorReports {
  #offer: ReportOffer | undefined;
  #nextId = 1;
  #offered = 0;
  #building = false;
  readonly #seen = new Set<string>();
  readonly #listeners = new Set<() => void>();

  constructor(private readonly deps: ErrorReportDeps) {}

  readonly subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  readonly getSnapshot = (): ReportOffer | undefined => this.#offer;

  /** Offers `fault`'s report, unless one shows, it was offered already or offers are off. */
  offer(fault: Fault): void {
    if (this.#building || !this.deps.enabled()) return;
    if (this.#offer && this.#offer.state !== 'sent') return;
    if (this.#offered >= MAX_OFFERS) return;
    this.#building = true;
    try {
      const report = this.deps.build(fault);
      const e = report.error;
      const key = `${e.source}\u0000${e.name}\u0000${e.message}\u0000${e.stack[0] ?? ''}`;
      if (this.#seen.has(key)) return;
      this.#seen.add(key);
      this.#offered += 1;
      this.#set({
        id: this.#nextId++,
        report,
        text: JSON.stringify(report, null, 2),
        state: 'review',
      });
    } catch {
      // A report that cannot be built is not offered: building it again would fail again.
    } finally {
      this.#building = false;
    }
  }

  /** Send Report: posts the payload the dialog shows, once. */
  async send(): Promise<void> {
    const o = this.#offer;
    if (!o || (o.state !== 'review' && o.state !== 'failed')) return;
    this.#set({ ...o, state: 'sending' });
    let ok: boolean;
    try {
      ok = await this.deps.post(o.text);
    } catch {
      ok = false;
    }
    if (this.#offer?.id === o.id) this.#set({ ...o, state: ok ? 'sent' : 'failed' });
  }

  /** Don't Send, or Close after sending: nothing is sent. */
  dismiss(): void {
    if (this.#offer?.state === 'sending') return;
    this.#set(undefined);
  }

  #set(o: ReportOffer | undefined): void {
    this.#offer = o;
    for (const l of this.#listeners) l();
  }
}
