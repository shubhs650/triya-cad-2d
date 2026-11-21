// M7-01: the ribbon's data model (ribbon.config.ts) and its responsive layout (UI_SPEC.md §3,
// DEC-017). The breakpoints, each item's size at each, the protected Home Draw/Modify/Annotation
// panels that never compress, and the order the other Home panels give up their room in.
import { describe, expect, it } from 'vitest';
import { builtinCommands } from '@triya/engine';
import { DRAFTING_ITEMS } from '../src/drafting';
import { RIBBON_TABS, type RibbonItem, type RibbonTab } from '../src/ribbon/ribbon.config';
import { ICON_NAMES } from '../src/ribbon/icons';
import {
  BREAKPOINTS,
  ROWS,
  breakpointOf,
  compressionOrder,
  layoutTab,
  sizeAt,
} from '../src/ribbon/layout';

const tab = (id: string): RibbonTab => RIBBON_TABS.find((t) => t.id === id)!;
const home = tab('home');
const panel = (t: RibbonTab, id: string) => t.panels.find((p) => p.id === id)!;
/** An item and the entries of its drop-down list. */
const flat = (items: readonly RibbonItem[]): RibbonItem[] =>
  items.flatMap((i) => [i, ...(i.menu ?? [])]);

describe('breakpoints', () => {
  it('names the viewport widths of UI_SPEC §3', () => {
    expect(breakpointOf(2560)).toBe('full');
    expect(breakpointOf(1920)).toBe('full');
    expect(breakpointOf(1919)).toBe('wide');
    expect(breakpointOf(1600)).toBe('wide');
    expect(breakpointOf(1599)).toBe('laptop');
    expect(breakpointOf(1366)).toBe('laptop');
    expect(breakpointOf(1365)).toBe('compact');
    expect(breakpointOf(1280)).toBe('compact');
    // Below the minimum supported width the compact rules still apply.
    expect(breakpointOf(1000)).toBe('compact');
    expect(BREAKPOINTS).toEqual(['full', 'wide', 'laptop', 'compact']);
  });

  it('lays items out in three labelled rows when full, two when wide, one row of icons below', () => {
    expect(ROWS).toEqual({ full: 3, wide: 2, laptop: 1, compact: 1 });
    const line = panel(home, 'draw').items.find((i) => i.id === 'line')!;
    expect(sizeAt(line, 'full')).toBe('large-label');
    expect(sizeAt(line, 'wide')).toBe('small-label');
    expect(sizeAt(line, 'laptop')).toBe('icon');
    // Compact keeps the laptop's sizes: the explicit rules are { full, wide, laptop }.
    for (const i of flat(RIBBON_TABS.flatMap((t) => t.panels.flatMap((p) => p.items))))
      expect(sizeAt(i, 'compact')).toBe(i.sizes.laptop);
  });
});

describe('the data model', () => {
  it('has Home first with its AutoCAD panels in order, then Insert', () => {
    expect(RIBBON_TABS.map((t) => t.label)).toEqual(['Home', 'Insert']);
    expect(home.panels.map((p) => p.label)).toEqual([
      'Draw',
      'Modify',
      'Annotation',
      'Layers',
      'Block',
      'Properties',
      'Groups',
      'Utilities',
      'Clipboard',
    ]);
    expect(tab('insert').panels.map((p) => p.label)).toEqual([
      'Block',
      'Reference',
      'Import',
      'Data',
    ]);
  });

  it('marks every Home Draw, Modify and Annotation item protected, and nothing else', () => {
    for (const t of RIBBON_TABS)
      for (const p of t.panels) {
        const want = t.id === 'home' && ['draw', 'modify', 'annotation'].includes(p.id);
        for (const i of p.items) expect(i.protected === true, `${t.id}/${p.id}/${i.id}`).toBe(want);
        // A protected panel never gives up room, so it has no compression rule.
        if (want) expect(p.compress).toBeUndefined();
      }
  });

  it('lists the Home Draw, Modify and Annotation items of UI_SPEC §2', () => {
    const labels = (id: string) => panel(home, id).items.map((i) => i.label);
    expect(labels('draw')).toEqual([
      'Line',
      'Polyline',
      'Circle',
      'Arc',
      'Rectangle',
      'Ellipse',
      'Hatch',
      'Spline',
      'Construction Line',
      'Point',
      'Revision Cloud',
      'Wipeout',
    ]);
    expect(labels('modify')).toEqual([
      'Move',
      'Copy',
      'Stretch',
      'Rotate',
      'Mirror',
      'Scale',
      'Trim',
      'Extend',
      'Fillet',
      'Chamfer',
      'Array',
      'Offset',
      'Explode',
      'Erase',
      'Break',
      'Join',
      'Lengthen',
      'Align',
      'Overkill',
    ]);
    expect(labels('annotation')).toEqual(['Text', 'Dimension', 'Leader', 'Table', 'Centerline']);
    // Dropdown groups keep their split button (▾): its list starts with what the button runs.
    const circle = panel(home, 'draw').items.find((i) => i.id === 'circle')!;
    expect(circle.menu?.map((i) => i.label)).toEqual([
      'Center, Radius',
      '2-Point',
      '3-Point',
      'Tan, Tan, Radius',
    ]);
    expect(circle.menu?.[1]?.run).toEqual({ command: 'CIRCLE', keys: ['2P'] });
  });

  it('runs only registered commands and the drafting toggles', () => {
    const registry = builtinCommands();
    const toggles = new Set(DRAFTING_ITEMS.map((i) => i.id));
    const ids = new Set<string>();
    for (const t of RIBBON_TABS)
      for (const p of t.panels)
        for (const i of flat(p.items)) {
          const where = `${t.id}/${p.id}/${i.id}`;
          // Ids are unique within a tab: the tests and the overflow lists find items by them.
          expect(ids.has(`${t.id}/${i.id}`), where).toBe(false);
          ids.add(`${t.id}/${i.id}`);
          // M7-02: a Fluent or CAD icon of the set (ribbon-icons.test.ts checks them).
          expect(ICON_NAMES, where).toContain(i.icon);
          if (i.menu?.length) {
            // A split button runs its list's first entry until another is picked.
            expect(i.run, where).toEqual(i.menu[0]!.run);
            continue;
          }
          if ('command' in i.run) expect(registry.get(i.run.command), where).toBeDefined();
          else expect(toggles.has(i.run.action), where).toBe(true);
        }
  });

  it("puts Snap to Underlays on Insert > Reference as AutoCAD's ON/OFF split button (M5-04)", () => {
    const snap = panel(tab('insert'), 'reference').items.find((i) => i.id === 'underlay-snap')!;
    expect(snap.label).toBe('Snap to Underlays');
    expect(snap.menu?.map((i) => [i.label, i.run])).toEqual([
      ['Snap to Underlays ON', { action: 'drafting:underlaySnap', on: true }],
      ['Snap to Underlays OFF', { action: 'drafting:underlaySnap', on: false }],
    ]);
  });
});

