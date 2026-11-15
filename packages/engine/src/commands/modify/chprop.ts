// CHPROP and CHANGE (M3-02 part 5), with AutoCAD 2024's prompts (AutoCAD Help, "CHPROP
// (Command)", "CHANGE (Command)"):
//
//   Select objects:
//   Enter property to change [Color/LAyer/LType/ltScale/LWeight/Thickness/TRansparency/Material/PLotstyle]:
//   New color [Truecolor] <BYLAYER>:
//
// CHPROP changes the selected objects' properties one at a time until Enter; each goes through
// the Properties palette's edit (`applyProperty`), so objects on locked layers are left as the
// palette leaves them. CHANGE first asks for a change point: lines' nearer ends move to it,
// circles' radii pass through it, texts and attribute definitions move to it and are asked their
// style, height, rotation and text (an attribute definition its tag, prompt and default too),
// and block references move to it and are asked their rotation. Its Properties option is
// CHPROP's, with Elev for the objects' elevation.
//
// Annotative (CHPROP) and COlorbook are not offered: making objects annotative is a PRD
// non-goal (DEC-013), and colour books are chosen from the Properties palette.
import { transformObjects } from '../../edit/edit';
import { moveBy, turnAbout } from '../../edit/similarity';
import { distance, sub } from '../../geom/vec';
import type { Vec2 } from '../../geom/types';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type {
  Color,
  Entity,
  EntityGeometry,
  Lineweight,
  TableName,
  Transparency,
} from '../../model/types';
import { namedPlotStyles, thicknessOf } from '../../properties/general';
import { LINEWEIGHTS, transparencyValue } from '../../properties/sheet';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { applyProperty } from './property-edit';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const COLOR_NAMES = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white'];

/** A colour as CHPROP shows it: BYLAYER, BYBLOCK, a name, a number or "r,g,b". */
export function colorText(c: Color): string {
  switch (c.kind) {
    case 'byLayer':
      return 'BYLAYER';
    case 'byBlock':
      return 'BYBLOCK';
    case 'aci':
      return COLOR_NAMES[c.index - 1] ?? String(c.index);
    case 'rgb':
      return `${c.r},${c.g},${c.b}`;
  }
}

/** A typed colour as the palette's value (`aci:N`, `rgb:r,g,b`, ByLayer, ByBlock), or undefined. */
export function colorFromText(t: string): string | undefined {
  const u = t.trim().toUpperCase();
  if (u === 'BYLAYER') return 'ByLayer';
  if (u === 'BYBLOCK') return 'ByBlock';
  const named = COLOR_NAMES.indexOf(u.toLowerCase());
  if (named >= 0) return `aci:${named + 1}`;
  if (/^\d+$/.test(u)) {
    const n = Number(u);
    if (n >= 1 && n <= 255) return `aci:${n}`;
    if (n === 256) return 'ByLayer';
    if (n === 0) return 'ByBlock';
  }
  return undefined;
}

/** A record of `table` by name, ignoring case. */
function recordByName(ctx: CommandContext, table: TableName, name: string): Handle | undefined {
  const u = name.trim().toUpperCase();
  for (const r of (ctx.model.tables[table] as ReadonlyMap<Handle, { name: string }>).values()) {
    if (r.name.toUpperCase() === u) return (r as unknown as { handle: Handle }).handle;
  }
  return undefined;
}

const recordName = (ctx: CommandContext, table: TableName, h: Handle | undefined): string =>
  h === undefined
    ? ''
    : ((ctx.model.tables[table] as ReadonlyMap<Handle, { name: string }>).get(h)?.name ?? '');

/** The value every one of `entities` shares, by `key`, or undefined. */
function shared<T>(entities: readonly Entity[], key: (e: Entity) => T): T | undefined {
  if (entities.length === 0) return undefined;
  const first = key(entities[0]!);
  const f = JSON.stringify(first);
  return entities.every((e) => JSON.stringify(key(e)) === f) ? first : undefined;
}

const lineweightText = (w: Lineweight): string =>
  typeof w === 'number' ? (w / 100).toFixed(2) : w === 'Default' ? 'Default' : w;

/** A typed lineweight (millimetres, or ByLayer/ByBlock/Default) as AutoCAD's, or undefined. */
export function lineweightFromText(t: string): Lineweight | undefined {
  const u = t.trim().toUpperCase();
  if (u === 'BYLAYER') return 'ByLayer';
  if (u === 'BYBLOCK') return 'ByBlock';
  if (u === 'DEFAULT') return 'Default';
  const mm = Number(u);
  if (!Number.isFinite(mm) || u === '') return undefined;
  const w = Math.round(mm * 100);
  return LINEWEIGHTS.includes(w) && Math.abs(mm * 100 - w) < 1e-6 ? w : undefined;
}

