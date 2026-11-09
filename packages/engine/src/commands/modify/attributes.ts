// Attribute editing (M2-12), with AutoCAD 2024's prompts and dialogs ("EATTEDIT (Command)",
// "ATTEDIT (Command)", "-ATTEDIT (Command)", "Enhanced Attribute Editor", "Edit Attributes Dialog
// Box", AutoCAD 2024 Help):
//
// - EATTEDIT: "Select a block:", then the Enhanced Attribute Editor on the reference's
//   attributes: each one's value (Attribute tab), text options (style, height, rotation, width
//   factor, obliquing, backwards, upside down) and properties (layer, linetype, colour,
//   lineweight). Apply keeps the dialog open, Select block picks another reference, OK closes.
//   A multiline attribute's value opens the in-place MTEXT editor from its `...` button.
// - ATTEDIT: "Select block reference:", then the Edit Attributes dialog: values only.
// - -ATTEDIT: the command-line version: one at a time (Value/Position/Height/Angle/Style/Layer/
//   Color/Next on each attribute) or globally (a string replaced in every value), filtered by
//   block name, tag and value patterns with AutoCAD's wildcards.
//
// Commands edit only through `ctx.edit`; a dialog is a prompt (`DialogPrompt`) the front-end
// answers with what changed (`AttributePatch`es), so tests answer it as the app does.
import type { Vec2 } from '../../geom/types';
import { dynamicBlockOf } from '../../model/dynamic-block';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type {
  Color,
  Entity,
  InsertAttribute,
  InsertGeometry,
  MTextGeometry,
} from '../../model/types';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { AttributeEntry, AttributePatch, NamedRecord, Prompt, PromptAnswer } from '../prompt';
import { mtextEditorRequest } from '../draw/text';

/** DXF 70 bit 1: invisible; bit 2: constant (a constant attribute is never an ATTRIB to edit). */
const INVISIBLE = 1;
const CONSTANT = 2;

/** An INSERT with an attribute the drafter can edit: what EATTEDIT and ATTEDIT take. */
export function hasEditableAttributes(e: Entity | undefined): boolean {
  return e?.geom.kind === 'INSERT' && e.geom.attributes.some((a) => (a.flags & CONSTANT) === 0);
}

/** The block's name as AutoCAD shows it: a dynamic block's own, not its `*U` state's. */
export function blockNameOf(model: DocumentModel, block: Handle): string {
  return (
    dynamicBlockOf(model.blocks, block)?.name ??
    model.blocks.get(block)?.name ??
    model.tables.blockRecords.get(block)?.name ??
    block
  );
}

/** The prompts of the block's ATTDEFs by tag (upper case); a dynamic block's from its definition. */
function promptsOf(model: DocumentModel, block: Handle): Map<string, string> {
  const out = new Map<string, string>();
  const definition = dynamicBlockOf(model.blocks, block)?.handle;
  for (const h of definition !== undefined && definition !== block
    ? [block, definition]
    : [block]) {
    if (!model.hasBlock(h)) continue;
    for (const id of model.blockEntities(h)) {
      const g = model.entity(id)?.geom;
      if (g?.kind === 'ATTDEF' && !out.has(g.tag.toUpperCase()))
        out.set(g.tag.toUpperCase(), g.prompt);
    }
  }
  return out;
}

/** An INSERT's editable attributes as the dialogs show them, in the reference's order. */
export function attributeEntries(model: DocumentModel, g: InsertGeometry): AttributeEntry[] {
  const prompts = promptsOf(model, g.block);
  return g.attributes
    .filter((a) => (a.flags & CONSTANT) === 0)
    .map((a) => ({
      handle: a.handle,
      tag: a.tag,
      prompt: prompts.get(a.tag.toUpperCase()) || a.tag,
      value: a.mtext ? a.mtext.contents : a.value,
      multiline: a.mtext !== undefined,
      flags: a.flags,
      style: a.style,
      halign: a.halign,
      valign: a.valign,
      height: a.height,
      rotation: a.rotation,
      widthFactor: a.widthFactor,
      oblique: a.oblique,
      backward: a.backward,
      upsideDown: a.upsideDown,
      layer: a.layer,
      color: a.color,
      linetype: a.linetype,
      lineweight: a.lineweight,
    }));
}

