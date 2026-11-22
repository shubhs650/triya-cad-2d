// M7-10: Triya's accessibility check, axe-core's rules with "critical" impact and the "serious"
// ARIA naming rules, run on the page as it is. axe-core itself is MPL-2.0, which is not on the
// allowed list (CLAUDE.md, ATTRIBUTION.md), so this re-implements those rules (DEC-079) from
// their published descriptions (https://dequeuniversity.com/rules/axe/4.10) with the WAI-ARIA 1.2
// role model from aria-query (Apache-2.0). Accessible names come from Chromium itself (the
// DevTools protocol's accessibility tree), so a name is what a screen reader would announce.
//
// Rules, by axe id: aria-allowed-attr, aria-hidden-body, aria-required-attr,
// aria-required-children, aria-required-parent, aria-roles, aria-valid-attr,
// aria-valid-attr-value, button-name, image-alt, input-button-name, label and select-name
// (critical); aria-command-name, aria-dialog-name, aria-hidden-focus, aria-input-field-name,
// aria-meter-name, aria-progressbar-name, aria-toggle-field-name, aria-tooltip-name,
// aria-treeitem-name, link-name, nested-interactive, role-img-alt and svg-img-alt (serious).
// Like axe, elements hidden from everyone (display: none, visibility: hidden, aria-hidden, a
// closed dialog) are not checked, and an empty list, menu or table is not an error.
import { aria, roles } from 'aria-query';
import type { Page } from '@playwright/test';

export type Impact = 'critical' | 'serious';

export interface Violation {
  readonly rule: string;
  readonly impact: Impact;
  /** The element: its tag, id, role, label or test id, and its text, enough to find it. */
  readonly target: string;
  readonly detail: string;
}

/** The ARIA tables the in-page part needs, from aria-query. */
interface RoleTable {
  readonly roles: Record<
    string,
    {
      readonly abstract: boolean;
      readonly props: readonly string[];
      readonly required: readonly string[];
      readonly owned: readonly string[];
      readonly context: readonly string[];
    }
  >;
  readonly attrs: Record<string, { readonly type: string; readonly values?: readonly string[] }>;
}

// Where axe's role model (lib/standards/aria-roles.js) differs from aria-query's ARIA 1.2 text,
// axe's is followed, as the acceptance names axe: a state with an ARIA 1.2 default is not
// required (heading's aria-level, option's and treeitem's aria-selected); combobox needs
// aria-controls only while expanded (checked in the page); radiogroup's radios are not required;
// menus may hold separators; options may sit in groups.
const NOT_REQUIRED: Record<string, readonly string[]> = {
  combobox: ['aria-controls'],
  heading: ['aria-level'],
  option: ['aria-selected'],
  treeitem: ['aria-selected'],
  scrollbar: ['aria-controls'],
};
const OWNED: Record<string, readonly string[]> = {
  menu: ['group', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'menu', 'separator'],
  menubar: ['group', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'menu', 'separator'],
  listbox: ['group', 'option'],
  tree: ['group', 'treeitem'],
  grid: ['rowgroup', 'row'],
  table: ['rowgroup', 'row'],
  treegrid: ['rowgroup', 'row'],
};
const CONTEXT: Record<string, readonly string[]> = {
  option: ['listbox', 'group'],
  listitem: ['list', 'directory', 'group'],
};

function roleTable(): RoleTable {
  const table: { roles: RoleTable['roles']; attrs: RoleTable['attrs'] } = {
    roles: {},
    attrs: {},
  };
  for (const [name, r] of roles.entries()) {
    const owned = OWNED[name] ?? [...new Set(r.requiredOwnedElements.flat())];
    table.roles[name] = {
      abstract: r.abstract,
      props: Object.keys(r.props),
      required: Object.keys(r.requiredProps).filter((a) => !NOT_REQUIRED[name]?.includes(a)),
      owned: name === 'radiogroup' ? [] : owned,
      context: CONTEXT[name] ?? r.requiredContextRole,
    };
  }
  for (const [name, a] of aria.entries()) {
    const values = a.values?.map(String);
    table.attrs[name] = values ? { type: a.type, values } : { type: a.type };
  }
  return table;
}

