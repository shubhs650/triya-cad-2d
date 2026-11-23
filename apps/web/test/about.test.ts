// M9-07: the About dialog's third-party notices. It lists every component of ATTRIBUTION.md the
// app ships, and the PlaneGCS module's notice (packages/constraints/wasm/NOTICE.md), whose LGPL
// and MPL terms ask for the notice and the source wherever the module is distributed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ABOUT_COMPONENTS,
  SOLVER_NOTICE,
  attributionRows,
  createAboutDialog,
  inlineMarkdown,
  noticeBlocks,
  shippedComponents,
  type Inline,
} from '../src/about';

const repo = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ATTRIBUTION = readFileSync(repo('ATTRIBUTION.md'), 'utf8');
const NOTICE = readFileSync(repo('packages/constraints/wasm/NOTICE.md'), 'utf8');

const links = (inlines: readonly Inline[]) =>
  inlines.filter((i) => i.kind === 'link').map((i) => i.href);
const plain = (inlines: readonly Inline[]) => inlines.map((i) => i.text).join('');

describe('About dialog third-party components', () => {
  it('reads every row of ATTRIBUTION.md', () => {
    const rows = attributionRows(ATTRIBUTION);
    const lines = ATTRIBUTION.split('\n').filter((l) => /^\| [^-]/.test(l));
    // The header row is not a component.
    expect(rows).toHaveLength(lines.length - 1);
    for (const r of rows) {
      expect(r.component, JSON.stringify(r)).not.toBe('');
      expect(r.licence, r.component).not.toBe('');
    }
  });

  it('lists the components the app ships, and only those', () => {
    // A dependency added to ATTRIBUTION.md lands here: shipped ones show in the dialog, the rest
    // say "not shipped", "dev only" or "CI only" in their Use column.
    expect(shippedComponents(ATTRIBUTION).map((c) => plain(inlineMarkdown(c.component)))).toEqual([
      'acad-ts',
      'ACadSharp',
      'ezdxf example and test drawings',
      'PlaneGCS (FreeCAD)',
      'Eigen 3.4.0',
      'Emscripten 3.1.74',
      'Hershey fonts',
      'Microsoft Fluent UI System Icons',
      'pdf.js (pdfjs-dist 6.4.299)',
      'opentype.js 2.0',
      'nspell 2.1.5 (and its dependency is-buffer 2, MIT; @types/nspell 2.1.6, MIT, types only, not shipped)',
      'Hunspell en_US dictionary 2020.12.07 (SCOWL, via dictionary-en 4.0.0)',
      'UTIF.js (utif 3.1.0)',
      'fflate 0.8.2',
      'React 19.2 and React DOM (apps/web, M1-22); @vitejs/plugin-react 5 and @types/react, @types/react-dom (build and types only, not shipped)',
      'Comlink 4.4.2',
    ]);
  });

  it('gives each shipped component its licence and a link to its source', () => {
    expect(ABOUT_COMPONENTS).toEqual(shippedComponents(ATTRIBUTION));
    for (const c of ABOUT_COMPONENTS) {
      const sources = links(inlineMarkdown(c.source));
      expect(sources.length, c.component).toBeGreaterThan(0);
      for (const s of sources) expect(s, c.component).toMatch(/^https?:\/\/[^\s]+[^.,;:)]$/);
    }
    const licence = (name: string) =>
      ABOUT_COMPONENTS.find((c) => c.component.startsWith(name))?.licence;
    expect(licence('PlaneGCS')).toBe('LGPL-2.1+');
    expect(licence('Eigen')).toBe('MPL-2.0');
  });

  it('keeps the Hershey fonts acknowledgement their terms ask for', () => {
    const hershey = ABOUT_COMPONENTS.find((c) => c.component === 'Hershey fonts')!;
    expect(hershey.use).toContain(
      'The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards.',
    );
  });
});

describe('About dialog solver module notice', () => {
  it('is NOTICE.md beside the module', () => {
    expect(SOLVER_NOTICE).toEqual(noticeBlocks(NOTICE));
  });

  it("shows PlaneGCS's LGPL notice and Eigen's MPL notice, each with its source link", () => {
    const [title, ...rest] = SOLVER_NOTICE;
    expect(title).toMatchObject({ kind: 'heading' });
    const items = rest.flatMap((b) => (b.kind === 'list' ? b.items : []));
    const item = (name: string) => items.find((i) => plain(i).startsWith(name))!;
    const planegcs = item('PlaneGCS');
    expect(plain(planegcs)).toContain('GNU Lesser General Public License version 2.1 or later');
    expect(links(planegcs)).toContain(
      'https://github.com/FreeCAD/FreeCAD/tree/4fd3bf320d9566a27e60069fc8387448aaa3a094/src/Mod/Sketcher/App/planegcs',
    );
    const eigen = item('Eigen');
    expect(plain(eigen)).toContain('Mozilla Public License 2.0');
    expect(links(eigen)).toEqual(['https://gitlab.com/libeigen/eigen/-/tree/3.4.0']);
  });
});

describe('inlineMarkdown', () => {
  it('reads bold, code and bare links, leaving the punctuation after a link out of it', () => {
    expect(inlineMarkdown('**Eigen** 3.4.0 in `wasm`. Source: https://example.org/a/b.')).toEqual([
      { kind: 'strong', text: 'Eigen' },
      { kind: 'text', text: ' 3.4.0 in ' },
      { kind: 'code', text: 'wasm' },
      { kind: 'text', text: '. Source: ' },
      { kind: 'link', text: 'https://example.org/a/b', href: 'https://example.org/a/b' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('reads several links in one cell', () => {
    expect(links(inlineMarkdown('http://a.example/, https://b.example/x'))).toEqual([
      'http://a.example/',
      'https://b.example/x',
    ]);
  });

  it('keeps text without markup as it is', () => {
    expect(inlineMarkdown('MIT')).toEqual([{ kind: 'text', text: 'MIT' }]);
    expect(inlineMarkdown('')).toEqual([]);
  });
});

describe('noticeBlocks', () => {
  it('reads headings, paragraphs and lists', () => {
    expect(noticeBlocks('# Title\n\nOne\nline.\n\n- a\n- b `c`\n\nEnd.\n')).toEqual([
      { kind: 'heading', inlines: [{ kind: 'text', text: 'Title' }] },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'One line.' }] },
      {
        kind: 'list',
        items: [
          [{ kind: 'text', text: 'a' }],
          [
            { kind: 'text', text: 'b ' },
            { kind: 'code', text: 'c' },
          ],
        ],
      },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'End.' }] },
    ]);
  });
});

describe('the About dialog store', () => {
  it('opens for ABOUT and Tools > About, and answers ABOUT when it closes', async () => {
    const about = createAboutDialog();
    const seen: boolean[] = [];
    const off = about.subscribe(() => seen.push(about.get()));
    expect(about.get()).toBe(false);
    let answered = 0;
    const waits = [about.show(), about.show()].map((p) => p.then(() => answered++));
    expect(about.get()).toBe(true);
    await Promise.resolve();
    expect(answered).toBe(0);
    about.close();
    await Promise.all(waits);
    expect(answered).toBe(2);
    expect(about.get()).toBe(false);
    about.close();
    expect(seen).toEqual([true, false]);
    off();
  });
});
