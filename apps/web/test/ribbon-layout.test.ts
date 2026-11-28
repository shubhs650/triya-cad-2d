// M7-01: the ribbon's data model (ribbon.config.ts) and its responsive layout (UI_SPEC.md §3,
// DEC-017). The breakpoints, each item's size at each, the protected Home Draw/Modify/Annotation
// panels that never compress, and the order the other Home panels give up their room in.
import { describe, expect, it } from 'vitest';
import { TABLE_CELL_OPTIONS, builtinCommands, type RibbonProperties } from '@triya/engine';
import { STYLE_CONTROLS, controlState, isStyleControl } from '../src/ribbon/RibbonControls';
import { DRAFTING_ITEMS } from '../src/drafting';
import {
  CONTEXTUAL_TABS,
  RIBBON_TABS,
  contextualTabOf,
  type RibbonControl,
  type RibbonItem,
  type RibbonTab,
} from '../src/ribbon/ribbon.config';
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
  it('has the tabs of UI_SPEC §2 in order, Home first with its AutoCAD panels', () => {
    expect(RIBBON_TABS.map((t) => t.label)).toEqual([
      'Home',
      'Insert',
      'Annotate',
      'Parametric',
      'View',
      'Output',
      'Layout',
      'Tools',
    ]);
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
      // M8-03: LIBRARY.
      'Library',
      'Import',
      'Data',
    ]);
  });

  it('gives the other tabs their AutoCAD panels (M7-02 part 2)', () => {
    const labels = (id: string) => tab(id).panels.map((p) => p.label);
    expect(labels('annotate')).toEqual([
      'Text',
      'Dimensions',
      'Centerlines',
      'Leaders',
      'Tables',
      'Markup',
      'Annotation Scaling',
    ]);
    expect(labels('view')).toEqual([
      'Navigate',
      'Viewport Tools',
      'Model Viewports',
      'Palettes',
      'Interface',
      // M8-06: COMPARE.
      'Compare',
    ]);
    // Parametric (M9-05, M9-03 part 3; Manage with PARAMETERS, part 5).
    expect(labels('parametric')).toEqual(['Geometric', 'Dimensional', 'Manage']);
    expect(labels('output')).toEqual(['Plot', 'Export', 'Publish']);
    expect(labels('layout')).toEqual(['Layout', 'Layout Viewports']);
    expect(labels('tools')).toEqual(['Drawing Utilities', 'Settings', 'Customization', 'Help']);
    // Every panel outside Home's protected three can give up room, in a distinct order.
    for (const t of RIBBON_TABS.filter((x) => x.id !== 'home' && x.id !== 'insert')) {
      const orders = t.panels.map((p) => p.compress?.order);
      expect(
        orders.every((o) => o !== undefined),
        t.id,
      ).toBe(true);
      expect(new Set(orders).size, t.id).toBe(orders.length);
      for (const p of t.panels)
        for (const k of p.compress!.keep)
          expect(
            p.items.map((i) => i.id),
            `${t.id}/${p.id}`,
          ).toContain(k);
    }
  });

  it("greys out Annotation Scaling's annotative tools, saying why (DEC-058)", () => {
    const scaling = panel(tab('annotate'), 'annotation-scaling').items;
    expect(scaling.map((i) => [i.label, i.unavailable])).toEqual([
      ['Scale List', undefined],
      ['Add/Delete Scales', 'Annotative creation is view-only in v1'],
      ['Sync Scale Positions', 'Annotative creation is view-only in v1'],
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
    for (const t of [...RIBBON_TABS, ...CONTEXTUAL_TABS])
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
          if (i.unavailable) continue;
          if ('command' in i.run) expect(registry.resolve(i.run.command), where).toBeDefined();
          // A contextual tab's option (M7-02 part 4): a keyword, or Enter.
          else if ('keyword' in i.run) expect(i.run.keyword, where).toMatch(/^[A-Za-z]*$/);
          else if (i.run.action.startsWith('drafting:'))
            expect(toggles.has(i.run.action), where).toBe(true);
          else if (!i.control)
            expect(i.run.action, where).toMatch(
              /^(palette:(diagnostics|health|history)|theme:(system|light|dark)|app:(aliases|shortcuts|about)|escape|text:(bold|italic|underline|overline|strike|stack|paragraph|columns|field|spell|close))$/,
            );
          // A dropdown (M7-02 part 3) opens its own list.
          if (i.control) expect(i.run, where).toEqual({ action: `control:${i.control}` });
        }
  });

  it('shows the contextual tab of the command running, the Block Editor or the selection', () => {
    const shown = (c: Parameters<typeof contextualTabOf>[0]) => contextualTabOf(c)?.id;
    expect(shown({})).toBeUndefined();
    expect(shown({ command: 'HATCH' })).toBe('hatch-creation');
    expect(shown({ command: 'GRADIENT' })).toBe('hatch-creation');
    expect(shown({ command: 'ARRAYRECT' })).toBe('array-creation-rect');
    expect(shown({ command: 'ARRAYPOLAR' })).toBe('array-creation-polar');
    expect(shown({ command: 'ARRAYPATH' })).toBe('array-creation-path');
    expect(shown({ command: 'TABLECELL' })).toBe('table-cell');
    // Table Cell's buttons are TABLECELL's options, typed whole.
    const cell = CONTEXTUAL_TABS.find((t) => t.id === 'table-cell')!;
    for (const i of flat(cell.panels.flatMap((p) => p.items)))
      if ('keyword' in i.run) expect(TABLE_CELL_OPTIONS, i.id).toContain(i.run.keyword);
    expect(shown({ command: 'LINE' })).toBeUndefined();
    expect(shown({ blockEditor: true })).toBe('block-editor');
    expect(shown({ selection: 'hatch' })).toBe('hatch-editor');
    expect(shown({ selection: 'image' })).toBe('image');
    expect(shown({ selection: 'pdf' })).toBe('pdf-underlay');
    expect(shown({ selection: 'xref' })).toBe('external-reference');
    expect(shown({ selection: 'array' })).toBe('array');
    // A command's tab shows over the Block Editor's, and that over a selection's.
    expect(shown({ command: 'HATCH', selection: 'hatch' })).toBe('hatch-creation');
    expect(shown({ blockEditor: true, selection: 'hatch' })).toBe('block-editor');
    // The Text Editor's tab (part 5) shows over every other while the in-place editor is open.
    expect(shown({ textEditor: true })).toBe('text-editor');
    expect(shown({ textEditor: true, command: 'MTEXT', selection: 'hatch' })).toBe('text-editor');
    expect(shown({ textEditor: false, command: 'MTEXT' })).toBeUndefined();
    // Every contextual tab ends with its Close button, which never gives up room; its other
    // panels compress in a distinct order, keeping items they have.
    for (const t of CONTEXTUAL_TABS) {
      expect(t.panels.at(-1)!.id, t.id).toBe('close');
      expect(t.panels.at(-1)!.items.map((i) => i.label)[0], t.id).toMatch(/^Close /);
      expect(t.panels.at(-1)!.compress, t.id).toBeUndefined();
      const rest = t.panels.slice(0, -1);
      const orders = rest.map((p) => p.compress?.order);
      expect(new Set(orders).size, t.id).toBe(orders.length);
      for (const p of rest) {
        expect(p.compress, `${t.id}/${p.id}`).toBeDefined();
        for (const k of p.compress!.keep)
          expect(
            p.items.map((i) => i.id),
            `${t.id}/${p.id}`,
          ).toContain(k);
      }
    }
  });

  it("has AutoCAD's Layers and Properties dropdowns on Home (M7-02 part 3)", () => {
    const controls = (id: string) =>
      panel(home, id)
        .items.filter((i) => i.control)
        .map((i) => [i.label, i.control]);
    expect(controls('layers')).toEqual([['Layer', 'layer']]);
    expect(controls('properties')).toEqual([
      ['Object Color', 'color'],
      ['Linetype', 'linetype'],
      ['Lineweight', 'lineweight'],
      ['Transparency', 'transparency'],
    ]);
    // The layer list names the layer at every size; the others show a swatch on one row.
    const layer = panel(home, 'layers').items.find((i) => i.control === 'layer')!;
    for (const bp of BREAKPOINTS) expect(sizeAt(layer, bp)).toBe('small-label');
  });

  it("has Annotate's style dropdowns, listing the styles and the current one (M7-02 part 5)", () => {
    const annotate = tab('annotate');
    const controls = annotate.panels.flatMap((p) =>
      p.items.filter((i) => i.control).map((i) => `${p.id}/${i.control}`),
    );
    expect(controls).toEqual([
      'text/text-style',
      'dimensions/dim-style',
      'leaders/mleader-style',
      'tables/table-style',
    ]);
    const styles = { current: 'Notes', names: ['Notes', 'Standard'] };
    const p = {
      count: 0,
      rows: [],
      layers: [],
      currentLayer: '0',
      styles: { text: styles, dim: { names: [] }, mleader: styles, table: styles },
    } as unknown as RibbonProperties;
    const text = controlState('text-style', p, 'mm');
    expect(text.text).toBe('Notes');
    expect(text.selected).toBe('Notes');
    // The list ends with AutoCAD's "Manage ... Styles...", which runs the style's command.
    expect(text.choices.map((c) => [c.label, c.opens])).toEqual([
      ['Notes', undefined],
      ['Standard', undefined],
      ['Manage Text Styles...', 'STYLE'],
    ]);
    expect(controlState('dim-style', p, 'mm').text).toBe('');
    for (const [control, { manage }] of Object.entries(STYLE_CONTROLS)) {
      expect(builtinCommands().resolve(manage), control).toBeDefined();
      expect(isStyleControl(control as RibbonControl)).toBe(true);
    }
    expect(isStyleControl('layer')).toBe(false);
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
    // Block collapses to Insert + overflow; Layers to Layer Properties + its dropdown, which
    // still names the layer (M7-02 part 3).
    expect(of('block').shown.map((s) => s.item.id)).toEqual(['insert']);
    expect(of('block').overflow.map((i) => i.id)).toEqual(['create', 'edit', 'edit-attributes']);
    expect(of('layers').shown.map((s) => [s.item.id, s.size])).toEqual([
      ['layer-properties', 'icon'],
      ['layer-control', 'small-label'],
    ]);
    expect(of('layers').overflow.length).toBeGreaterThan(5);
    // Properties keeps Match Properties; its dropdowns go to its list, as one popover.
    expect(of('properties').shown.map((s) => s.item.id)).toEqual(['match-properties']);
    expect(of('properties').overflow.map((i) => i.control ?? i.id)).toEqual([
      'color',
      'linetype',
      'lineweight',
      'transparency',
      'properties',
    ]);
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