const transparencyText = (t: Transparency): string => String(transparencyValue(t));

/** The kinds CHANGE's Elev moves: those with an elevation in plan. */
const ELEVATED = new Set([
  'LINE',
  'CIRCLE',
  'ARC',
  'ELLIPSE',
  'POINT',
  'LWPOLYLINE',
  'POLYLINE',
  'TEXT',
  'ATTDEF',
  'MTEXT',
  'INSERT',
  'SOLID',
  'TRACE',
]);

/**
 * CHPROP's property loop (CHANGE's Properties, with Elev when `elev`), on `ids`, until Enter.
 * Undefined when cancelled.
 */
async function* properties(
  ctx: CommandContext,
  ids: readonly EntityId[],
  elev: boolean,
): Sub<void> {
  const options = [
    'Color',
    ...(elev ? ['Elev'] : []),
    'LAyer',
    'LType',
    'ltScale',
    'LWeight',
    'Thickness',
    'TRansparency',
    'Material',
    'PLotstyle',
  ];
  const entities = () => ids.flatMap((id) => ctx.model.entity(id) ?? []);
  const set = async (key: string, value: string | number): Promise<void> => {
    await applyProperty(ctx, ids, { key, value }, undefined);
  };
  for (;;) {
    const a = yield ctx.prompt.keyword({ message: 'Enter property to change', options });
    if (a.kind !== 'keyword') return;
    const es = entities();
    switch (a.keyword) {
      case 'Color': {
        const now = shared(es, (e) => e.color);
        const c = yield ctx.prompt.string({
          message: 'New color',
          options: ['Truecolor'],
          ...(now && { defaultLabel: colorText(now) }),
        });
        if (c.kind === 'enter') break;
        if (c.kind === 'keyword') {
          const rgb = yield ctx.prompt.string({ message: 'Red, Green, Blue' });
          if (rgb.kind !== 'string') break;
          const m = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(rgb.value);
          if (!m || [m[1], m[2], m[3]].some((x) => Number(x) > 255)) {
            ctx.message('Invalid color.');
            break;
          }
          await set('color', `rgb:${m[1]},${m[2]},${m[3]}`);
          break;
        }
        if (c.kind !== 'string') return;
        const v = colorFromText(c.value);
        if (!v) ctx.message('Invalid color.');
        else await set('color', v);
        break;
      }
      case 'Elev': {
        const now = shared(es, (e) => (e.geom as { elevation?: number }).elevation ?? 0);
        const d = yield ctx.prompt.distance({
          message: 'Specify new elevation',
          ...(now !== undefined && { default: { kind: 'distance', value: now } }),
        });
        if (d.kind === 'enter') break;
        if (d.kind !== 'distance') return;
        ctx.edit((b) => {
          for (const e of entities()) {
            if (!ELEVATED.has(e.geom.kind) || (e.geom.kind === 'POLYLINE' && e.geom.is3d)) continue;
            if (ctx.model.tables.layers.get(e.layer)?.locked) continue;
            const { elevation: _el, ...rest } = e.geom as EntityGeometry & { elevation?: number };
            const geom = (d.value === 0 ? rest : { ...rest, elevation: d.value }) as EntityGeometry;
            if (JSON.stringify(geom) !== JSON.stringify(e.geom)) b.updateEntity(e.id, { geom });
          }
        });
        break;
      }
      case 'LAyer': {
        const now = shared(es, (e) => e.layer);
        const s = yield ctx.prompt.string({
          message: 'Enter new layer name',
          ...(now !== undefined && { defaultLabel: recordName(ctx, 'layers', now) }),
        });
        if (s.kind !== 'string') break;
        const h = recordByName(ctx, 'layers', s.value);
        if (h === undefined) ctx.message(`Cannot find layer "${s.value.trim()}".`);
        else await set('layer', h);
        break;
      }
      case 'LType': {
        const now = shared(es, (e) => e.linetype);
        const s = yield ctx.prompt.string({
          message: 'Enter new linetype name',
          ...(now !== undefined && {
            defaultLabel:
              now === 'ByLayer' || now === 'ByBlock' ? now : recordName(ctx, 'linetypes', now),
          }),
        });
        if (s.kind !== 'string') break;
        const u = s.value.trim().toUpperCase();
        const h =
          u === 'BYLAYER'
            ? 'ByLayer'
            : u === 'BYBLOCK'
              ? 'ByBlock'
              : recordByName(ctx, 'linetypes', s.value);
        if (h === undefined) {
          ctx.message(
            `Linetype ${s.value.trim()} not found.  Use the LINETYPE command to load it.`,
          );
        } else await set('linetype', h);
        break;
      }
      case 'ltScale': {
        const now = shared(es, (e) => e.ltScale);
        const d = yield ctx.prompt.real({
          message: 'Specify new linetype scale',
          ...(now !== undefined && { default: { kind: 'number', value: now } }),
        });
        if (d.kind !== 'number') break;
        if (d.value <= 0) ctx.message('Value must be positive and nonzero.');
        else await set('ltScale', d.value);
        break;
      }
      case 'LWeight': {
        const now = shared(es, (e) => e.lineweight);
        const s = yield ctx.prompt.string({
          message: 'Enter new lineweight',
          ...(now !== undefined && { defaultLabel: lineweightText(now) }),
        });
        if (s.kind !== 'string') break;
        const w = lineweightFromText(s.value);
        if (w === undefined) ctx.message('Invalid lineweight.');
        else await set('lineweight', String(w));
        break;
      }
      case 'Thickness': {
        const now = shared(es, thicknessOf);
        const d = yield ctx.prompt.distance({
          message: 'Specify new thickness',
          ...(now !== undefined && { default: { kind: 'distance', value: now } }),
        });
        if (d.kind !== 'distance') break;
        await set('thickness', d.value);
        break;
      }
      case 'TRansparency': {
        const now = shared(es, (e) => e.transparency);
        const s = yield ctx.prompt.string({
          message: 'Enter transparency value',
          options: ['ByLayer', 'ByBlock'],
          ...(now !== undefined && { defaultLabel: transparencyText(now) }),
        });
        if (s.kind === 'keyword') await set('transparency', s.keyword);
        else if (s.kind === 'string') {
          const n = Number(s.value.trim());
          if (!Number.isInteger(n) || n < 0 || n > 90) {
            ctx.message('Value must be ByLayer, ByBlock or between 0 and 90.');
          } else await set('transparency', n);
        }
        break;
      }
      case 'Material': {
        const s = yield ctx.prompt.string({
          message: 'Enter new material name',
          defaultLabel: 'ByLayer',
        });
        if (s.kind !== 'string') break;
        const u = s.value.trim().toUpperCase();
        const h = u === 'BYLAYER' ? 'ByLayer' : recordByName(ctx, 'materials', s.value);
        if (h === undefined) ctx.message(`Material "${s.value.trim()}" not found.`);
        else await set('material', h);
        break;
      }
      case 'PLotstyle': {
        if (!namedPlotStyles(ctx.model)) {
          ctx.message('Plot styles are by colour in this drawing (color-dependent plot styles).');
          break;
        }
        const s = yield ctx.prompt.string({
          message: 'Enter Plot Style',
          defaultLabel: 'ByLayer',
        });
        if (s.kind !== 'string') break;
        const u = s.value.trim().toUpperCase();
        const h = u === 'BYLAYER' ? 'ByLayer' : recordByName(ctx, 'plotStyles', s.value);
        if (h === undefined) ctx.message(`Plot style "${s.value.trim()}" not found.`);
        else await set('plotStyle', h);
        break;
      }
    }
  }
}

