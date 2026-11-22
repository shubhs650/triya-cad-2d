// M7-08: the error reports offered. Nothing is posted until Send Report, and what is posted is
// the text the dialog showed; an error is offered once, one at a time, at most MAX_OFFERS times.
import { describe, expect, it, vi } from 'vitest';
import type { Fault } from '../src/error-report/build';
import { ErrorReports, MAX_OFFERS } from '../src/error-report/offers';
import type { ErrorReport } from '../src/error-report/schema';

const report = (f: Fault): ErrorReport => ({
  schema: 1,
  app: '0.0.0',
  browser: { name: 'Chrome', version: '141', os: 'Linux' },
  error: { source: f.source, name: 'Error', message: f.message, command: '', stack: [] },
  features: [],
});

function setup(post: (text: string) => Promise<boolean> = () => Promise.resolve(true)) {
  let enabled = true;
  const sent: string[] = [];
  const reports = new ErrorReports({
    build: report,
    post: (t) => {
      sent.push(t);
      return post(t);
    },
    enabled: () => enabled,
  });
  const changed = vi.fn();
  reports.subscribe(changed);
  return { reports, sent, changed, disable: () => (enabled = false) };
}

describe('ErrorReports (M7-08)', () => {
  it('posts nothing until Send Report, then exactly the text shown', async () => {
    const { reports, sent, changed } = setup();
    reports.offer({ source: 'window', message: 'boom' });
    const o = reports.getSnapshot()!;
    expect(o.state).toBe('review');
    expect(JSON.parse(o.text)).toEqual(o.report);
    expect(sent).toEqual([]);
    await reports.send();
    expect(sent).toEqual([o.text]);
    expect(reports.getSnapshot()!.state).toBe('sent');
    await reports.send();
    expect(sent).toHaveLength(1);
    expect(changed).toHaveBeenCalled();
    reports.dismiss();
    expect(reports.getSnapshot()).toBeUndefined();
  });

  it("posts nothing on Don't Send", async () => {
    const { reports, sent } = setup();
    reports.offer({ source: 'window', message: 'boom' });
    reports.dismiss();
    await reports.send();
    expect(sent).toEqual([]);
    expect(reports.getSnapshot()).toBeUndefined();
  });

  it('says when the report could not be sent, and lets the user try again', async () => {
    let ok = false;
    const { reports, sent } = setup(() =>
      ok ? Promise.resolve(true) : Promise.reject(new Error('offline')),
    );
    reports.offer({ source: 'promise', message: 'boom' });
    await reports.send();
    expect(reports.getSnapshot()!.state).toBe('failed');
    ok = true;
    await reports.send();
    expect(reports.getSnapshot()!.state).toBe('sent');
    expect(sent).toHaveLength(2);
  });

  it('offers one at a time, each error once, and stops after MAX_OFFERS', () => {
    const { reports } = setup();
    reports.offer({ source: 'window', message: 'one' });
    reports.offer({ source: 'window', message: 'two' });
    expect(reports.getSnapshot()!.report.error.message).toBe('one');
    reports.dismiss();
    reports.offer({ source: 'window', message: 'one' });
    expect(reports.getSnapshot()).toBeUndefined();
    for (let i = 0; i < MAX_OFFERS + 2; i++) {
      reports.offer({ source: 'window', message: `n${i}` });
      if (reports.getSnapshot()) reports.dismiss();
    }
    reports.offer({ source: 'window', message: 'late' });
    expect(reports.getSnapshot()).toBeUndefined();
  });

  it('offers nothing while the user has turned offers off, or when a report cannot be built', () => {
    const { reports, disable } = setup();
    disable();
    reports.offer({ source: 'window', message: 'boom' });
    expect(reports.getSnapshot()).toBeUndefined();
    const broken = new ErrorReports({
      build: () => {
        throw new Error('cannot');
      },
      post: () => Promise.resolve(true),
      enabled: () => true,
    });
    broken.offer({ source: 'window', message: 'boom' });
    expect(broken.getSnapshot()).toBeUndefined();
  });

  it('ignores an error raised while a report is being built', () => {
    const inner = vi.fn();
    const reports: ErrorReports = new ErrorReports({
      build: (f) => {
        inner();
        reports.offer({ source: 'window', message: 'inside' });
        return report(f);
      },
      post: () => Promise.resolve(true),
      enabled: () => true,
    });
    reports.offer({ source: 'window', message: 'outer' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(reports.getSnapshot()!.report.error.message).toBe('outer');
  });
});