describe('layoutTab', () => {
  it('shows every panel expanded with no compression, at each breakpoint’s sizes', () => {
    for (const bp of BREAKPOINTS) {
      const l = layoutTab(home, bp, 0);
      expect(l.panels.every((p) => p.state === 'expanded')).toBe(true);
      expect(l.panels.every((p) => p.overflow.length === 0)).toBe(true);
      for (const p of l.panels)
        expect(p.shown.map((s) => s.size)).toEqual(p.panel.items.map((i) => sizeAt(i, bp)));
    }
  });

  it('compresses Clipboard, Utilities, Groups, Properties, Block, then Layers', () => {
    expect(compressionOrder(home).map((p) => p.id)).toEqual([
      'clipboard',
      'utilities',
      'groups',
      'properties',
      'block',
      'layers',
    ]);
    const states = (steps: number) =>
      Object.fromEntries(
        layoutTab(home, 'compact', steps).panels.map((p) => [p.panel.id, p.state]),
      );
    expect(states(1)).toMatchObject({ clipboard: 'collapsed', utilities: 'expanded' });
    expect(states(3)).toMatchObject({
      clipboard: 'collapsed',
      utilities: 'collapsed',
      groups: 'collapsed',
      properties: 'expanded',
    });
    expect(states(6)).toMatchObject({
      properties: 'compressed',
      block: 'compressed',
      layers: 'compressed',
    });
    expect(layoutTab(home, 'compact', 5).exhausted).toBe(false);
    expect(layoutTab(home, 'compact', 6).exhausted).toBe(true);
    // Steps past the last change nothing more: the rest of the ribbon scrolls instead.
    expect(layoutTab(home, 'compact', 9)).toEqual(layoutTab(home, 'compact', 6));
  });

  it('keeps what UI_SPEC §3 keeps when a panel compresses, the rest in its overflow list', () => {
    const l = layoutTab(home, 'compact', 6);
    const of = (id: string) => l.panels.find((p) => p.panel.id === id)!;
    // Block collapses to Insert + overflow; Layers to Layer Properties (+ its dropdown, M7-02).
    expect(of('block').shown.map((s) => s.item.id)).toEqual(['insert']);
    expect(of('block').overflow.map((i) => i.id)).toEqual(['create', 'edit', 'edit-attributes']);
    expect(of('layers').shown.map((s) => s.item.id)).toEqual(['layer-properties']);
    expect(of('layers').overflow.length).toBeGreaterThan(5);
    // A collapsed panel is one button whose list is the whole panel.
    expect(of('clipboard').shown).toEqual([]);
    expect(of('clipboard').overflow).toEqual(of('clipboard').panel.items);
  });

  it('never compresses or hides an item of a protected panel', () => {
    for (const bp of BREAKPOINTS)
      for (let steps = 0; steps < 10; steps++)
        for (const p of layoutTab(home, bp, steps).panels.filter((x) => x.protected)) {
          expect(p.state).toBe('expanded');
          expect(p.shown.map((s) => s.item)).toEqual(p.panel.items);
        }
  });
});