export function chpropCommand(): CommandDef {
  return {
    name: 'CHPROP',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      yield* properties(ctx, a.ids, false);
    },
  };
}

// ── CHANGE ─────────────────────────────────────────────────────────────────────────────────

export function changeCommand(): CommandDef {
  return {
    name: 'CHANGE',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      const p = yield ctx.prompt.point({
        message: 'Specify change point or',
        options: ['Properties'],
      });
      if (p.kind === 'keyword') {
        yield* properties(ctx, a.ids, true);
        return;
      }
      const at = p.kind === 'point' ? p.point : undefined;
      if (p.kind !== 'point' && p.kind !== 'enter') return;
      for (const id of a.ids) {
        const e = ctx.model.entity(id);
        if (!e) continue;
        const ok = yield* changeOne(ctx, e, at);
        if (!ok) return;
      }
    },
  };
}

/** CHANGE at `at` (none: Enter) for one object; false when cancelled. */
async function* changeOne(ctx: CommandContext, e: Entity, at: Vec2 | undefined): Sub<boolean> {
  const g = e.geom;
  switch (g.kind) {
    case 'LINE': {
      if (!at) return true;
      // The end nearer the change point moves to it.
      const geom =
        distance(g.start, at) <= distance(g.end, at) ? { ...g, start: at } : { ...g, end: at };
      ctx.edit((b) => b.updateEntity(e.id, { geom }));
      return true;
    }
    case 'CIRCLE': {
      let r = at ? distance(g.center, at) : undefined;
      if (r === undefined) {
        const d = yield ctx.prompt.distance({
          message: 'Specify new circle radius',
          base: g.center,
          defaultLabel: 'no change',
        });
        if (d.kind === 'enter') return true;
        if (d.kind !== 'distance') return false;
        r = d.value;
      }
      if (!(r > 0)) return true;
      ctx.edit((b) => b.updateEntity(e.id, { geom: { ...g, radius: r! } }));
      return true;
    }
    case 'INSERT': {
      let to = at;
      if (!to) {
        const q = yield ctx.prompt.point({
          message: 'Specify new block insertion point',
          rubberBand: { from: g.position },
        });
        if (q.kind === 'point') to = q.point;
        else if (q.kind !== 'enter') return false;
      }
      if (to) {
        const by = sub(to, g.position);
        ctx.edit((b) => transformObjects(b, ctx.model, [e.id], moveBy(by)));
      }
      const now = ctx.model.entity(e.id)!.geom as typeof g;
      const t = yield ctx.prompt.angle({
        message: 'Specify new block rotation angle',
        base: now.position,
        default: { kind: 'angle', value: now.rotation },
      });
      if (t.kind !== 'angle') return t.kind === 'enter';
      const turn = t.value - now.rotation;
      if (Math.abs(turn) > 1e-15) {
        ctx.edit((b) => transformObjects(b, ctx.model, [e.id], turnAbout(now.position, turn)));
      }
      return true;
    }
    case 'TEXT':
    case 'ATTDEF': {
      const anchor = (x: typeof g) =>
        x.halign === 0 && x.valign === 0 ? x.position : (x.alignmentPoint ?? x.position);
      let to = at;
      if (!to) {
        const q = yield ctx.prompt.point({
          message: 'Specify new text insertion point',
          defaultLabel: 'no change',
        });
        if (q.kind === 'point') to = q.point;
        else if (q.kind !== 'enter') return false;
      }
      if (to) {
        const by = sub(to, anchor(g));
        ctx.edit((b) => transformObjects(b, ctx.model, [e.id], moveBy(by)));
      }
      const cur = () => ctx.model.entity(e.id)!.geom as typeof g;
      const patch = (next: Partial<typeof g>) =>
        ctx.edit((b) => b.updateEntity(e.id, { geom: { ...cur(), ...next } as EntityGeometry }));
      const style = yield ctx.prompt.string({
        message: 'Enter new text style',
        defaultLabel: recordName(ctx, 'textStyles', cur().style),
      });
      if (style.kind === 'string') {
        const h = recordByName(ctx, 'textStyles', style.value);
        if (h === undefined) ctx.message(`Cannot find text style "${style.value.trim()}".`);
        else {
          const s = ctx.model.tables.textStyles.get(h)!;
          patch({ style: h, ...(s.height > 0 && { height: s.height }) });
        }
      } else if (style.kind !== 'enter') return false;
      const fixed = (ctx.model.tables.textStyles.get(cur().style)?.height ?? 0) > 0;
      if (!fixed) {
        const h = yield ctx.prompt.distance({
          message: 'Specify new height',
          base: anchor(cur()),
          default: { kind: 'distance', value: cur().height },
        });
        if (h.kind === 'distance' && h.value > 0 && h.value !== cur().height)
          patch({ height: h.value });
        else if (h.kind !== 'distance' && h.kind !== 'enter') return false;
      }
      const r = yield ctx.prompt.angle({
        message: 'Specify new rotation angle',
        base: anchor(cur()),
        default: { kind: 'angle', value: cur().rotation },
      });
      if (r.kind === 'angle') {
        const turn = r.value - cur().rotation;
        if (Math.abs(turn) > 1e-15) {
          ctx.edit((b) => transformObjects(b, ctx.model, [e.id], turnAbout(anchor(cur()), turn)));
        }
      } else if (r.kind !== 'enter') return false;
      if (g.kind === 'ATTDEF') {
        for (const [field, message] of [
          ['tag', 'Enter new tag'],
          ['prompt', 'Enter new prompt'],
          ['value', 'Enter new default value'],
        ] as const) {
          const now = (cur() as unknown as Record<string, string>)[field] ?? '';
          const s = yield ctx.prompt.string({ message, defaultLabel: now, spaces: true });
          if (s.kind === 'string') {
            if (field === 'tag' && /\s/.test(s.value.trim())) {
              ctx.message('Tag may not contain spaces.');
            } else if (s.value !== now)
              patch({ [field]: field === 'tag' ? s.value.trim().toUpperCase() : s.value } as never);
          } else if (s.kind !== 'enter') return false;
        }
        return true;
      }
      const s = yield ctx.prompt.string({
        message: 'Enter new text',
        defaultLabel: cur().value,
        spaces: true,
      });
      if (s.kind === 'string' && s.value !== cur().value) patch({ value: s.value });
      else if (s.kind !== 'string' && s.kind !== 'enter') return false;
      return true;
    }
    default:
      return true;
  }
}