/** The ARIA attribute and structure rules, run in the page on every element shown. */
function ariaRules(table: RoleTable): Omit<Violation, 'impact'>[] {
  const out: Omit<Violation, 'impact'>[] = [];
  const describe = (el: Element): string => {
    const bits = [el.tagName.toLowerCase()];
    for (const a of ['id', 'role', 'aria-label', 'data-testid', 'title', 'class']) {
      const v = el.getAttribute(a);
      if (v) bits.push(`${a}="${v.slice(0, 60)}"`);
    }
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return text ? `${bits.join(' ')} "${text}"` : bits.join(' ');
  };
  const hidden = (el: Element): boolean => {
    if (el.closest('[aria-hidden="true"]')) return true;
    const dialog = el.closest('dialog');
    if (dialog && !dialog.open) return true;
    return !el.checkVisibility({ visibilityProperty: true });
  };
  const owners = new Map<Element, Element>();
  for (const owner of document.querySelectorAll('[aria-owns]')) {
    for (const id of (owner.getAttribute('aria-owns') ?? '').split(/\s+/)) {
      const owned = id && document.getElementById(id);
      if (owned) owners.set(owned, owner);
    }
  }

  /** The element's explicit role, the first token ARIA knows (Chromium reads it so). */
  const explicitRole = (el: Element): string | null => {
    const tokens = (el.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/);
    return tokens.find((t) => table.roles[t] && !table.roles[t].abstract) ?? null;
  };
  /** The role HTML gives the element (html-aam), for the elements Triya uses. */
  const implicitRole = (el: Element): string | null => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    switch (tag) {
      case 'button':
      case 'summary':
        return 'button';
      case 'a':
        return el.hasAttribute('href') ? 'link' : null;
      case 'input':
        if (type === 'hidden') return null;
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'number') return 'spinbutton';
        if (el.hasAttribute('list')) return 'combobox';
        if (type === 'search') return 'searchbox';
        if (['color', 'file', 'date', 'time', 'datetime-local', 'month', 'week'].includes(type))
          return null;
        return 'textbox';
      case 'select': {
        const size = Number(el.getAttribute('size') ?? 0);
        return el.hasAttribute('multiple') || size > 1 ? 'listbox' : 'combobox';
      }
      case 'textarea':
        return 'textbox';
      case 'option':
        return 'option';
      case 'optgroup':
      case 'fieldset':
      case 'details':
        return 'group';
      case 'ul':
      case 'ol':
      case 'menu':
        return 'list';
      case 'li':
        return 'listitem';
      case 'table':
        return 'table';
      case 'tr':
        return 'row';
      case 'thead':
      case 'tbody':
      case 'tfoot':
        return 'rowgroup';
      case 'td':
        return el.closest('table')?.getAttribute('role') === 'grid' ? 'gridcell' : 'cell';
      case 'th':
        return el.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return 'heading';
      case 'img':
        return el.getAttribute('alt') === '' ? 'presentation' : 'img';
      case 'hr':
        return 'separator';
      case 'dialog':
        return 'dialog';
      case 'nav':
        return 'navigation';
      case 'main':
        return 'main';
      case 'aside':
        return 'complementary';
      case 'form':
        return 'form';
      case 'progress':
        return 'progressbar';
      case 'meter':
        return 'meter';
      case 'output':
        return 'status';
      case 'section':
        return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')
          ? 'region'
          : null;
      default:
        return null;
    }
  };
  const roleOf = (el: Element): string | null => explicitRole(el) ?? implicitRole(el);
  const transparent = (role: string | null) =>
    role === null || role === 'generic' || role === 'none' || role === 'presentation';
  const parentOf = (el: Element): Element | null => owners.get(el) ?? el.parentElement;
  const focusable = (el: Element): boolean => {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
    if ((el as HTMLElement).tabIndex < 0 && !el.hasAttribute('tabindex')) return false;
    if (el.hasAttribute('disabled')) return false;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null) return Number(tabindex) >= 0;
    return (el as HTMLElement).tabIndex >= 0;
  };
  const NATIVE_STATE: Record<string, readonly string[]> = {
    // A native control supplies the state its role requires.
    'aria-checked': ['input'],
    'aria-valuenow': ['input', 'progress', 'meter'],
    'aria-expanded': ['select'],
  };

  const WIDGETS = new Set([
    'button',
    'checkbox',
    'combobox',
    'link',
    'listbox',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'radio',
    'searchbox',
    'slider',
    'spinbutton',
    'switch',
    'tab',
    'textbox',
    'treeitem',
  ]);

  const body = document.body;
  if (body.getAttribute('aria-hidden') === 'true')
    out.push({ rule: 'aria-hidden-body', target: 'body', detail: 'aria-hidden on <body>' });

  for (const el of document.body.querySelectorAll('*')) {
    if (hidden(el)) continue;
    const target = describe(el);
    const raw = el.getAttribute('role');
    if (raw !== null && raw.trim() !== '') {
      const first = raw.trim().toLowerCase().split(/\s+/)[0]!;
      if (!table.roles[first] || table.roles[first].abstract)
        out.push({ rule: 'aria-roles', target, detail: `role="${raw}" is not a valid ARIA role` });
    }
    const role = roleOf(el);
    const explicit = explicitRole(el);
    const allowed = new Set(table.roles[role ?? 'roletype']?.props ?? table.roles.roletype!.props);
    for (const attr of el.getAttributeNames()) {
      if (!attr.startsWith('aria-')) continue;
      const def = table.attrs[attr];
      if (!def) {
        out.push({ rule: 'aria-valid-attr', target, detail: `${attr} is not an ARIA attribute` });
        continue;
      }
      if (!allowed.has(attr))
        out.push({
          rule: 'aria-allowed-attr',
          target,
          detail: `${attr} is not allowed on role ${role ?? '(none)'}`,
        });
      const value = (el.getAttribute(attr) ?? '').trim();
      if (value === '') continue;
      let ok = true;
      switch (def.type) {
        case 'boolean':
          ok = value === 'true' || value === 'false';
          break;
        case 'tristate':
          ok = ['true', 'false', 'mixed'].includes(value);
          break;
        case 'integer':
          ok = /^-?\d+$/.test(value);
          break;
        case 'number':
          ok = Number.isFinite(Number(value));
          break;
        case 'token':
          ok = def.values ? def.values.includes(value) : true;
          break;
        case 'tokenlist':
          ok = value.split(/\s+/).every((v) => !def.values || def.values.includes(v));
          break;
        case 'id':
          ok = document.getElementById(value) !== null;
          break;
        case 'idlist': {
          // axe passes aria-describedby, aria-labelledby and aria-owns when one id is there, and
          // aria-controls on a collapsed widget, whose popup may not exist yet.
          const ids = value.split(/\s+/);
          const found = ids.filter((id) => document.getElementById(id));
          if (attr === 'aria-controls' && el.getAttribute('aria-expanded') !== 'true') ok = true;
          else ok = found.length > 0;
          break;
        }
      }
      if (!ok)
        out.push({
          rule: 'aria-valid-attr-value',
          target,
          detail: `${attr}="${value}" is not a valid value`,
        });
    }

    if (explicit) {
      const def = table.roles[explicit]!;
      const tag = el.tagName.toLowerCase();
      for (const attr of def.required) {
        if (el.hasAttribute(attr)) continue;
        if (NATIVE_STATE[attr]?.includes(tag)) continue;
        out.push({ rule: 'aria-required-attr', target, detail: `role ${explicit} needs ${attr}` });
      }
      if (
        explicit === 'combobox' &&
        el.getAttribute('aria-expanded') === 'true' &&
        !el.hasAttribute('aria-controls') &&
        !el.hasAttribute('aria-owns')
      )
        out.push({
          rule: 'aria-required-attr',
          target,
          detail: 'an expanded combobox needs aria-controls',
        });

      if (def.owned.length > 0 && el.getAttribute('aria-busy') !== 'true') {
        // The roles the element owns: its children, looking through generic elements.
        const found: string[] = [];
        const visit = (parent: Element) => {
          const kids = [...parent.children];
          for (const id of (parent.getAttribute('aria-owns') ?? '').split(/\s+/)) {
            const k = id && document.getElementById(id);
            if (k) kids.push(k);
          }
          for (const k of kids) {
            if (hidden(k)) continue;
            const r = roleOf(k);
            if (transparent(r)) {
              if (focusable(k)) found.push('(focusable element without a role)');
              else visit(k);
            } else found.push(r!);
          }
        };
        visit(el);
        const wrong = found.filter((r) => !def.owned.includes(r));
        if (wrong.length > 0)
          out.push({
            rule: 'aria-required-children',
            target,
            detail: `role ${explicit} may own only ${def.owned.join(', ')}; it owns ${[...new Set(wrong)].join(', ')}`,
          });
      }

      if (def.context.length > 0) {
        let p = parentOf(el);
        while (p && transparent(roleOf(p))) p = parentOf(p);
        const pr = p ? roleOf(p) : null;
        if (!pr || !def.context.includes(pr))
          out.push({
            rule: 'aria-required-parent',
            target,
            detail: `role ${explicit} must be inside ${def.context.join(' or ')}, not ${pr ?? 'nothing'}`,
          });
      }
    }

    if (role && WIDGETS.has(role) && focusable(el)) {
      // nested-interactive: a control whose children are presentational holds no focusable one.
      if (
        [
          'button',
          'checkbox',
          'img',
          'link',
          'menuitem',
          'option',
          'radio',
          'switch',
          'tab',
        ].includes(role)
      )
        for (const d of el.querySelectorAll('*'))
          if (focusable(d) && !hidden(d)) {
            out.push({
              rule: 'nested-interactive',
              target,
              detail: `holds the focusable ${describe(d)}`,
            });
            break;
          }
    }
  }

  // aria-hidden-focus: nothing under aria-hidden takes the focus.
  for (const h of document.querySelectorAll('[aria-hidden="true"]')) {
    for (const d of [h, ...h.querySelectorAll('*')])
      if (
        focusable(d) &&
        d.checkVisibility({ visibilityProperty: true }) &&
        !d.closest('[inert]')
      ) {
        out.push({
          rule: 'aria-hidden-focus',
          target: describe(h),
          detail: `holds the focusable ${describe(d)}`,
        });
        break;
      }
  }
  return out;
}