const sameColor = (a: Color, b: Color) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One attribute with a dialog's changes. A multiline attribute keeps its text in its embedded
 * MTEXT: the value is the MTEXT's contents (DXF 1 of the ATTRIB stays as read), and the style,
 * height and rotation change on both, so the two never disagree.
 */
export function patchAttribute(a: InsertAttribute, p: AttributePatch): InsertAttribute {
  let next: InsertAttribute = { ...a };
  let mtext: MTextGeometry | undefined = a.mtext;
  const set = <K extends keyof InsertAttribute>(k: K, v: InsertAttribute[K] | undefined) => {
    if (v !== undefined && v !== a[k]) next = { ...next, [k]: v };
  };
  if (p.value !== undefined) {
    if (mtext) {
      if (p.value !== mtext.contents) mtext = { ...mtext, contents: p.value };
    } else set('value', p.value);
  }
  set('style', p.style);
  set('height', p.height);
  set('rotation', p.rotation);
  set('widthFactor', p.widthFactor);
  set('oblique', p.oblique);
  set('backward', p.backward);
  set('upsideDown', p.upsideDown);
  set('layer', p.layer);
  set('linetype', p.linetype);
  set('lineweight', p.lineweight);
  if (p.color !== undefined && !sameColor(p.color, a.color)) next = { ...next, color: p.color };
  if (mtext) {
    const m: Partial<MTextGeometry> = {};
    if (p.style !== undefined && p.style !== mtext.style) Object.assign(m, { style: p.style });
    if (p.height !== undefined && p.height !== mtext.height) Object.assign(m, { height: p.height });
    if (p.rotation !== undefined && p.rotation !== mtext.rotation) {
      Object.assign(m, { rotation: p.rotation });
    }
    if (Object.keys(m).length > 0) mtext = { ...mtext, ...m };
    if (mtext !== a.mtext) next = { ...next, mtext };
  }
  return next;
}

/** An attribute moved by `d` (-ATTEDIT Position): both alignment points and its MTEXT. */
function moved(a: InsertAttribute, d: Vec2): InsertAttribute {
  const by = (p: Vec2) => ({ x: p.x + d.x, y: p.y + d.y });
  return {
    ...a,
    position: by(a.position),
    ...(a.alignmentPoint && { alignmentPoint: by(a.alignmentPoint) }),
    ...(a.mtext && { mtext: { ...a.mtext, position: by(a.mtext.position) } }),
  };
}

/**
 * Applies a dialog's changes to the reference's attributes as one edit. Returns whether
 * anything changed (a dialog closed without changes edits nothing).
 */
function applyPatches(
  ctx: CommandContext,
  id: EntityId,
  patches: readonly AttributePatch[],
): boolean {
  const e = ctx.model.entity(id);
  if (e?.geom.kind !== 'INSERT' || patches.length === 0) return false;
  const byHandle = new Map(patches.map((p) => [p.handle, p]));
  let changed = false;
  const attributes = e.geom.attributes.map((a) => {
    const p = byHandle.get(a.handle);
    const next = p ? patchAttribute(a, p) : a;
    if (next !== a && JSON.stringify(next) !== JSON.stringify(a)) {
      changed = true;
      return next;
    }
    return a;
  });
  if (!changed) return false;
  const g = e.geom;
  ctx.edit((b) => b.updateEntity(id, { geom: { ...g, attributes } }));
  return true;
}

/** Replaces one attribute of the reference (the -ATTEDIT options and the MTEXT editor). */
function replaceAttribute(ctx: CommandContext, id: EntityId, next: InsertAttribute): void {
  const e = ctx.model.entity(id);
  if (e?.geom.kind !== 'INSERT') return;
  const g = e.geom;
  const attributes = g.attributes.map((a) => (a.handle === next.handle ? next : a));
  ctx.edit((b) => b.updateEntity(id, { geom: { ...g, attributes } }));
}

