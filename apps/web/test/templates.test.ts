// M5-10: the bundled templates a new drawing starts from, and new drawings' names.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUNDLED_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  newDrawingName,
  selectTemplate,
  templateById,
} from '../src/templates';

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