const IMPACT: Record<string, Impact> = {
  'aria-allowed-attr': 'critical',
  'aria-hidden-body': 'critical',
  'aria-required-attr': 'critical',
  'aria-required-children': 'critical',
  'aria-required-parent': 'critical',
  'aria-roles': 'critical',
  'aria-valid-attr': 'critical',
  'aria-valid-attr-value': 'critical',
  'button-name': 'critical',
  'image-alt': 'critical',
  'input-button-name': 'critical',
  label: 'critical',
  'select-name': 'critical',
  'aria-command-name': 'serious',
  'aria-dialog-name': 'serious',
  'aria-hidden-focus': 'serious',
  'aria-input-field-name': 'serious',
  'aria-meter-name': 'serious',
  'aria-progressbar-name': 'serious',
  'aria-toggle-field-name': 'serious',
  'aria-tooltip-name': 'serious',
  'aria-treeitem-name': 'serious',
  'link-name': 'serious',
  'nested-interactive': 'serious',
  'role-img-alt': 'serious',
  'svg-img-alt': 'serious',
};

interface AXNode {
  readonly nodeId: string;
  readonly ignored: boolean;
  readonly role?: { readonly value?: string };
  readonly name?: { readonly value?: string };
  readonly backendDOMNodeId?: number;
}