const records = (rs: Iterable<{ readonly handle: Handle; readonly name: string }>): NamedRecord[] =>
  [...rs].map((r) => ({ handle: r.handle, name: r.name }));

/**
 * The in-place MTEXT editor on a multiline attribute (the `...` button by its value): the
 * editor opens holding its contents where the attribute is, and what comes back is its value.
 * Returns false when the command was ended.
 */
async function* editMultiline(
  ctx: CommandContext,
  id: EntityId,
  handle: Handle,
): AsyncGenerator<Prompt, boolean, PromptAnswer> {
  const e = ctx.model.entity(id);
  const a =
    e?.geom.kind === 'INSERT' ? e.geom.attributes.find((x) => x.handle === handle) : undefined;
  if (!a?.mtext) return true;
  const answer = yield ctx.prompt.string({
    message: 'Enter attribute value',
    spaces: true,
    editor: mtextEditorRequest(ctx.model, a.mtext),
  });
  if (answer.kind === 'enter') return true;
  if (answer.kind !== 'string') return false;
  applyPatches(ctx, id, [{ handle, value: answer.value }]);
  return true;
}

/**
 * Picks the reference whose attributes a dialog edits. Returns its id, or undefined when the
 * drafter ended the command.
 */
async function* pickReference(
  ctx: CommandContext,
  message: string,
  pickfirst: boolean,
): AsyncGenerator<Prompt, EntityId | undefined, PromptAnswer> {
  for (;;) {
    const a = yield ctx.prompt.selection({ message, editable: true, single: true, pickfirst });
    if (a.kind !== 'selection' || a.ids.length === 0) return undefined;
    const e = a.ids.map((id) => ctx.model.entity(id)).find((x) => x?.geom.kind === 'INSERT');
    if (!e) {
      ctx.message('That object is not a block.');
      continue;
    }
    if (!hasEditableAttributes(e)) {
      ctx.message('That block has no editable attributes.');
      continue;
    }
    return e.id;
  }
}

/**
 * EATTEDIT for one document. A double click on a reference with attributes runs it with the
 * reference as the pre-selection (`DOUBLE_CLICK`). Esc in the dialog (its Cancel) ends the
 * command; changes made with Apply stay, as in AutoCAD.
 */
export function eatteditCommand(): CommandDef {
  return {
    name: 'EATTEDIT',
    usesSelection: 'before',
    async *run(ctx): CommandGenerator {
      let pickfirst = true;
      for (;;) {
        const id = yield* pickReference(ctx, 'Select a block', pickfirst);
        pickfirst = false;
        if (id === undefined) return;
        let selected: Handle | undefined;
        for (;;) {
          const e = ctx.model.entity(id);
          if (e?.geom.kind !== 'INSERT') return;
          const d = yield ctx.prompt.dialog({
            message: 'Enhanced Attribute Editor',
            dialog: {
              type: 'eattedit',
              block: blockNameOf(ctx.model, e.geom.block),
              attributes: attributeEntries(ctx.model, e.geom),
              ...(selected !== undefined && { selected }),
              styles: records(ctx.model.tables.textStyles.values()),
              layers: records(ctx.model.tables.layers.values()),
              linetypes: records(ctx.model.tables.linetypes.values()),
            },
          });
          if (d.kind !== 'dialog') return;
          applyPatches(ctx, id, d.attributes ?? []);
          if (d.action === 'ok') return;
          if (d.action === 'select') break;
          selected = d.target ?? selected;
          if (d.action === 'mtext' && d.target !== undefined) {
            if (!(yield* editMultiline(ctx, id, d.target))) return;
          }
        }
      }
    },
  };
}

/**
 * ATTEDIT (ATE) for one document: the Edit Attributes dialog on one reference's values, and
 * -ATTEDIT (`-ATE`, ATTE) on the command line.
 */
