// Attribute editing (M2-12), with AutoCAD 2024's prompts and dialogs ("EATTEDIT (Command)",
// "ATTEDIT (Command)", "-ATTEDIT (Command)", "Enhanced Attribute Editor", "Edit Attributes Dialog
// Box", AutoCAD 2024 Help):
//
// - EATTEDIT: "Select a block:", then the Enhanced Attribute Editor on the reference's
//   attributes: each one's value (Attribute tab), text options (style, height, rotation, width
//   factor, obliquing, backwards, upside down) and properties (layer, linetype, colour,
//   lineweight). Apply keeps the dialog open, Select block picks another reference, OK closes.
//   A multiline attribute's value opens the in-place MTEXT editor from its `...` button.
//   M2-27: the Justification (the insertion point stays where it is and the text moves about
//   it, as AutoCAD's Properties palette changes a text's justification; JUSTIFYTEXT is the one
//   that keeps the text still), the Plot style of a named-plot-style drawing, and Annotative,
//   shown only (DEC-013). A block picked by one of its attributes, or double-clicked on one,
//   opens with that attribute selected in the list.
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
  TextFields,
  TextGeometry,
} from '../../model/types';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { TextOutline } from '../view/host';
import type {
  AttributeEntry,
  AttributePatch,
  NamedRecord,
  Prompt,
  PromptAnswer,
  SelectionWindow,
} from '../prompt';
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
  return dynamicBlockOf(model.blocks, block)?.name ?? model.blocks.get(block)?.name ?? block;
}

/** The prompts of the block's ATTDEFs by tag (upper case); a dynamic block's from its definition. */
function promptsOf(model: DocumentModel, block: Handle): Map<string, string> {
  const out = new Map<string, string>();
  const blocks = [block];
  const definition = dynamicBlockOf(model.blocks, block)?.handle;
  if (definition !== undefined && definition !== block) blocks.push(definition);
  for (const h of blocks) {
    for (const id of model.blockEntities(h)) {
      const g = model.entity(id)!.geom;
      if (g.kind === 'ATTDEF' && !out.has(g.tag.toUpperCase())) {
        out.set(g.tag.toUpperCase(), g.prompt);
      }
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
      ...(a.mtext && { attachment: a.mtext.attachment }),
      layer: a.layer,
      color: a.color,
      linetype: a.linetype,
      lineweight: a.lineweight,
      plotStyle: a.plotStyle ?? null,
      annotative: a.annotative !== undefined,
    }));
}

/**
 * The justifications EATTEDIT offers a single-line attribute, as AutoCAD's Justification list
 * names them, with their DXF 72/73.
 */
export const JUSTIFICATIONS: readonly {
  readonly name: string;
  readonly halign: number;
  readonly valign: number;
}[] = [
  { name: 'Left', halign: 0, valign: 0 },
  { name: 'Center', halign: 1, valign: 0 },
  { name: 'Right', halign: 2, valign: 0 },
  { name: 'Aligned', halign: 3, valign: 0 },
  { name: 'Middle', halign: 4, valign: 0 },
  { name: 'Fit', halign: 5, valign: 0 },
  { name: 'Top left', halign: 0, valign: 3 },
  { name: 'Top center', halign: 1, valign: 3 },
  { name: 'Top right', halign: 2, valign: 3 },
  { name: 'Middle left', halign: 0, valign: 2 },
  { name: 'Middle center', halign: 1, valign: 2 },
  { name: 'Middle right', halign: 2, valign: 2 },
  { name: 'Bottom left', halign: 0, valign: 1 },
  { name: 'Bottom center', halign: 1, valign: 1 },
  { name: 'Bottom right', halign: 2, valign: 1 },
];

/** Aligned (3) and Fit (5) run between DXF 10 and DXF 11. */
const twoPoint = (halign: number) => halign === 3 || halign === 5;

