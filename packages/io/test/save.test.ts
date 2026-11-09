// Save and Save As (M2-13): the app keeps the bytes it opened and its engine's change log; the
// I/O worker replays the log onto a fresh read and writes an AC1032 DXF (DEC-047), checking what
// the session added against AC1032 rather than the version the drawing was read in.
import { ACadVersion } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  UNDO_COMMANDS,
  builtinCommands,
  type ChangeSet,
} from '@triya/engine';
import * as Comlink from 'comlink';
import { describe, expect, it, vi } from 'vitest';
import {
  documentInit,
  ioApi,
  readCadDocument,
  saveInWorker,
  saveSession,
  UnsupportedChangeError,
  type IoWorker,
} from '../src/index';
import { sampleDwg, sampleDxf } from './fixtures';

// io compiles without DOM or Node types; Node provides these at runtime.
interface Port extends Comlink.Endpoint {
  close(): void;
}
declare const MessageChannel: new () => { port1: Port; port2: Port };
declare function structuredClone<T>(value: T): T;

/** What the app's engine holds after `script`, and the change sets it logged, cloned. */
async function session(
  bytes: Uint8Array,
  ...scripts: string[][]
): Promise<{ model: DocumentModel; changes: ChangeSet[] }> {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const changes: ChangeSet[] = [];
  const space = model.layouts.find((l) => l.name === 'Model')?.blockRecord;
  const registry = builtinCommands();
  for (const def of UNDO_COMMANDS) registry.register(def);
  // As EngineSession logs them: each change set as it is applied, cloned as postMessage does.
  const apply = (cs: ChangeSet) => {
    model.apply(cs);
    changes.push(structuredClone(cs));
  };
  const bus = new PromptBus({ model, registry, apply, ...(space && { space: () => space }) });
  for (const s of scripts) await bus.script(s);
  return { model, changes };
}

const header = (dxf: Uint8Array) => readCadDocument(dxf, 'dxf').header!;
const isDxf = (bytes: Uint8Array) =>
  String.fromCharCode(...bytes.subarray(0, 12)).trimStart().startsWith('0');

describe('saveSession', () => {
  it('writes the session’s edits onto the drawing as opened, as an AC1032 DXF', async () => {
    const bytes = sampleDxf(ACadVersion.AC1032);
    const { model, changes } = await session(bytes, ['LINE', '0,0', '10,10', '']);
    const added = [...model.entities()].find((e) => e.type === 'LINE' && e.handle !== undefined);
    const saved = saveSession(bytes, changes);
    expect(isDxf(saved)).toBe(true);
    expect(header(saved).version).toBe(ACadVersion.AC1032);
    const back = DocumentModel.create(documentInit(readCadDocument(saved, 'dxf')));
    expect([...back.entities()].map((e) => e.type)).toEqual(['LINE', 'LINE']);
    expect(back.entityByHandle(added!.handle)).toBeDefined();
    expect(back.entityByHandle([...model.entities()].at(-1)!.handle)?.geom).toEqual(
      [...model.entities()].at(-1)!.geom,
    );
  });

  it('saves a drawing opened from a DWG as an AC1032 DXF, the bytes untouched', async () => {
    const bytes = sampleDwg(ACadVersion.AC1018);
    const copy = bytes.slice();
    const { changes } = await session(bytes, ['LINE', '0,0', '5,0', '']);
    const saved = saveSession(bytes, changes);
    expect(isDxf(saved)).toBe(true);
    expect(header(saved).version).toBe(ACadVersion.AC1032);
    expect(bytes).toEqual(copy);
    const back = DocumentModel.create(documentInit(readCadDocument(saved, 'dxf')));
    expect([...back.entities()].filter((e) => e.type === 'LINE')).toHaveLength(2);
  });

  it('checks what the session added against AC1032, not the version read (R13 has no WIPEOUTVARIABLES)', async () => {
    const bytes = sampleDxf(ACadVersion.AC1012);
    expect(header(bytes).version).toBe(ACadVersion.AC1012);
    const { model, changes } = await session(
      bytes,
      ['WIPEOUT', '0,100', '40,100', '20,130', ''],
      // WIPEOUTVARIABLES, which a drawing before R14 cannot hold.
      ['WIPEOUT', 'F', 'OFF'],
      ['REVCLOUD', 'R', '0,0', '100,50'],
    );
    expect([...model.entities()].map((e) => e.type)).toEqual(['LINE', 'WIPEOUT', 'LWPOLYLINE']);
    const saved = saveSession(bytes, changes);
    expect(header(saved).version).toBe(ACadVersion.AC1032);
    const back = DocumentModel.create(documentInit(readCadDocument(saved, 'dxf')));
    expect([...back.entities()].map((e) => e.type)).toEqual(['LINE', 'WIPEOUT', 'LWPOLYLINE']);
  });

  it('replays every change set, even when the session undid its own edits', async () => {
    const bytes = sampleDxf(ACadVersion.AC1032);
    const { changes } = await session(bytes, ['LINE', '0,0', '10,10', ''], ['U']);
    expect(changes.length).toBeGreaterThanOrEqual(2);
    const back = DocumentModel.create(documentInit(readCadDocument(saveSession(bytes, changes))));
    expect([...back.entities()].map((e) => e.type)).toEqual(['LINE']);
  });

  it('refuses a log the drawing never took, as the engine would', async () => {
    const bytes = sampleDxf(ACadVersion.AC1032);
    const { changes } = await session(bytes, ['LINE', '0,0', '10,10', ''], ['ERASE', 'L', '']);
    expect(() => saveSession(bytes, changes.slice(1))).toThrow(/not in the model|out of step/);
  });

  it('refuses a change no writer handles, leaving nothing half-written', async () => {
    const bytes = sampleDxf(ACadVersion.AC1032);
    const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
    const b = new ChangeSetBuilder(model);
    b.setHeader('$ACADVER', 'AC1009');
    expect(() => saveSession(bytes, [structuredClone(b.build())])).toThrow(UnsupportedChangeError);
  });
});

describe('saveInWorker', () => {
  function fakeWorker(): IoWorker & { terminate: ReturnType<typeof vi.fn> } {
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(ioApi, port1);
    const terminate = vi.fn(() => {
      port1.close();
      port2.close();
    });
    return Object.assign(port2, { terminate });
  }

  it('saves in a worker, keeps the caller’s bytes for the next save and terminates the worker', async () => {
    const bytes = sampleDwg(ACadVersion.AC1032);
    const { changes } = await session(bytes, ['LINE', '0,0', '10,10', '']);
    const w = fakeWorker();
    const stages: string[] = [];
    const saved = await saveInWorker(bytes, {
      createWorker: () => w,
      changes,
      onProgress: (p) => void stages.push(p.stage),
    });
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(isDxf(saved)).toBe(true);
    expect(header(saved).version).toBe(ACadVersion.AC1032);
    expect(stages).toEqual(['write', 'done']);
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });
});