export function atteditCommand(): CommandDef {
  return {
    name: 'ATTEDIT',
    dashVariant: true,
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      if (ctx.dash) return yield* dashAttedit(ctx);
      const id = yield* pickReference(ctx, 'Select block reference', false);
      if (id === undefined) return;
      const e = ctx.model.entity(id)!;
      const g = e.geom as InsertGeometry;
      const d = yield ctx.prompt.dialog({
        message: 'Edit Attributes',
        dialog: {
          type: 'attedit',
          block: blockNameOf(ctx.model, g.block),
          attributes: attributeEntries(ctx.model, g),
        },
      });
      if (d.kind !== 'dialog') return;
      // The Edit Attributes dialog edits values only.
      applyPatches(
        ctx,
        id,
        (d.attributes ?? []).map((p) => ({
          handle: p.handle,
          ...(p.value !== undefined && { value: p.value }),
        })),
      );
    },
  };
}

/**
 * AutoCAD's wildcard match (WCMATCH): `*` any run, `?` any one character, `#` a digit, `@` a
 * letter, `.` a character that is neither, `[...]` / `[~...]` a set or its complement, `~`
 * before a pattern its complement, `` ` `` takes the next character as itself, and commas
 * separate patterns any of which may match.
 */
export function wcmatch(text: string, patterns: string, ignoreCase = true): boolean {
  const alternatives: string[] = [];
  let cur = '';
  for (let i = 0; i < patterns.length; i++) {
    const c = patterns[i]!;
    if (c === '`' && i + 1 < patterns.length) {
      cur += c + patterns[++i]!;
    } else if (c === ',') {
      alternatives.push(cur);
      cur = '';
    } else cur += c;
  }
  alternatives.push(cur);
  return alternatives.some((p) => {
    const negate = p.startsWith('~') && p.length > 1;
    const body = negate ? p.slice(1) : p;
    let re = '';
    for (let i = 0; i < body.length; i++) {
      const c = body[i]!;
      if (c === '`' && i + 1 < body.length) re += escape(body[++i]!);
      else if (c === '*') re += '.*';
      else if (c === '?') re += '.';
      else if (c === '#') re += '[0-9]';
      else if (c === '@') re += '[A-Za-z]';
      else if (c === '.') re += '[^A-Za-z0-9]';
      else if (c === '[') {
        const end = body.indexOf(']', i + 2);
        if (end < 0) {
          re += escape(c);
          continue;
        }
        let set = body.slice(i + 1, end);
        const not = set.startsWith('~') && set.length > 1;
        if (not) set = set.slice(1);
        re += `[${not ? '^' : ''}${set.replace(/[\\\]^]/g, '\\$&')}]`;
        i = end;
      } else re += escape(c);
    }
    const hit = new RegExp(`^${re}$`, ignoreCase ? 'is' : 's').test(text);
    return negate ? !hit : hit;
  });
}

const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** An attribute -ATTEDIT may edit: on a reference in the list, matching the three patterns. */
interface Found {
  readonly id: EntityId;
  readonly handle: Handle;
}

interface Specs {
  readonly block: string;
  readonly tag: string;
  readonly value: string;
}

async function* askSpecs(
  ctx: CommandContext,
): AsyncGenerator<Prompt, Specs | undefined, PromptAnswer> {
  const ask = async function* (
    message: string,
  ): AsyncGenerator<Prompt, string | undefined, PromptAnswer> {
    const a = yield ctx.prompt.string({
      message,
      spaces: true,
      default: { kind: 'string', value: '*' },
    });
    return a.kind === 'string' ? a.value.trim() || '*' : undefined;
  };
  const block = yield* ask('Enter block name specification');
  if (block === undefined) return undefined;
  const tag = yield* ask('Enter attribute tag specification');
  if (tag === undefined) return undefined;
  const value = yield* ask('Enter attribute value specification');
  if (value === undefined) return undefined;
  return { block, tag, value };
}