/** The point a text is placed by: DXF 10 for left-baseline, Aligned and Fit, DXF 11 otherwise. */
export function insertionPoint(t: TextFields): Vec2 {
  if (twoPoint(t.halign) || (t.halign === 0 && t.valign === 0) || !t.alignmentPoint) {
    return t.position;
  }
  return t.alignmentPoint;
}

/** A point given in the text's own axes (x along the baseline), mirrors applied, from `at`. */
function along(t: TextFields, at: Vec2, x: number, y: number): Vec2 {
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const mx = t.backward ? -x : x;
  const my = t.upsideDown ? -y : y;
  return { x: at.x + mx * cos - my * sin, y: at.y + mx * sin + my * cos };
}

/**
 * A single-line text's alignment points under another justification (M2-27), its insertion
 * point kept, as AutoCAD's Properties palette changes Justify: DXF 11 becomes the insertion
 * point and DXF 10, which AutoCAD derives, the baseline start the renderer then draws from
 * (`outline`, the text as drawn now: its advance and descent). Aligned and Fit run from the
 * insertion point for the text's advance. Without an outline (no font drawing it) DXF 10 stays
 * at the insertion point, and Aligned or Fit cannot be given (undefined).
 */
export function rejustified(
  t: TextFields,
  halign: number,
  valign: number,
  outline?: TextOutline,
): Pick<TextFields, 'position' | 'alignmentPoint' | 'halign' | 'valign'> | undefined {
  const at = insertionPoint(t);
  if (twoPoint(halign)) {
    // Between two points, or from the old start for as long as the text now runs.
    if (twoPoint(t.halign) && t.alignmentPoint) {
      return { position: t.position, alignmentPoint: t.alignmentPoint, halign, valign: 0 };
    }
    if (!outline) return undefined;
    return { position: at, alignmentPoint: along(t, at, outline.width, 0), halign, valign: 0 };
  }
  if (halign === 0 && valign === 0) {
    return { position: at, ...(t.alignmentPoint && { alignmentPoint: at }), halign, valign };
  }
  if (!outline) return { position: at, alignmentPoint: at, halign, valign };
  // The renderer's offsets of the baseline start from the alignment point (text.ts, drawText).
  const { width, below } = outline;
  const h = t.height;
  const dx = halign === 1 || halign === 4 ? -width / 2 : halign === 2 ? -width : 0;
  const dy =
    halign === 4
      ? -(h - below) / 2
      : valign === 1
        ? below
        : valign === 2
          ? -h / 2
          : valign === 3
            ? -h
            : 0;
  return { position: along(t, at, dx, dy), alignmentPoint: at, halign, valign };
}

/** What an attribute draws: its value as a TEXT, or a multiline attribute's MTEXT. */
const drawnText = (a: InsertAttribute): TextGeometry | MTextGeometry =>
  a.mtext ?? { ...a, kind: 'TEXT' };

/** ATTMODE (ATTDISP): which attributes a reference shows, as the renderer draws them. */
function shown(ctx: CommandContext, a: InsertAttribute): boolean {
  const mode = ctx.model.header.get('$ATTMODE');
  if (mode === 0) return false;
  return mode === 2 || (a.flags & INVISIBLE) === 0;
}

/** How far `p` lies outside the polygon `corners` (0 inside). */
function outside(p: Vec2, corners: readonly Vec2[]): number {
  let inside = false;
  let d = Infinity;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i]!;
    const b = corners[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = ex * ex + ey * ey;
    const k = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len)) : 0;
    d = Math.min(d, Math.hypot(p.x - (a.x + k * ex), p.y - (a.y + k * ey)));
  }
  return inside ? 0 : d;
}

/**
 * The editable attribute of the reference `id` whose text, as drawn, is within the pickbox of
 * `point` (M2-27: EATTEDIT selects the attribute a block was picked or double-clicked by), the
 * nearest when several are; undefined when none is, or nothing on the canvas draws them.
 */
export async function attributeAt(
  ctx: CommandContext,
  id: EntityId,
  point: Vec2,
): Promise<Handle | undefined> {
  const drawn = await drawnAttributes(ctx, id);
  return drawn && pickedOf(drawn, point);
}

