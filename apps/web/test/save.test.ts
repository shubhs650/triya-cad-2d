// M2-13: where Save and Save As put the drawing. QSAVE writes in place only over an AC1032 DXF
// it has a handle for; anything else goes to Save As (the save picker, a `.dxf` name), and
// without File System Access both download. The bytes opened stay the start of every save.
import type { ChangeSet } from '@triya/engine';
import type { OpenResult } from '@triya/io';
import { describe, expect, it, vi } from 'vitest';
import { DocumentStore, isDirty } from '../src/documents';
import { SaveChangesPrompt } from '../src/save-changes';
import {
  drawingFile,
  dxfName,
  saveDrawing,
  type DrawingFile,
  type SaveEnv,
  type SaveHandle,
} from '../src/save';

const BYTES = new Uint8Array([1, 2, 3]);
const OUT = new Uint8Array([9, 9]);
const CHANGES: ChangeSet[] = [{ header: [{ name: '$LTSCALE', before: 1, after: 2 }] }];

function handle(name: string, permission: 'granted' | 'prompt' | 'denied' = 'granted') {
  const written: Blob[] = [];
  const h = {
    kind: 'file' as const,
    name,
    getFile: () => Promise.resolve(new Blob([BYTES])),
    createWritable: vi.fn(() =>
      Promise.resolve({
        write: (b: Blob) => Promise.resolve(void written.push(b)),
        close: () => Promise.resolve(),
      }),
    ),
    queryPermission: vi.fn(() => Promise.resolve(permission)),
    requestPermission: vi.fn(() =>
      Promise.resolve(permission === 'prompt' ? 'granted' : permission),
    ),
  };
  return { h: h satisfies SaveHandle, written };
}

function env(picked?: SaveHandle | 'none'): SaveEnv & { downloads: [string, Uint8Array][] } {
  const downloads: [string, Uint8Array][] = [];
  return {
    downloads,
    write: vi.fn(() => Promise.resolve(OUT)),
    ...(picked !== 'none' && { pick: vi.fn(() => Promise.resolve(picked)) }),
    download: (name, bytes) => void downloads.push([name, bytes]),
  };
}

describe('drawingFile', () => {
  it('saves in place over an AC1032 DXF it has a handle for, and nothing else', () => {
    const { h } = handle('a.dxf');
    expect(drawingFile(BYTES, { format: 'dxf', version: 'AC1032' }, h).inPlace).toBe(true);
    expect(drawingFile(BYTES, { format: 'dxf', version: 'AC1032' }, undefined).inPlace).toBe(false);
    expect(drawingFile(BYTES, { format: 'dxf', version: 'AC1027' }, h).inPlace).toBe(false);
    expect(drawingFile(BYTES, { format: 'dwg', version: 'AC1032' }, h).inPlace).toBe(false);
  });
});

describe('dxfName', () => {
  it('suggests the drawing’s name as a .dxf', () => {
    expect(dxfName('plant.dwg')).toBe('plant.dxf');
    expect(dxfName('Plant.DXF')).toBe('Plant.dxf');
    expect(dxfName('a.b.dwg')).toBe('a.b.dxf');
    expect(dxfName('notes')).toBe('notes.dxf');
    expect(dxfName('.dwg')).toBe('Drawing1.dxf');
  });
});