/** The naming rule an unnamed node breaks, by its role and element; null if none. */
function namingRule(role: string, tag: string, attrs: Map<string, string>): string | null {
  const explicit = attrs.has('role');
  const type = (attrs.get('type') ?? '').toLowerCase();
  if (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(type))
    return 'input-button-name';
  if (tag === 'img') return 'image-alt';
  if (tag === 'svg' && explicit) return 'svg-img-alt';
  if (tag === 'select') return 'select-name';
  if ((tag === 'input' || tag === 'textarea') && !explicit) return 'label';
  switch (role) {
    case 'button':
      return explicit && tag !== 'button' ? 'aria-command-name' : 'button-name';
    case 'link':
      return explicit && tag !== 'a' ? 'aria-command-name' : 'link-name';
    case 'menuitem':
      return 'aria-command-name';
    case 'combobox':
    case 'listbox':
    case 'searchbox':
    case 'slider':
    case 'spinbutton':
    case 'textbox':
      return 'aria-input-field-name';
    case 'checkbox':
    case 'menuitemcheckbox':
    case 'menuitemradio':
    case 'radio':
    case 'switch':
    case 'option':
      return 'aria-toggle-field-name';
    case 'dialog':
    case 'alertdialog':
      return 'aria-dialog-name';
    case 'tooltip':
      return 'aria-tooltip-name';
    case 'treeitem':
      return 'aria-treeitem-name';
    case 'progressbar':
      return 'aria-progressbar-name';
    case 'meter':
      return 'aria-meter-name';
    case 'image':
    case 'img':
      return explicit ? 'role-img-alt' : null;
    default:
      return null;
  }
}