/** The editable attributes of a reference as the canvas draws them (`textOutlines`). */
interface DrawnAttributes {
  readonly attributes: readonly InsertAttribute[];
  /** One per attribute; null where no loaded font draws it. */
  readonly outlines: readonly (TextOutline | null)[];
  /** The pickbox's half size in world units. */
  readonly pickbox: number;
}

/** Undefined when the reference shows no editable attribute, or nothing on the canvas draws it. */
async function drawnAttributes(
  ctx: CommandContext,
  id: EntityId,
): Promise<DrawnAttributes | undefined> {
  const g = ctx.model.entity(id)?.geom;
  if (g?.kind !== 'INSERT') return undefined;
  const attributes = g.attributes.filter((a) => (a.flags & CONSTANT) === 0 && shown(ctx, a));
  if (attributes.length === 0) return undefined;
  const r = await ctx.view.request({ op: 'textOutlines', texts: attributes.map(drawnText) });
  if (!r.ok || !r.outlines || r.outlines.every((o) => !o)) return undefined;
  return { attributes, outlines: r.outlines, pickbox: r.pickbox ?? 0 };
}

/** The attribute whose drawn text is nearest `point`, within the pickbox. */
function pickedOf(d: DrawnAttributes, point: Vec2): Handle | undefined {
  let best: { handle: Handle; d: number } | undefined;
  d.attributes.forEach((a, i) => {
    const o = d.outlines[i];
    if (!o) return;
    const away = outside(point, o.corners);
    if (away <= d.pickbox && (!best || away < best.d)) best = { handle: a.handle, d: away };
  });
  return best?.handle;
}

/**
 * The attributes a window takes, as AutoCAD's object selection takes objects: drawn wholly
 * inside it, or, a crossing window, inside or crossing it. An attribute no font draws counts
 * by its insertion point.
 */
function windowedOf(d: DrawnAttributes, w: SelectionWindow, crossing: boolean): Handle[] {
  const lo = { x: Math.min(w.a.x, w.b.x), y: Math.min(w.a.y, w.b.y) };
  const hi = { x: Math.max(w.a.x, w.b.x), y: Math.max(w.a.y, w.b.y) };
  const inRect = (p: Vec2) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
  return d.attributes
    .filter((a, i) => {
      const corners = d.outlines[i]?.corners ?? [a.mtext?.position ?? insertionPoint(a)];
      if (corners.every(inRect)) return true;
      return crossing && crossesRect(corners, lo, hi);
    })
    .map((a) => a.handle);
}

/** Whether the polygon `corners` and the rectangle `lo`–`hi` overlap at all. */
function crossesRect(corners: readonly Vec2[], lo: Vec2, hi: Vec2): boolean {
  const rect = [lo, { x: hi.x, y: lo.y }, hi, { x: lo.x, y: hi.y }];
  const inRect = (p: Vec2) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
  if (corners.some(inRect)) return true;
  if (corners.length >= 3 && rect.some((p) => outside(p, corners) === 0)) return true;
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const meets = (p: Vec2, q: Vec2, r: Vec2, s: Vec2) =>
    cross(p, q, r) * cross(p, q, s) <= 0 && cross(r, s, p) * cross(r, s, q) <= 0;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i]!;
    const q = corners[(i + 1) % corners.length]!;
    for (let j = 0; j < 4; j++) if (meets(p, q, rect[j]!, rect[(j + 1) % 4]!)) return true;
  }
  return false;
}

/** What a patch may change on the ATTRIB itself, and on a multiline one's MTEXT too. */
const PATCHED = [
  'value',
  'style',
  'height',
  'rotation',
  'widthFactor',
  'oblique',
  'backward',
  'upsideDown',
  'layer',
  'color',
  'linetype',
  'lineweight',
] as const;
const MTEXT_PATCHED = ['style', 'height', 'rotation'] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The patch gives a single-line attribute another justification. An annotative one's stays:
 * each annotation scale keeps its own placement (DEC-013 leaves those as read).
 */