/** The attributes of `refs` the specs name, in order; invisible ones only under ATTMODE 2. */
function matching(ctx: CommandContext, refs: readonly EntityId[], specs: Specs): Found[] {
  const all = ctx.model.header.get('$ATTMODE') === 2;
  const out: Found[] = [];
  for (const id of refs) {
    const e = ctx.model.entity(id);
    if (e?.geom.kind !== 'INSERT') continue;
    if (!wcmatch(blockNameOf(ctx.model, e.geom.block), specs.block)) continue;
    for (const a of e.geom.attributes) {
      if ((a.flags & CONSTANT) !== 0) continue;
      if (!all && (a.flags & INVISIBLE) !== 0) continue;
      if (!wcmatch(a.tag, specs.tag)) continue;
      // Values are matched as typed: case counts, as AutoCAD's value specification is literal.
      if (!wcmatch(a.mtext ? a.mtext.contents : a.value, specs.value, false)) continue;
      out.push({ id, handle: a.handle });
    }
  }
  return out;
}

const attributeOf = (ctx: CommandContext, f: Found): InsertAttribute | undefined => {
  const e = ctx.model.entity(f.id);
  return e?.geom.kind === 'INSERT'
    ? e.geom.attributes.find((a) => a.handle === f.handle)
    : undefined;
};

const valueOf = (a: InsertAttribute) => (a.mtext ? a.mtext.contents : a.value);

/**
 * `text` with the first occurrence of `from` replaced. AutoCAD's documentation does not say how
 * many occurrences "Enter string to change" replaces; the first is what drafters see it do.
 */
function changed(text: string, from: string, to: string): string | undefined {
  const at = text.indexOf(from);
  return from === '' || at < 0 ? undefined : text.slice(0, at) + to + text.slice(at + from.length);
}

async function* dashAttedit(ctx: CommandContext): CommandGenerator {
  const one = yield ctx.prompt.keyword({
    message: 'Edit attributes one at a time?',
    options: ['Yes', 'No'],
    default: { kind: 'keyword', keyword: 'Yes' },
  });
  if (one.kind !== 'keyword') return;
  if (one.keyword === 'No') return yield* globalEdit(ctx);
  const specs = yield* askSpecs(ctx);
  if (!specs) return;
  const sel = yield ctx.prompt.selection({ message: 'Select Attributes', editable: true });
  if (sel.kind !== 'selection') return;
  const found = matching(ctx, sel.ids, specs);
  ctx.message(`${found.length} attributes selected.`);
  for (const f of found) {
    for (;;) {
      const a = attributeOf(ctx, f);
      if (!a) break;
      const o = yield ctx.prompt.keyword({
        message: 'Enter an option',
        options: ['Value', 'Position', 'Height', 'Angle', 'Style', 'Layer', 'Color', 'Next'],
        default: { kind: 'keyword', keyword: 'Next' },
      });
      if (o.kind !== 'keyword') return;
      if (o.keyword === 'Next') break;
      const next = yield* option(ctx, a, o.keyword);
      if (next === undefined) return;
      if (next !== a) replaceAttribute(ctx, f.id, next);
    }
  }
}