/** The naming rules, on Chromium's own accessibility tree. */
async function namingRules(page: Page): Promise<Violation[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: AXNode[] };
    const out: Violation[] = [];
    for (const n of nodes) {
      if (n.ignored || n.backendDOMNodeId === undefined) continue;
      const role = n.role?.value ?? '';
      if ((n.name?.value ?? '').trim() !== '') continue;
      const { node } = (await cdp.send('DOM.describeNode', {
        backendNodeId: n.backendDOMNodeId,
      })) as { node: { nodeName: string; attributes?: string[] } };
      const attrs = new Map<string, string>();
      const list = node.attributes ?? [];
      for (let i = 0; i + 1 < list.length; i += 2) attrs.set(list[i]!, list[i + 1]!);
      const tag = node.nodeName.toLowerCase();
      // Chromium names a <select>'s own popup and options from the select; they are not checked.
      if (tag === 'option' || role === 'MenuListPopup' || role === 'MenuListOption') continue;
      const rule = namingRule(role, tag, attrs);
      if (!rule) continue;
      const bits = [tag];
      for (const a of ['id', 'role', 'type', 'data-testid', 'class'])
        if (attrs.get(a)) bits.push(`${a}="${attrs.get(a)!.slice(0, 60)}"`);
      out.push({
        rule,
        impact: IMPACT[rule]!,
        target: bits.join(' '),
        detail: `role ${role} has no accessible name`,
      });
    }
    return out;
  } finally {
    await cdp.detach();
  }
}

/**
 * Every violation of the rules above on the page as it is now, the dialogs, palettes, ribbon and
 * menus shown included. A spec expects `critical(...)` (the acceptance) and the serious ones it
 * lists to be empty.
 */
export async function checkA11y(page: Page): Promise<Violation[]> {
  const inPage = await page.evaluate(ariaRules, roleTable());
  const named = await namingRules(page);
  return [...inPage.map((v) => ({ ...v, impact: IMPACT[v.rule]! })), ...named];
}

/** The violations a screen-reader or keyboard user is stopped by: axe's critical and the serious
 * ARIA naming and focus rules above (all of them). */
export const blocking = (vs: readonly Violation[]): string[] =>
  vs.map((v) => `${v.rule} (${v.impact}): ${v.target}: ${v.detail}`);

/** What Tab and Esc do in a dialog: see `keyboardProbe`. */
export interface KeyboardReport {
  /** The focus was in the dialog when it opened. */
  readonly focusInside: boolean;
  /** Tab stops, in order, until the focus came back to the first. */
  readonly stops: readonly string[];
  /** Tab stops outside the dialog. */
  readonly outside: readonly string[];
  /** Controls shown in the dialog that no Tab stop reached (nor arrow keys, for composites). */
  readonly unreached: readonly string[];
  /** Elements that look clickable (pointer cursor) but the keyboard cannot reach. */
  readonly pointerOnly: readonly string[];
}

/**
 * Walks `dialog` (a CSS selector for one open dialog) with Tab: the focus starts inside it,
 * every Tab stop is inside it (a modal dialog keeps the focus), the stops come round to the
 * first, and each enabled control shown is a stop, or an item of a composite widget (tab list,
 * radio group, list box, grid, menu, tree) whose one stop is, which the arrow keys move along.
 */
