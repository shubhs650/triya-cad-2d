// M7-02: the ribbon's icons (Fluent UI System Icons and Triya's CAD glyphs) and rich tooltips.
// Every item and split entry has an icon of the set and a description; the set holds no icon
// nothing shows; a tooltip names the command an item runs with its aliases and keys.
import { describe, expect, it } from 'vitest';
import { builtinCommands } from '@triya/engine';
import { CAD_GLYPHS } from '../src/ribbon/cad-icons';
import { FLUENT_ICONS } from '../src/ribbon/fluent-icons';
import { ICON_NAMES, iconArt } from '../src/ribbon/icons';
import { RIBBON_TABS, type RibbonItem } from '../src/ribbon/ribbon.config';
import { descriptionOf, tooltipOf, type TooltipSources } from '../src/ribbon/tooltips';

const flat = (items: readonly RibbonItem[]): RibbonItem[] =>
  items.flatMap((i) => [i, ...(i.menu ?? [])]);
const ALL = RIBBON_TABS.flatMap((t) => t.panels.flatMap((p) => flat(p.items)));
const item = (tab: string, id: string) =>
  flat(RIBBON_TABS.find((t) => t.id === tab)!.panels.flatMap((p) => p.items)).find(
    (i) => i.id === id,
  )!;
/** Icons the app shows outside the ribbon: the Quick Access toolbar's Undo and Redo. */
const ELSEWHERE = ['arrow_undo', 'arrow_redo'];

describe('icons', () => {
  it('gives every item and split entry an icon of the set and a description', () => {
    for (const i of ALL) {
      expect(ICON_NAMES, i.id).toContain(i.icon);
      expect(descriptionOf(i.id), i.id).toMatch(/^[A-Z].*\.$/);
    }
  });

  it('holds only icons something shows, and no name twice', () => {
    const used = new Set<string>([...ALL.map((i) => i.icon), ...ELSEWHERE]);
    expect(ICON_NAMES.filter((n) => !used.has(n))).toEqual([]);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    for (const n of Object.keys(CAD_GLYPHS)) expect(Object.hasOwn(FLUENT_ICONS, n), n).toBe(false);
  });

  it('draws Fluent icons filled and CAD glyphs stroked, dots inside the 20 px grid', () => {
    expect(iconArt('arrow_move').kind).toBe('fluent');
    const arc = iconArt('arc');
    expect(arc.kind).toBe('cad');
    for (const [name, g] of Object.entries(CAD_GLYPHS)) {
      expect(g.d, name).toMatch(/^M/);
      for (const [x, y] of 'dots' in g ? g.dots : []) {
        expect(x, name).toBeGreaterThanOrEqual(1);
        expect(x, name).toBeLessThanOrEqual(19);
        expect(y, name).toBeGreaterThanOrEqual(1);
        expect(y, name).toBeLessThanOrEqual(19);
      }
    }
  });
});

describe('tooltips', () => {
  const registry = builtinCommands();
  const keys: Record<string, string[]> = {
    'command:PASTECLIP': ['Ctrl+V'],
    properties: ['Ctrl+1'],
    'drafting:groups': ['Ctrl+Shift+A'],
  };
  const from: TooltipSources = {
    aliasesOf: (c) => registry.aliasesOf(c),
    keysOf: (a) => keys[a] ?? [],
  };

  it('names the command, its aliases and keys', () => {
    const line = item('home', 'line');
    expect(tooltipOf(line, line, from)).toEqual({
      title: 'Line',
      description: 'Creates straight line segments, each one a separate object.',
      command: 'LINE',
      aliases: ['L'],
      keys: [],
    });
    const paste = item('home', 'paste');
    expect(tooltipOf(paste, paste.menu![0]!, from)).toMatchObject({
      title: 'Paste',
      command: 'PASTECLIP',
      keys: ['Ctrl+V'],
    });
    // PROPERTIES' key is the keymap's Properties palette action (Ctrl+1).
    const props = item('home', 'properties');
    expect(tooltipOf(props, props, from).keys).toEqual(['Ctrl+1']);
  });

  it('titles a split button by the entry it runs, with the keywords it types', () => {
    const circle = item('home', 'circle');
    const twoPoint = circle.menu!.find((e) => e.id === 'circle-2p')!;
    expect(tooltipOf(circle, twoPoint, from)).toMatchObject({
      title: 'Circle: 2-Point',
      description: 'Creates a circle from the two endpoints of a diameter.',
      command: 'CIRCLE',
      keywords: ['2P'],
      aliases: ['C'],
    });
  });

  it('gives a toggle the keys of its drafting setting and no command', () => {
    const groups = item('home', 'group-selection');
    const tip = tooltipOf(groups, groups, from);
    expect(tip.command).toBeUndefined();
    expect(tip.aliases).toEqual([]);
    expect(tip.keys).toEqual(['Ctrl+Shift+A']);
  });
});