/** One -ATTEDIT option on one attribute: the attribute as changed, or undefined to end. */
async function* option(
  ctx: CommandContext,
  a: InsertAttribute,
  keyword: string,
): AsyncGenerator<Prompt, InsertAttribute | undefined, PromptAnswer> {
  switch (keyword) {
    case 'Value': {
      const t = yield ctx.prompt.keyword({
        message: 'Enter type of value modification',
        options: ['Change', 'Replace'],
        default: { kind: 'keyword', keyword: 'Replace' },
      });
      if (t.kind !== 'keyword') return undefined;
      if (t.keyword === 'Replace') {
        const v = yield ctx.prompt.string({ message: 'Enter new attribute value', spaces: true });
        if (v.kind === 'enter') return patchAttribute(a, { handle: a.handle, value: '' });
        return v.kind === 'string'
          ? patchAttribute(a, { handle: a.handle, value: v.value })
          : undefined;
      }
      const from = yield ctx.prompt.string({ message: 'Enter string to change', spaces: true });
      if (from.kind !== 'string' && from.kind !== 'enter') return undefined;
      const to = yield ctx.prompt.string({ message: 'Enter new string', spaces: true });
      if (to.kind !== 'string' && to.kind !== 'enter') return undefined;
      const value = changed(
        valueOf(a),
        from.kind === 'string' ? from.value : '',
        to.kind === 'string' ? to.value : '',
      );
      if (value === undefined) {
        ctx.message('String not found.');
        return a;
      }
      return patchAttribute(a, { handle: a.handle, value });
    }
    case 'Position': {
      const p = yield ctx.prompt.point({
        message: 'Specify new text insertion point',
        defaultLabel: 'no change',
      });
      if (p.kind === 'enter') return a;
      if (p.kind !== 'point') return undefined;
      const at = a.halign === 0 && a.valign === 0 ? a.position : (a.alignmentPoint ?? a.position);
      return moved(a, { x: p.point.x - at.x, y: p.point.y - at.y });
    }
    case 'Height': {
      const h = yield ctx.prompt.distance({
        message: 'Specify new height',
        base: a.position,
        default: { kind: 'distance', value: a.height },
      });
      if (h.kind !== 'distance') return h.kind === 'enter' ? a : undefined;
      if (!(h.value > 0)) {
        ctx.message('Value must be positive and nonzero.');
        return a;
      }
      return patchAttribute(a, { handle: a.handle, height: h.value });
    }
    case 'Angle': {
      const r = yield ctx.prompt.angle({
        message: 'Specify new rotation angle',
        base: a.position,
        default: { kind: 'angle', value: a.rotation },
      });
      if (r.kind !== 'angle') return r.kind === 'enter' ? a : undefined;
      return patchAttribute(a, { handle: a.handle, rotation: r.value });
    }
    case 'Style': {
      const current = ctx.model.tables.textStyles.get(a.style)?.name ?? '';
      const s = yield ctx.prompt.string({
        message: 'Enter text style name',
        spaces: true,
        default: { kind: 'string', value: current },
      });
      if (s.kind !== 'string') return s.kind === 'enter' ? a : undefined;
      const style = [...ctx.model.tables.textStyles.values()].find(
        (x) => x.name.toUpperCase() === s.value.trim().toUpperCase(),
      );
      if (!style) {
        ctx.message(`Cannot find text style "${s.value.trim()}".`);
        return a;
      }
      return patchAttribute(a, { handle: a.handle, style: style.handle });
    }
    case 'Layer': {
      const current = ctx.model.tables.layers.get(a.layer)?.name ?? '';
      const s = yield ctx.prompt.string({
        message: 'Enter new layer name',
        spaces: true,
        default: { kind: 'string', value: current },
      });
      if (s.kind !== 'string') return s.kind === 'enter' ? a : undefined;
      const layer = [...ctx.model.tables.layers.values()].find(
        (x) => x.name.toUpperCase() === s.value.trim().toUpperCase(),
      );
      if (!layer) {
        ctx.message(`Cannot find layer "${s.value.trim()}".`);
        return a;
      }
      return patchAttribute(a, { handle: a.handle, layer: layer.handle });
    }
    case 'Color': {
      const c = yield ctx.prompt.string({
        message: 'Enter new color',
        options: ['Truecolor'],
        default: { kind: 'string', value: colorText(a.color) },
      });
      if (c.kind === 'keyword') {
        const rgb = yield ctx.prompt.string({ message: 'Red, Green, Blue' });
        if (rgb.kind !== 'string') return rgb.kind === 'enter' ? a : undefined;
        const color = parseTrueColor(rgb.value);
        if (!color) {
          ctx.message('Invalid color.');
          return a;
        }
        return patchAttribute(a, { handle: a.handle, color });
      }
      if (c.kind !== 'string') return c.kind === 'enter' ? a : undefined;
      const color = parseColor(c.value);
      if (!color) {
        ctx.message('Invalid color.');
        return a;
      }
      return patchAttribute(a, { handle: a.handle, color });
    }
    default:
      return a;
  }
}