const rejustifies = (a: InsertAttribute, p: AttributePatch): boolean =>
  !a.mtext &&
  !a.annotative &&
  ((p.halign !== undefined && p.halign !== a.halign) ||
    (p.valign !== undefined && p.valign !== a.valign));

/**
 * One attribute with a dialog's changes; the same object when nothing changes. A multiline
 * attribute keeps its text in its embedded MTEXT: the value is the MTEXT's contents (DXF 1 of
 * the ATTRIB stays as read), and the style, height and rotation change on both, so the two
 * never disagree; its justification is the MTEXT's attachment, about its insertion point. A
 * single-line attribute's new justification keeps its insertion point (`rejustified`, with
 * `outline`, the text as drawn before the patch); one Aligned or Fit cannot take without an
 * outline is left as it was. A null plot style is ByLayer.
 */
export function patchAttribute(
  a: InsertAttribute,
  p: AttributePatch,
  outline?: TextOutline,
): InsertAttribute {
  const changes: Record<string, unknown> = {};
  for (const k of PATCHED) {
    if (p[k] !== undefined && !same(p[k], a[k])) changes[k] = p[k];
  }
  if (rejustifies(a, p)) {
    const j = rejustified(a, p.halign ?? a.halign, p.valign ?? a.valign, outline);
    if (j) Object.assign(changes, j);
  }
  let base: InsertAttribute = a;
  if (p.plotStyle !== undefined && p.plotStyle !== (a.plotStyle ?? null)) {
    if (p.plotStyle === null) {
      const { plotStyle: _byLayer, ...rest } = a;
      base = rest;
    } else changes['plotStyle'] = p.plotStyle;
  }
  if (a.mtext) {
    delete changes['value'];
    const m: Record<string, unknown> = {};
    if (p.value !== undefined && p.value !== a.mtext.contents) m['contents'] = p.value;
    for (const k of MTEXT_PATCHED) if (k in changes) m[k] = changes[k];
    if (p.attachment !== undefined && p.attachment !== a.mtext.attachment) {
      m['attachment'] = p.attachment;
    }
    if (Object.keys(m).length > 0) changes['mtext'] = { ...a.mtext, ...m };
  }
  return Object.keys(changes).length > 0 || base !== a ? { ...base, ...changes } : a;
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
 * Applies a dialog's changes to the reference's attributes as one edit (a dialog closed
 * without changes edits nothing). A new justification asks the canvas where the text lies now.
 */
async function applyPatches(
  ctx: CommandContext,
  id: EntityId,
  patches: readonly AttributePatch[],
): Promise<void> {
  const g = ctx.model.entity(id)!.geom as InsertGeometry;
  const byHandle = new Map(patches.map((p) => [p.handle, p]));
  const moving = g.attributes.filter((a) => {
    const p = byHandle.get(a.handle);
    return p !== undefined && rejustifies(a, p);
  });
  const outlines = new Map<Handle, TextOutline>();
  if (moving.length > 0) {
    const r = await ctx.view.request({ op: 'textOutlines', texts: moving.map(drawnText) });
    moving.forEach((a, i) => {
      const o = r.ok ? r.outlines?.[i] : undefined;
      if (o) outlines.set(a.handle, o);
    });
  }
  const attributes = g.attributes.map((a) => {
    const p = byHandle.get(a.handle);
    if (!p) return a;
    const next = patchAttribute(a, p, outlines.get(a.handle));
    if (rejustifies(a, p) && next.halign === a.halign && next.valign === a.valign) {
      ctx.message(`The ${a.tag} attribute cannot be measured: its justification is unchanged.`);
    }
    return next;
  });
  if (attributes.every((a, i) => a === g.attributes[i])) return;
  ctx.edit((b) => b.updateEntity(id, { geom: { ...g, attributes } }));
}

/** Replaces one attribute of the reference (the -ATTEDIT options and the MTEXT editor). */
function replaceAttribute(ctx: CommandContext, id: EntityId, next: InsertAttribute): void {
  const g = ctx.model.entity(id)!.geom as InsertGeometry;
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
  const g = ctx.model.entity(id)!.geom as InsertGeometry;
  const mtext = g.attributes.find((x) => x.handle === handle)?.mtext;
  if (!mtext) return true;
  const answer = yield ctx.prompt.string({
    message: 'Enter attribute value',
    spaces: true,
    editor: mtextEditorRequest(ctx.model, mtext),
  });
  if (answer.kind === 'string') await applyPatches(ctx, id, [{ handle, value: answer.value }]);
  return answer.kind === 'string' || answer.kind === 'enter';
}

/**
 * Picks the reference whose attributes a dialog edits. Returns its id and where it was picked
 * (or double-clicked), or undefined when the drafter ended the command.
 */
async function* pickReference(
  ctx: CommandContext,
  message: string,
  pickfirst: boolean,
): AsyncGenerator<Prompt, { id: EntityId; pick?: Vec2 } | undefined, PromptAnswer> {
  for (;;) {
    const a = yield ctx.prompt.selection({ message, editable: true, single: true, pickfirst });
    const { ids, pick } = a as Answer<'selection'>;
    if (ids.length === 0) return undefined;
    const e = ids.map((id) => ctx.model.entity(id)!).find((x) => x.geom.kind === 'INSERT');
    if (!e) {
      ctx.message('That object is not a block.');
      continue;
    }
    if (!hasEditableAttributes(e)) {
      ctx.message('That block has no editable attributes.');
      continue;
    }
    return { id: e.id, ...(pick && { pick }) };
  }
}

/** The named plot styles an attribute may take: none in a colour-dependent drawing. */
function plotStyleChoices(ctx: CommandContext): NamedRecord[] | undefined {
  const mode = ctx.model.header.get('$PSTYLEMODE');
  if (mode !== 0 && mode !== false) return undefined;
  return records(ctx.model.tables.plotStyles.values());
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
        const picked = yield* pickReference(ctx, 'Select a block', pickfirst);
        pickfirst = false;
        if (picked === undefined) return;
        const id = picked.id;
        // The attribute the block was picked by opens selected, as AutoCAD's list does.
        let selected = picked.pick && (await attributeAt(ctx, id, picked.pick));
        const plotStyles = plotStyleChoices(ctx);
        for (;;) {
          const g = ctx.model.entity(id)!.geom as InsertGeometry;
          const d = yield ctx.prompt.dialog({
            message: 'Enhanced Attribute Editor',
            dialog: {
              type: 'eattedit',
              block: blockNameOf(ctx.model, g.block),
              attributes: attributeEntries(ctx.model, g),
              ...(selected !== undefined && { selected }),
              styles: records(ctx.model.tables.textStyles.values()),
              layers: records(ctx.model.tables.layers.values()),
              linetypes: records(ctx.model.tables.linetypes.values()),
              ...(plotStyles && { plotStyles }),
            },
          });
          if (d.kind !== 'dialog') return;
          await applyPatches(ctx, id, d.attributes ?? []);
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
      const picked = yield* pickReference(ctx, 'Select block reference', false);
      if (picked === undefined) return;
      const id = picked.id;
      const g = ctx.model.entity(id)!.geom as InsertGeometry;
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
      await applyPatches(
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

async function* askSpecs(ctx: CommandContext): AsyncGenerator<Prompt, Specs, PromptAnswer> {
  const specs: string[] = [];
  for (const what of ['block name', 'attribute tag', 'attribute value']) {
    const a = yield ctx.prompt.string({
      message: `Enter ${what} specification`,
      spaces: true,
      default: { kind: 'string', value: '*' },
    });
    specs.push(textOf(a).trim() || '*');
  }
  const [block, tag, value] = specs as [string, string, string];
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

/**
 * The attributes "Select Attributes" took, in the specs (M2-27; "-ATTEDIT (Command)", AutoCAD
 * 2024 Help: "Select only attributes parallel to the current UCS"): the attribute a pick was
 * made on, and the attributes a window holds (or a crossing window crosses), not every attribute
 * of the references they belong to. A pick on a reference's other objects takes none of its
 * attributes, as AutoCAD's attribute selection finds none there. A reference taken whole (ALL,
 * Last, Previous, a Ctrl+A pre-selection), or one the canvas cannot measure (no font loaded),
 * gives all its attributes, as M2-12 did.
 */
async function selectedAttributes(
  ctx: CommandContext,
  sel: Answer<'selection'>,
  specs: Specs,
): Promise<Found[]> {
  const out: Found[] = [];
  for (const id of sel.ids) {
    const all = matching(ctx, [id], specs);
    if (all.length === 0) continue;
    const takes = (sel.takes ?? []).filter((t) => t.ids.includes(id));
    const whole = takes.length === 0 || takes.some((t) => !t.pick && !t.window);
    const drawn = whole ? undefined : await drawnAttributes(ctx, id);
    if (!drawn) {
      out.push(...all);
      continue;
    }
    const took = new Set<Handle>();
    for (const t of takes) {
      if (t.pick) {
        const h = pickedOf(drawn, t.pick);
        if (h !== undefined) took.add(h);
      } else if (t.window) {
        for (const h of windowedOf(drawn, t.window, t.crossing === true)) took.add(h);
      }
    }
    // In the order taken; the specs still filter what was picked.
    const wanted = new Set(all.map((f) => f.handle));
    for (const handle of took) if (wanted.has(handle)) out.push({ id, handle });
  }
  return out;
}

/**
 * The X AutoCAD marks the attribute being edited with, at its insertion point: twice the
 * pickbox across (as big on screen at any zoom), or half the text height without a canvas.
 */
async function markAttribute(ctx: CommandContext, a: InsertAttribute): Promise<void> {
  const r = await ctx.view.request({ op: 'textOutlines', texts: [drawnText(a)] });
  const size = r.ok && r.pickbox ? r.pickbox * 2 : a.height / 2;
  const at = a.mtext ? a.mtext.position : insertionPoint(a);
  ctx.preview([
    {
      kind: 'LINE',
      start: { x: at.x - size, y: at.y - size },
      end: { x: at.x + size, y: at.y + size },
    },
    {
      kind: 'LINE',
      start: { x: at.x - size, y: at.y + size },
      end: { x: at.x + size, y: at.y - size },
    },
  ]);
}

const attributeOf = (ctx: CommandContext, f: Found): InsertAttribute =>
  (ctx.model.entity(f.id)!.geom as InsertGeometry).attributes.find((a) => a.handle === f.handle)!;

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
  if (keywordOf(one) === 'No') return yield* globalEdit(ctx);
  const specs = yield* askSpecs(ctx);
  const sel = yield ctx.prompt.selection({ message: 'Select Attributes', editable: true });
  const found = await selectedAttributes(ctx, sel as Answer<'selection'>, specs);
  ctx.message(`${found.length} attributes selected.`);
  for (const f of found) {
    for (;;) {
      const a = attributeOf(ctx, f);
      await markAttribute(ctx, a);
      const o = yield ctx.prompt.keyword({
        message: 'Enter an option',
        options: ['Value', 'Position', 'Height', 'Angle', 'Style', 'Layer', 'Color', 'Next'],
        default: { kind: 'keyword', keyword: 'Next' },
      });
      if (keywordOf(o) === 'Next') break;
      const next = yield* option(ctx, a, keywordOf(o));
      if (next !== a) replaceAttribute(ctx, f.id, next);
    }
  }
}

// Answers a prompt can give. Esc never answers (the bus ends the command at the prompt), Enter
// at a prompt with a default answers the default, and the bus refuses answers of other kinds.
type Answer<K extends PromptAnswer['kind']> = Extract<PromptAnswer, { kind: K }>;
const keywordOf = (a: PromptAnswer) => (a as Answer<'keyword'>).keyword;
const textOf = (a: PromptAnswer) => (a.kind === 'string' ? a.value : '');

/** A table record named as typed, any case, or undefined (with AutoCAD's message). */
function named<R extends { readonly name: string }>(
  ctx: CommandContext,
  records: Iterable<R>,
  what: string,
  typed: string,
): R | undefined {
  const name = typed.trim();
  const found = [...records].find((r) => r.name.toUpperCase() === name.toUpperCase());
  if (!found) ctx.message(`Cannot find ${what} "${name}".`);
  return found;
}

/** One -ATTEDIT option on one attribute: the attribute as changed (the same when unchanged). */
async function* option(
  ctx: CommandContext,
  a: InsertAttribute,
  keyword: string,
): AsyncGenerator<Prompt, InsertAttribute, PromptAnswer> {
  const patched = (p: Omit<AttributePatch, 'handle'>) =>
    patchAttribute(a, { handle: a.handle, ...p });
  switch (keyword) {
    case 'Value': {
      const t = yield ctx.prompt.keyword({
        message: 'Enter type of value modification',
        options: ['Change', 'Replace'],
        default: { kind: 'keyword', keyword: 'Replace' },
      });
      if (keywordOf(t) === 'Replace') {
        const v = yield ctx.prompt.string({ message: 'Enter new attribute value', spaces: true });
        return patched({ value: textOf(v) });
      }
      const from = yield ctx.prompt.string({ message: 'Enter string to change', spaces: true });
      const to = yield ctx.prompt.string({ message: 'Enter new string', spaces: true });
      const value = changed(valueOf(a), textOf(from), textOf(to));
      if (value === undefined) ctx.message('String not found.');
      return value === undefined ? a : patched({ value });
    }
    case 'Position': {
      const p = yield ctx.prompt.point({
        message: 'Specify new text insertion point',
        defaultLabel: 'no change',
      });
      if (p.kind !== 'point') return a;
      const at = a.halign === 0 && a.valign === 0 ? a.position : (a.alignmentPoint ?? a.position);
      return moved(a, { x: p.point.x - at.x, y: p.point.y - at.y });
    }
    case 'Height': {
      const h = yield ctx.prompt.distance({
        message: 'Specify new height',
        base: a.position,
        default: { kind: 'distance', value: a.height },
      });
      const height = (h as Answer<'distance'>).value;
      if (height > 0) return patched({ height });
      ctx.message('Value must be positive and nonzero.');
      return a;
    }
    case 'Angle': {
      const r = yield ctx.prompt.angle({
        message: 'Specify new rotation angle',
        base: a.position,
        default: { kind: 'angle', value: a.rotation },
      });
      return patched({ rotation: (r as Answer<'angle'>).value });
    }
    case 'Style': {
      const s = yield ctx.prompt.string({
        message: 'Enter text style name',
        spaces: true,
        default: { kind: 'string', value: ctx.model.tables.textStyles.get(a.style)?.name ?? '' },
      });
      const style = named(ctx, ctx.model.tables.textStyles.values(), 'text style', textOf(s));
      return style ? patched({ style: style.handle }) : a;
    }
    case 'Layer': {
      const s = yield ctx.prompt.string({
        message: 'Enter new layer name',
        spaces: true,
        default: { kind: 'string', value: ctx.model.tables.layers.get(a.layer)?.name ?? '' },
      });
      const layer = named(ctx, ctx.model.tables.layers.values(), 'layer', textOf(s));
      return layer ? patched({ layer: layer.handle }) : a;
    }
    default: {
      // Color.
      const current = colorText(a.color);
      const c = yield ctx.prompt.string({
        message: 'Enter new color',
        options: ['Truecolor', 'COlorbook'],
        default: { kind: 'string', value: current },
      });
      if (c.kind === 'keyword' && c.keyword === 'COlorbook') {
        const color = yield* colorFromBook(ctx);
        return color ? patched({ color }) : a;
      }
      const typed = textOf(c);
      // Enter keeps the colour shown, a colour-book one too.
      if (c.kind === 'string' && typed === current) return a;
      const color =
        c.kind === 'keyword'
          ? parseTrueColor(textOf(yield ctx.prompt.string({ message: 'Red, Green, Blue' })))
          : (parseColor(typed) ?? bookColors(ctx.model).get(typed.trim().toUpperCase()));
      if (!color) ctx.message('Invalid color.');
      return color ? patched({ color }) : a;
    }
  }
}

/**
 * The COlorbook option ("-COLOR (Command)", AutoCAD 2024 Help): a colour book's name, then one
 * of its colours. Triya ships no colour books (AutoCAD's .acb files are Autodesk's, CLAUDE.md),
 * so the books are those the drawing already uses, with the colours of them it uses; the save
 * writes such a colour with the drawing's own DBCOLOR object (M2-27).
 */
async function* colorFromBook(
  ctx: CommandContext,
): AsyncGenerator<Prompt, Color | undefined, PromptAnswer> {
  const books = bookColors(ctx.model);
  const book = textOf(
    yield ctx.prompt.string({ message: 'Enter Color Book name', spaces: true }),
  ).trim();
  const known = [...books.values()].find(
    (c) => c.kind === 'rgb' && c.bookName?.toUpperCase() === book.toUpperCase(),
  );
  if (!known || known.kind !== 'rgb') {
    ctx.message(`Cannot find color book "${book}".`);
    return undefined;
  }
  const name = textOf(
    yield ctx.prompt.string({ message: 'Enter color name', spaces: true }),
  ).trim();
  const color = books.get(`${known.bookName}$${name}`.toUpperCase());
  if (!color) ctx.message(`Cannot find color "${name}" in color book "${known.bookName}".`);
  return color;
}

/**
 * The colour-book colours the drawing uses (on layers, objects and attributes), by
 * `BOOK$COLOR` in capitals, as AutoCAD names a DBCOLOR.
 */
export function bookColors(model: DocumentModel): Map<string, Color> {
  const out = new Map<string, Color>();
  const add = (c: Color) => {
    if (c.kind === 'rgb' && c.bookName !== undefined && c.colorName) {
      const key = `${c.bookName}$${c.colorName}`.toUpperCase();
      if (!out.has(key)) out.set(key, c);
    }
  };
  for (const l of model.tables.layers.values()) add(l.color);
  for (const e of model.entities()) {
    add(e.color);
    if (e.geom.kind === 'INSERT') for (const a of e.geom.attributes) add(a.color);
  }
  return out;
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
      return c.bookName !== undefined && c.colorName
        ? `${c.bookName}$${c.colorName}`
        : `${c.r},${c.g},${c.b}`;
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
  const specs = yield* askSpecs(ctx);
  let found: Found[];
  if (keywordOf(vis) === 'Yes') {
    const sel = yield ctx.prompt.selection({ message: 'Select Attributes', editable: true });
    found = await selectedAttributes(ctx, sel as Answer<'selection'>, specs);
  } else {
    ctx.message('Drawing must be regenerated afterwards.');
    const refs = [...ctx.model.entities()]
      .filter((e) => e.geom.kind === 'INSERT' && !ctx.model.tables.layers.get(e.layer)?.locked)
      .map((e) => e.id);
    found = matching(ctx, refs, specs);
  }
  ctx.message(`${found.length} attributes selected.`);
  if (found.length === 0) return;
  const from = yield ctx.prompt.string({ message: 'Enter string to change', spaces: true });
  const to = yield ctx.prompt.string({ message: 'Enter new string', spaces: true });
  const byRef = new Map<EntityId, AttributePatch[]>();
  for (const f of found) {
    const value = changed(valueOf(attributeOf(ctx, f)), textOf(from), textOf(to));
    if (value === undefined) continue;
    byRef.set(f.id, [...(byRef.get(f.id) ?? []), { handle: f.handle, value }]);
  }
  for (const [id, patches] of byRef) await applyPatches(ctx, id, patches);
}

export const ATTRIBUTE_COMMANDS = [eatteditCommand, atteditCommand] as const;
