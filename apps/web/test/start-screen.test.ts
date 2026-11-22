// M7-07: the start screen's Samples (drawings from the public corpus, UI_SPEC.md §10) and its
// "Coming from AutoCAD" guide, whose every command, alias and key must be one Triya has.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { builtinCommands } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { KEY_ACTIONS } from '../src/keymap';
import { GUIDE, LEARN_LINKS, SAMPLES } from '../src/start-screen';

const repo = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));

interface CorpusEntry {
  readonly path: string;
  readonly license: string;
  readonly tags?: readonly string[];
}
const corpus = (
  JSON.parse(readFileSync(repo('corpus/corpus.json'), 'utf8')) as { files: CorpusEntry[] }
).files;

describe('start screen samples', () => {
  it('are public corpus drawings Triya may ship (MIT), DXF and not malformed', () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(4);
    for (const s of SAMPLES) {
      const entry = corpus.find((e) => `corpus/${e.path}` === s.corpus);
      expect(entry, s.corpus).toBeDefined();
      expect(entry!.license).toBe('MIT');
      expect(entry!.tags ?? []).not.toContain('malformed');
      expect(s.corpus).toMatch(/\.dxf$/);
      expect(s.file).toBe(s.corpus.split('/').pop());
    }
  });

  it('are pictured by their reviewed golden image (M1-24), so the picture is what opens', () => {
    for (const s of SAMPLES) {
      // The goldens mirror the corpus folders, third-party/ left out.
      const golden = s.corpus.replace(
        /^corpus\/public\/(third-party\/)?/,
        'corpus/public/refs/golden/',
      );
      expect(s.picturePath).toMatch(new RegExp(`^${golden.replaceAll('.', '\\.')}/`));
      expect(existsSync(repo(s.picturePath)), s.picturePath).toBe(true);
    }
  });

  it('each have a name, a line on what they show and where they come from', () => {
    const ids = new Set(SAMPLES.map((s) => s.id));
    expect(ids.size).toBe(SAMPLES.length);
    for (const s of SAMPLES) {
      expect(s.name).not.toBe('');
      expect(s.description).toMatch(/\.$/);
      expect(s.source).toMatch(/\(MIT\)$/);
    }
  });
});

describe('Coming from AutoCAD', () => {
  const registry = builtinCommands();

  it('names only commands Triya has, with their own aliases', () => {
    const named = GUIDE.flatMap((s) => s.items.flatMap((i) => i.commands ?? []));
    expect(named.length).toBeGreaterThan(5);
    for (const c of named) {
      expect(registry.names(), c.name).toContain(c.name);
      for (const a of c.aliases ?? []) expect(registry.aliasesOf(c.name), c.name).toContain(a);
    }
  });

  it("names only keys Triya's keyboard map gives those actions by default", () => {
    const keys = GUIDE.flatMap((s) => s.items.flatMap((i) => i.keys ?? []));
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) {
      const action = KEY_ACTIONS.find((a) => a.id === k.action);
      expect(action, k.action).toBeDefined();
      expect(action!.keys, k.action).toContain(k.key);
    }
  });

  it('has the sections a drafter looks for, each with something in it', () => {
    expect(GUIDE.map((s) => s.title)).toEqual([
      'What works as in AutoCAD',
      'Files',
      'What is different',
      'Red-lining a PDF',
    ]);
    for (const s of GUIDE) expect(s.items.length).toBeGreaterThan(0);
  });
});

describe('learn links', () => {
  it('open the project pages over https in a new tab', () => {
    expect(LEARN_LINKS.map((l) => l.label)).toEqual([
      'Command reference',
      'Source code and issues',
      'Open Engineering Tools',
    ]);
    for (const l of LEARN_LINKS) expect(l.href).toMatch(/^https:\/\//);
  });
});