/** AutoCAD's names for ACI 1–7, as the Color option takes and shows them. */
const COLOR_NAMES = ['RED', 'YELLOW', 'GREEN', 'CYAN', 'BLUE', 'MAGENTA', 'WHITE'];

export function colorText(c: Color): string {
  switch (c.kind) {
    case 'byLayer':
      return 'BYLAYER';
    case 'byBlock':
      return 'BYBLOCK';
    case 'aci':
      return c.index >= 1 && c.index <= 7 ? COLOR_NAMES[c.index - 1]! : String(c.index);
    case 'rgb':
      return `${c.r},${c.g},${c.b}`;
  }
}

/** A colour typed at the Color option: BYLAYER, BYBLOCK, a colour name or an ACI number 1–255. */
export function parseColor(text: string): Color | undefined {
  const t = text.trim().toUpperCase();
  if (t === 'BYLAYER') return { kind: 'byLayer' };
  if (t === 'BYBLOCK') return { kind: 'byBlock' };
  const named = COLOR_NAMES.indexOf(t);
  if (named >= 0) return { kind: 'aci', index: named + 1 };
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n === 0) return { kind: 'byBlock' };
    if (n === 256) return { kind: 'byLayer' };
    if (n >= 1 && n <= 255) return { kind: 'aci', index: n };
  }
  return undefined;
}

function parseTrueColor(text: string): Color | undefined {
  const parts = text.split(',').map((s) => s.trim());
  if (parts.length !== 3 || !parts.every((s) => /^\d+$/.test(s))) return undefined;
  const [r, g, b] = parts.map(Number) as [number, number, number];
  return [r, g, b].every((v) => v <= 255) ? { kind: 'rgb', r, g, b } : undefined;
}

/**
 * -ATTEDIT's global editing: a string replaced in the value of every attribute the specs name,
 * on the references selected (visible on screen) or on every reference of the drawing.
 */
async function* globalEdit(ctx: CommandContext): CommandGenerator {
  ctx.message('Performing global editing of attribute values.');
  const vis = yield ctx.prompt.keyword({
    message: 'Edit only attributes visible on screen?',
    options: ['Yes', 'No'],
    default: { kind: 'keyword', keyword: 'Yes' },
  });
  if (vis.kind !== 'keyword') return;
  const specs = yield* askSpecs(ctx);
  if (!specs) return;
  let refs: EntityId[];
  if (vis.keyword === 'Yes') {
    const sel = yield ctx.prompt.selection({ message: 'Select Attributes', editable: true });
    if (sel.kind !== 'selection') return;
    refs = [...sel.ids];
  } else {
    ctx.message('Drawing must be regenerated afterwards.');
    refs = [...ctx.model.entities()]
      .filter((e) => e.geom.kind === 'INSERT' && !ctx.model.tables.layers.get(e.layer)?.locked)
      .map((e) => e.id);
  }
  const found = matching(ctx, refs, specs);
  ctx.message(`${found.length} attributes selected.`);
  if (found.length === 0) return;
  const from = yield ctx.prompt.string({ message: 'Enter string to change', spaces: true });
  if (from.kind !== 'string') return;
  const to = yield ctx.prompt.string({ message: 'Enter new string', spaces: true });
  if (to.kind !== 'string' && to.kind !== 'enter') return;
  const byRef = new Map<EntityId, AttributePatch[]>();
  for (const f of found) {
    const a = attributeOf(ctx, f);
    const value = a && changed(valueOf(a), from.value, to.kind === 'string' ? to.value : '');
    if (value === undefined) continue;
    byRef.set(f.id, [...(byRef.get(f.id) ?? []), { handle: f.handle, value }]);
  }
  for (const [id, patches] of byRef) applyPatches(ctx, id, patches);
}

export const ATTRIBUTE_COMMANDS = [eatteditCommand, atteditCommand] as const;
