// M5-10: the bundled templates a new drawing starts from, and new drawings' names.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUNDLED_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  NO_TEMPLATE,
  describeTemplateHeader,
  newDrawingName,
  readTemplateHeader,
  selectTemplate,
  templateById,
  templateFiles,
  userTemplates,
} from '../src/templates';
import { SupportFileStore, type StoredSupportFile } from '../src/support-files';

const asset = (file: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../assets/templates/${file}`, import.meta.url))),
  );

describe('the bundled templates', () => {
  it('lists Triya ISO (mm) and Triya ANSI (inch), ISO the default', () => {
    expect(BUNDLED_TEMPLATES.map((t) => [t.id, t.name, t.file])).toEqual([
      ['triya-iso', 'Triya ISO (mm)', 'triya-iso.dxf'],
      ['triya-ansi', 'Triya ANSI (inch)', 'triya-ansi.dxf'],
    ]);
    expect(templateById(DEFAULT_TEMPLATE_ID)?.name).toBe('Triya ISO (mm)');
    expect(templateById('nope')).toBeUndefined();
  });

  it('loads each template’s file byte for byte', async () => {
    for (const t of BUNDLED_TEMPLATES) {
      const file = readFileSync(
        fileURLToPath(new URL(`../../../assets/templates/${t.file}`, import.meta.url)),
      );
      expect(await t.load()).toEqual(new Uint8Array(file));
    }
  });
});

describe('newDrawingName', () => {
  it('numbers new drawings as AutoCAD does, from the lowest number no open drawing has', () => {
    expect(newDrawingName([])).toBe('Drawing1.dxf');
    expect(newDrawingName(['plan.dxf', 'Drawing1.dxf'])).toBe('Drawing2.dxf');
    expect(newDrawingName(['drawing1.DXF', 'Drawing3.dxf'])).toBe('Drawing2.dxf');
  });
});

describe('selectTemplate', () => {
  it('answers NEW with the template chosen, or nothing on Cancel', async () => {
    let heard = 0;
    const stop = selectTemplate.subscribe(() => heard++);
    const first = selectTemplate.show();
    expect(selectTemplate.isOpen()).toBe(true);
    selectTemplate.close(BUNDLED_TEMPLATES[1]);
    expect(await first).toBe(BUNDLED_TEMPLATES[1]);
    expect(selectTemplate.isOpen()).toBe(false);
    const second = selectTemplate.show();
    // Showing it again answers the one before with nothing.
    const third = selectTemplate.show();
    expect(await second).toBeUndefined();
    selectTemplate.close();
    expect(await third).toBeUndefined();
    stop();
    expect(heard).toBe(5);
  });
});

describe('Open with no template (M5-10 part 2)', () => {
  it('opens the imperial and metric drawings, which are not templates QNEW can default to', async () => {
    expect(await NO_TEMPLATE.imperial.load()).toEqual(asset('no-template-imperial.dxf'));
    expect(await NO_TEMPLATE.metric.load()).toEqual(asset('no-template-metric.dxf'));
    expect(templateById(NO_TEMPLATE.imperial.id)).toBeUndefined();
  });
});

describe('readTemplateHeader', () => {
  it('reads the release, measurement and units of an ASCII DXF’s header', () => {
    expect(readTemplateHeader(asset('triya-iso.dxf'))).toEqual({
      binary: false,
      version: 'AC1032',
      measurement: 1,
      insunits: 4,
    });
    const ansi = readTemplateHeader(asset('triya-ansi.dxf'));
    expect(describeTemplateHeader(ansi as never)).toBe('AutoCAD 2018 DXF, imperial, inches');
    expect(describeTemplateHeader(readTemplateHeader(asset('triya-iso.dxf')) as never)).toBe(
      'AutoCAD 2018 DXF, metric, millimetres',
    );
  });

  it('takes a DXF with comments and no header, recognises a binary DXF, and refuses the rest', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(
      readTemplateHeader(enc('999\r\nmade by hand\r\n  0\r\nSECTION\r\n  2\r\nENTITIES\r\n')),
    ).toEqual({
      binary: false,
    });
    expect(describeTemplateHeader({ binary: false })).toBe('DXF');
    const binary = readTemplateHeader(enc('AutoCAD Binary DXF\r\n\x1a\0...'));
    expect(binary).toEqual({ binary: true });
    expect(describeTemplateHeader(binary as never)).toBe('Binary DXF');
    expect(readTemplateHeader(enc('AC1032 a DWG file'))).toEqual({ error: 'is not a DXF file' });
    expect(readTemplateHeader(enc('  0\nLINE\n'))).toEqual({ error: 'is not a DXF file' });
    expect(readTemplateHeader(new Uint8Array())).toEqual({ error: 'is not a DXF file' });
  });
});

/** The device store's stand-in. */
function memory(initial: StoredSupportFile[] = []) {
  const p = {
    rows: [...initial],
    load: () => Promise.resolve({ files: [...p.rows], unreadable: [] }),
    put: (f: StoredSupportFile) => {
      p.rows = [...p.rows.filter((r) => r.name !== f.name), f];
      return Promise.resolve();
    },
    remove: (name: string) => {
      p.rows = p.rows.filter((r) => r.name !== name);
      return Promise.resolve();
    },
  };
  return p;
}

describe('the user templates folder (M5-10 part 2)', () => {
  const opened: Uint8Array[] = [];
  const open = (bytes: Uint8Array) => {
    opened.push(bytes);
    const text = new TextDecoder().decode(bytes);
    if (text.includes('BROKEN')) return Promise.reject(new Error('a table record has no name'));
    return Promise.resolve({ modelSpace: text.includes('NOMODEL') ? undefined : '1F' });
  };
  const kind = templateFiles(open);

  it('takes .dxf files only', () => {
    expect(kind.folder).toBe('templates');
    expect(kind.accepts('Plant.DXF')).toBe(true);
    expect(kind.accepts('plant.dwt')).toBe(false);
    expect(kind.accepts('plant.dwg')).toBe(false);
  });

  it('opens a template as it is added, keeps it and lists what its header holds', async () => {
    const db = memory();
    const s = new SupportFileStore(kind, db);
    const iso = asset('triya-iso.dxf');
    await s.add('Office A3.dxf', iso);
    expect(opened.at(-1)).toEqual(iso);
    // The worker takes a copy, never the kept bytes.
    expect(opened.at(-1)).not.toBe(iso);
    expect(s.getSnapshot().files).toEqual([
      { name: 'Office A3.dxf', summary: 'AutoCAD 2018 DXF, metric, millimetres' },
    ]);
    expect(s.getSnapshot().notice).toBe(
      'Added template Office A3.dxf (AutoCAD 2018 DXF, metric, millimetres).',
    );
    expect(db.rows.map((r) => r.name)).toEqual(['Office A3.dxf']);

    // A reload lists it again from its header, without opening it.
    const count = opened.length;
    const again = new SupportFileStore(kind, db);
    await again.load();
    expect(again.getSnapshot().files.map((f) => f.name)).toEqual(['Office A3.dxf']);
    expect(opened.length).toBe(count);
  });

  it('refuses a file that is not a DXF, one that does not open, and one with no model space', async () => {
    const db = memory();
    const s = new SupportFileStore(kind, db);
    const enc = (t: string) => new TextEncoder().encode(t);
    await s.add('notes.dxf', enc('hello'));
    expect(s.getSnapshot().error).toBe('notes.dxf is not a DXF file.');
    await s.add('bad.dxf', enc('  0\nSECTION\n  2\nHEADER\n  9\nBROKEN\n  0\nENDSEC\n'));
    expect(s.getSnapshot().error).toBe(
      'bad.dxf cannot be a template: it could not be opened (a table record has no name).',
    );
    await s.add('empty.dxf', enc('  0\nSECTION\n  2\nHEADER\n  9\nNOMODEL\n  0\nENDSEC\n'));
    expect(s.getSnapshot().error).toBe(
      'empty.dxf cannot be a template: the drawing has no model space.',
    );
    expect(s.getSnapshot().files).toEqual([]);
    expect(db.rows).toEqual([]);
  });

  it('says it is checking a template while it opens', async () => {
    let finish: (v: { modelSpace: unknown }) => void = () => {};
    const slow = templateFiles(() => new Promise((r) => (finish = r)));
    const s = new SupportFileStore(slow, memory());
    const adding = s.add('slow.dxf', asset('triya-ansi.dxf'));
    await Promise.resolve();
    expect(s.getSnapshot().notice).toBe('Checking slow.dxf…');
    expect(s.getSnapshot().files).toEqual([]);
    finish({ modelSpace: '1F' });
    await adding;
    expect(s.getSnapshot().files.map((f) => f.name)).toEqual(['slow.dxf']);
  });

  it('lists the user’s templates for the Select Template dialog and finds one by id', async () => {
    const bytes = asset('triya-ansi.dxf');
    const list = userTemplates(
      [{ name: 'Shop B.dxf', summary: 'AutoCAD 2018 DXF, imperial, inches' }],
      (name) => (name === 'Shop B.dxf' ? bytes : undefined),
    );
    expect(list.map((t) => [t.id, t.name, t.file, t.description])).toEqual([
      [
        'user:Shop B.dxf',
        'Shop B',
        'Shop B.dxf',
        'Your template, kept on this device: AutoCAD 2018 DXF, imperial, inches.',
      ],
    ]);
    const loaded = await list[0]!.load();
    expect(loaded).toEqual(bytes);
    expect(loaded).not.toBe(bytes);
    expect(templateById('user:shop b.DXF', list)).toBe(list[0]);
    expect(templateById('user:other.dxf', list)).toBeUndefined();
    expect(templateById('triya-ansi', list)?.name).toBe('Triya ANSI (inch)');

    const gone = userTemplates([{ name: 'Gone.dxf', summary: 'DXF' }], () => undefined);
    await expect(gone[0]!.load()).rejects.toThrow('Gone.dxf was removed');
  });
});