export async function keyboardProbe(page: Page, dialog: string): Promise<KeyboardReport> {
  const focusInside = await page.evaluate(
    (sel) => document.querySelector(sel)?.contains(document.activeElement) ?? false,
    dialog,
  );
  const stops: string[] = [];
  const outside: string[] = [];
  // The element focused on opening is a stop; Tab walks on from it and Shift+Tab back from it.
  // Past the last stop Chromium's modal dialog lets the focus go to the browser (the page's
  // <body> headless) rather than wrap, so a walk ends there or where it began.
  const first = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-a11y-stop]'))
      el.removeAttribute('data-a11y-stop');
    for (const el of document.querySelectorAll('[data-a11y-first]'))
      el.removeAttribute('data-a11y-first');
    const a = document.activeElement;
    if (!a || a === document.body) return undefined;
    a.setAttribute('data-a11y-stop', '');
    a.setAttribute('data-a11y-first', '');
    return `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''} ${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 40)}`;
  });
  if (first) stops.push(first);
  if (first && !focusInside) outside.push(first);
  for (const key of ['Tab', 'Shift+Tab']) {
    if (key === 'Shift+Tab')
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-a11y-first]')?.focus());
    let bodies = 0;
    for (let i = 0; i < 400 && bodies < 2; i++) {
      await page.keyboard.press(key);
      const s = await page.evaluate((sel) => {
        const a = document.activeElement;
        if (!a || a === document.body) return { kind: 'body' as const, text: 'body' };
        const d = document.querySelector(sel);
        const text = `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''} ${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 40)}`;
        if (a.hasAttribute('data-a11y-stop')) return { kind: 'again' as const, text };
        a.setAttribute('data-a11y-stop', '');
        return { kind: d?.contains(a) ? ('inside' as const) : ('outside' as const), text };
      }, dialog);
      if (s.kind === 'again') break;
      if (s.kind === 'body') {
        bodies++;
        continue;
      }
      stops.push(s.text);
      if (s.kind === 'outside') outside.push(s.text);
    }
  }
  const { unreached, pointerOnly } = await page.evaluate((sel) => {
    const d = document.querySelector(sel)!;
    const shown = (el: Element) =>
      el.checkVisibility({ visibilityProperty: true }) && !el.closest('[aria-hidden="true"]');
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} ${(el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}`;
    const COMPOSITE =
      '[role="tablist"],[role="radiogroup"],[role="listbox"],[role="grid"],[role="treegrid"],[role="menu"],[role="menubar"],[role="tree"],[role="toolbar"],table[aria-multiselectable],[role="table"]';
    const CONTROL =
      'button,input:not([type="hidden"]),select,textarea,a[href],[tabindex],[role="button"],[role="checkbox"],[role="tab"],[role="option"],[role="radio"],[role="switch"],[role="slider"],[role="menuitem"],[role="treeitem"],[role="row"]';
    const unreached: string[] = [];
    const reachedRadioGroups = new Set<string>();
    for (const r of d.querySelectorAll('input[type="radio"][data-a11y-stop]'))
      reachedRadioGroups.add((r as HTMLInputElement).name);
    for (const el of d.querySelectorAll(CONTROL)) {
      if (!shown(el) || el.hasAttribute('data-a11y-stop')) continue;
      // Disabled, or in a disabled fieldset (whose controls' own `disabled` stays false).
      if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') continue;
      if (el instanceof HTMLInputElement && el.type === 'radio' && reachedRadioGroups.has(el.name))
        continue;
      const composite = el.closest(COMPOSITE);
      if (
        composite &&
        d.contains(composite) &&
        (composite.hasAttribute('data-a11y-stop') || composite.querySelector('[data-a11y-stop]'))
      )
        continue;
      // A non-focusable element with a role only (a row, a cell) is not a control on its own.
      if (
        el.getAttribute('tabindex') === null &&
        !el.matches('button,input,select,textarea,a[href]')
      )
        continue;
      unreached.push(label(el));
    }
    const pointerOnly: string[] = [];
    for (const el of d.querySelectorAll('*')) {
      if (!shown(el) || getComputedStyle(el).cursor !== 'pointer') continue;
      if (el.closest('[data-a11y-stop],label')) continue;
      if (el.querySelector('[data-a11y-stop]')) continue;
      if (el.matches(':disabled')) continue;
      const composite = el.closest(COMPOSITE);
      if (
        composite &&
        (composite.hasAttribute('data-a11y-stop') || composite.querySelector('[data-a11y-stop]'))
      )
        continue;
      if (
        el.parentElement &&
        getComputedStyle(el.parentElement).cursor === 'pointer' &&
        d.contains(el.parentElement) &&
        el.parentElement !== d
      )
        continue;
      pointerOnly.push(label(el));
    }
    return { unreached, pointerOnly };
  }, dialog);
  return { focusInside, stops, outside, unreached, pointerOnly };
}
