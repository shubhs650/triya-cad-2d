// M7-08 part 2: what the diagnostics panel reads. The engines time each drawing's last command
// (start to end, nested transparent commands not counted) and how long the engine took to read
// the last numbered input (submit, answer, Esc) sent to it; the PDF page cache says its size.
import type { CommandInput, CommandOutput, DocumentInit } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Engines } from '../src/engine/engines';
import type { EngineHost } from '../src/engine/host';

function fakeHost() {
  const listeners: ((o: CommandOutput) => void)[] = [];
  const sent: CommandInput[] = [];
  const host = {
    mode: 'worker' as const,
    onCommand: (l: (o: CommandOutput) => void) => {
      listeners.push(l);
      return () => undefined;
    },
    command: (i: CommandInput) => sent.push(i),
    dispose: () => undefined,
  };
  return { host, sent, emit: (o: CommandOutput) => listeners.forEach((l) => l(o)) };
}

describe('Engines timings (M7-08 diagnostics)', () => {
  it("times the last command and the engine's read of the last numbered input", async () => {
    let now = 1000;
    const fake = fakeHost();
    const engines = new Engines(
      () => fake.host as unknown as EngineHost,
      () => [],
      () => now,
    );
    engines.start(1, {} as DocumentInit);
    expect(engines.timingsOf(1)).toEqual({});
    expect(engines.modeOf(1)).toBe('worker');

    engines.command(1, { kind: 'submit', text: 'LINE', seq: 1 });
    now += 4;
    fake.emit({ type: 'start', command: 'LINE', transparent: false });
    fake.emit({ type: 'read', seq: 1 });
    expect(engines.timingsOf(1)).toEqual({ lastResponseMs: 4 });

    // A transparent command inside does not end LINE's timing.
    now += 100;
    fake.emit({ type: 'start', command: 'ZOOM', transparent: true });
    fake.emit({ type: 'end', command: 'ZOOM', cancelled: false });
    expect(engines.timingsOf(1).lastCommand).toBeUndefined();

    // Input worked out later (a click's object snap) is timed from when it is sent.
    let resolve!: (i: CommandInput) => void;
    engines.command(1, new Promise<CommandInput>((r) => (resolve = r)));
    now += 50;
    resolve({ kind: 'cancel', seq: 2 });
    await new Promise((r) => setTimeout(r));
    now += 7;
    fake.emit({ type: 'read', seq: 2 });
    fake.emit({ type: 'end', command: 'LINE', cancelled: true });
    expect(engines.timingsOf(1)).toEqual({
      lastResponseMs: 7,
      lastCommand: { command: 'LINE', ms: 157, cancelled: true },
    });
    expect(fake.sent.map((i) => i.kind)).toEqual(['submit', 'cancel']);

    engines.stop(1);
    expect(engines.timingsOf(1)).toEqual({});
  });
});