describe('saveDrawing', () => {
  it('QSAVE writes an AC1032 DXF over the file it was opened from', async () => {
    const { h, written } = handle('a.dxf', 'prompt');
    const e = env();
    const file = drawingFile(BYTES, { format: 'dxf', version: 'AC1032' }, h);
    const r = await saveDrawing('a.dxf', file, CHANGES, 'qsave', e);
    expect(r).toEqual({
      ok: true,
      name: 'a.dxf',
      file: { bytes: BYTES, handle: h, inPlace: true },
    });
    expect(e.write).toHaveBeenCalledWith(BYTES, CHANGES);
    expect(e.pick).not.toHaveBeenCalled();
    expect(h.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(new Uint8Array(await written[0]!.arrayBuffer())).toEqual(OUT);
  });

  it('QSAVE of a DWG goes to Save As: a new .dxf, never the DWG', async () => {
    const dwg = handle('plant.dwg');
    const dxf = handle('plant.dxf');
    const e = env(dxf.h);
    const file = drawingFile(BYTES, { format: 'dwg', version: 'AC1018' }, dwg.h);
    const r = await saveDrawing('plant.dwg', file, CHANGES, 'qsave', e);
    expect(e.pick).toHaveBeenCalledWith('plant.dxf');
    expect(dwg.h.createWritable).not.toHaveBeenCalled();
    expect(dxf.written).toHaveLength(1);
    // Save writes the new file in place from now on, still from the DWG's bytes and the log.
    expect(r).toEqual({
      ok: true,
      name: 'plant.dxf',
      file: { bytes: BYTES, handle: dxf.h, inPlace: true },
    });
  });

  it('QSAVE of an older DXF goes to Save As too', async () => {
    const old = handle('old.dxf');
    const e = env(handle('old.dxf').h);
    const file = drawingFile(BYTES, { format: 'dxf', version: 'AC1009' }, old.h);
    await saveDrawing('old.dxf', file, CHANGES, 'qsave', e);
    expect(e.pick).toHaveBeenCalledWith('old.dxf');
    expect(old.h.createWritable).not.toHaveBeenCalled();
  });

  it('Save As always asks, even for a file it could save in place', async () => {
    const { h } = handle('a.dxf');
    const e = env(handle('b.dxf').h);
    const r = await saveDrawing(
      'a.dxf',
      drawingFile(BYTES, { format: 'dxf', version: 'AC1032' }, h),
      [],
      'saveas',
      e,
    );
    expect(e.pick).toHaveBeenCalledWith('a.dxf');
    expect(r.ok && r.name).toBe('b.dxf');
  });

  it('a cancelled picker saves nothing', async () => {
    const e = env(undefined);
    const r = await saveDrawing('a.dwg', { bytes: BYTES, inPlace: false }, [], 'qsave', e);
    expect(r).toEqual({ ok: false, cancelled: true, message: 'Save cancelled.' });
    expect(e.write).not.toHaveBeenCalled();
    const aborted = {
      ...env(),
      pick: () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })),
    };
    expect(
      await saveDrawing('a.dwg', { bytes: BYTES, inPlace: false }, [], 'saveas', aborted),
    ).toMatchObject({ cancelled: true });
  });

  it('downloads the .dxf without File System Access', async () => {
    const e = env('none');
    const r = await saveDrawing('plant.dwg', { bytes: BYTES, inPlace: false }, CHANGES, 'qsave', e);
    expect(e.downloads).toEqual([['plant.dxf', OUT]]);
    expect(r).toEqual({ ok: true, name: 'plant.dxf', file: { bytes: BYTES, inPlace: false } });
  });

  it('says why a save failed, and leaves the file as it was', async () => {
    const { h, written } = handle('a.dxf', 'denied');
    const file: DrawingFile = { bytes: BYTES, handle: h, inPlace: true };
    expect(await saveDrawing('a.dxf', file, [], 'qsave', env())).toEqual({
      ok: false,
      message: 'a.dxf was not saved: writing to it was not allowed.',
    });
    const refusing = {
      ...env(),
      write: () => Promise.reject(new Error('cannot save these changes yet: X')),
    };
    const ok = handle('a.dxf');
    expect(await saveDrawing('a.dxf', { ...file, handle: ok.h }, [], 'qsave', refusing)).toEqual({
      ok: false,
      message: 'a.dxf was not saved: cannot save these changes yet: X',
    });
    expect(written).toEqual([]);
    expect(ok.written).toEqual([]);
  });
});

describe('unsaved changes (DocumentStore)', () => {
  it('a drawing edit leaves the drawing dirty until a save holds it; loading an xref does not', () => {
    const s = new DocumentStore();
    const id = s.opened('a.dxf', {} as OpenResult, '1F', { bytes: BYTES, inPlace: false });
    const doc = () => s.getSnapshot().docs[0]!;
    expect(isDirty(doc())).toBe(false);
    s.edited(id, false);
    expect(isDirty(doc())).toBe(false);
    s.edited(id);
    s.edited(id);
    expect(isDirty(doc())).toBe(true);
    // A save that began after the first edit leaves the second one unsaved.
    s.saved(id, 'b.dxf', { bytes: BYTES, inPlace: true }, 1);
    expect(doc()).toMatchObject({ name: 'b.dxf', file: { inPlace: true } });
    expect(isDirty(doc())).toBe(true);
    expect(s.getSnapshot().notice).toBe('Saved b.dxf.');
    s.saved(id, 'b.dxf', { bytes: BYTES, inPlace: true }, 2);
    expect(isDirty(doc())).toBe(false);
    s.dismissNotice();
    expect(s.getSnapshot().notice).toBeUndefined();
    s.fail('b.dxf was not saved: x');
    expect(s.getSnapshot().error).toBe('b.dxf was not saved: x');
  });
});

describe('the Save changes question (CLOSE)', () => {
  it('waits for Yes, No or Cancel, one question at a time', async () => {
    const p = new SaveChangesPrompt();
    const seen: (string | undefined)[] = [];
    p.subscribe(() => seen.push(p.get()?.name));
    const first = p.ask('a.dxf');
    expect(p.get()).toEqual({ name: 'a.dxf' });
    const second = p.ask('b.dxf');
    expect(await first).toBe('cancel');
    p.answer('yes');
    expect(await second).toBe('yes');
    expect(p.get()).toBeUndefined();
    p.answer('no');
    expect(seen).toEqual(['a.dxf', undefined, 'b.dxf', undefined]);
  });
});
