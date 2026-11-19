// -LAYER's Xref option (M5-18 part 3; AutoCAD 2024 Help, "-LAYER (Command)", Xref: "Resets the
// xref layer property override in the current drawing to the layer settings in the xref").
//
// A drawing keeps its own records of its xrefs' layers (`xref|layer`, VISRETAIN), and a load
// uses them as they are (model/xref.ts), so what the drafter changed on them lasts from one load
// to the next: those are the overrides. Help's prompts: "Enter an option" naming one property of
// On, Color, Linetype, Lineweight, Transparency, Plot, Freeze, Lock, New VP Freeze, Description
// or All of them, then "Enter xref layer name(s) to reset or [?] or <*>" (names or patterns
// separated by commas; ? lists the xref layers, Enter takes them all). Each layer then takes the
// property from the layer of the same name in its xref's file, which the app reads as REFCLOSE
// reads it (`xrefDrawing`); a nested xref's layers (`nested|layer`) from the nested xref's file.
// The resets are part of -LAYER's one LAYER undo step.
//
// Ambiguities, settled for the common drafter expectation (Help gives no keywords, default or
// messages): the keywords are -LAYER's own spellings where it has the property (Color, Ltype,
// LWeight, TRansparency, Plot, Freeze, LOck, Description), On, Newvpfreeze and All, with All the
// default; a linetype the drawing has no record of (`xref|linetype`) leaves the layer's own, said;
// an xref whose file the app does not hold, or whose file has no such layer, leaves its layers
// as they are, said; the count of layers reset ends it.
import type { CommandContext } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { Handle } from '../model/handle';
import type { DocumentInit } from '../model/document';
import { ChangeSetBuilder } from '../model/builder';
import { isEmptyChangeSet } from '../model/changeset';
import type { LayerRecord } from '../model/types';
import { setLayerProps, type LayerProps } from '../edit/layer-manager';
import { isXrefRecord } from '../model/xref';
import { wcmatch } from './modify/attributes';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const PROPERTIES = [
  'On',
  'Color',
  'Ltype',
  'LWeight',
  'TRansparency',
  'Plot',
  'Freeze',
  'LOck',
  'Newvpfreeze',
  'Description',
  'All',
] as const;
type Property = (typeof PROPERTIES)[number];

/** DXF 70 bits of a layer: 2 frozen in new viewports, 16 xref-dependent. */
const NEW_VP_FROZEN = 2;
const XREF_DEPENDENT = 16;
/** The linetypes an xref shares with the host by name (model/xref.ts). */
const SHARED_LINETYPES = new Set(['BYLAYER', 'BYBLOCK', 'CONTINUOUS']);

const upper = (s: string) => s.toUpperCase();
const quoted = (s: string) => `"${s}"`;

/** An xref layer of the drawing: the record, its xref's block and its name in the xref. */
interface XrefLayer {
  readonly record: LayerRecord;
  readonly xref: Handle;
  readonly xrefName: string;
  readonly name: string;
}

/** The drawing's xref layers (`xref|layer` of an xref it attaches or overlays), by name. */
function xrefLayers(ctx: CommandContext): XrefLayer[] {
  const xrefs = new Map<string, { handle: Handle; name: string }>();
  for (const r of ctx.model.tables.blockRecords.values())
    if (isXrefRecord(r)) xrefs.set(upper(r.name), { handle: r.handle, name: r.name });
  const out: XrefLayer[] = [];
  for (const l of ctx.model.tables.layers.values()) {
    const bar = l.name.indexOf('|');
    if (((l.flags ?? 0) & XREF_DEPENDENT) === 0 || bar < 0) continue;
    const x = xrefs.get(upper(l.name.slice(0, bar)));
    if (x) out.push({ record: l, xref: x.handle, xrefName: x.name, name: l.name.slice(bar + 1) });
  }
  return out.sort((a, b) => a.record.name.localeCompare(b.record.name));
}

/** The xref's file as the app reads it now, or undefined (said why). */
async function xrefFile(ctx: CommandContext, x: XrefLayer): Promise<DocumentInit | undefined> {
  const r = await ctx.view.request({ op: 'xrefDrawing', block: x.xref });
  if (!r.ok) {
    ctx.message(r.message);
    return undefined;
  }
  if (!r.xrefDrawing) {
    const path = ctx.model.blocks.get(x.xref)?.xrefPath ?? '';
    ctx.message(
      `The file of xref ${quoted(x.xrefName)} (${path}) is not at hand: its layers were not reset.`,
    );
    return undefined;
  }
  return r.xrefDrawing.init;
}

/**
 * What `property` resets `x` to from its xref's `own` layer: the layer properties, and the DXF 70
 * flags for New VP Freeze; undefined props when the linetype cannot be had (said).
 */
function resetOf(
  ctx: CommandContext,
  x: XrefLayer,
  own: LayerRecord,
  drawing: DocumentInit,
  property: Property,
): { props: LayerProps; flags?: number } {
  const all = property === 'All';
  const props: { -readonly [K in keyof LayerProps]: LayerProps[K] } = {};
  if (all || property === 'On') props.on = own.on;
  if (all || property === 'Color') props.color = own.color;
  if (all || property === 'LWeight') props.lineweight = own.lineweight;
  if (all || property === 'TRansparency') props.transparency = own.transparency;
  if (all || property === 'Plot') props.plot = own.plot;
  if (all || property === 'Freeze') props.frozen = own.frozen;
  if (all || property === 'LOck') props.locked = own.locked;
  if (all || property === 'Description') props.description = own.description ?? '';
  if (all || property === 'Ltype') {
    const t = drawing.tables?.linetypes?.find((r) => r.handle === own.linetype);
    const name = t
      ? SHARED_LINETYPES.has(upper(t.name))
        ? t.name
        : `${x.xrefName}|${t.name}`
      : '';
    const host = [...ctx.model.tables.linetypes.values()].find(
      (r) => upper(r.name) === upper(name),
    );
    if (host) props.linetype = host.handle;
    else ctx.message(`Linetype ${quoted(name)} not found: ${quoted(x.record.name)} keeps its own.`);
  }
  if (!all && property !== 'Newvpfreeze') return { props };
  const flags = ((x.record.flags ?? 0) & ~NEW_VP_FROZEN) | ((own.flags ?? 0) & NEW_VP_FROZEN);
  return { props, flags };
}

/** "Enter xref layer name(s) to reset": the xref layers named, ? listing them first. */
async function* layersAsked(ctx: CommandContext): Sub<XrefLayer[]> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter xref layer name(s) to reset or',
      options: ['?'],
      default: { kind: 'string', value: '*' },
    });
    const layers = xrefLayers(ctx);
    if (a.kind === 'keyword') {
      if (layers.length === 0) ctx.message('No xref layers found.');
      for (const l of layers) ctx.message(l.record.name);
      continue;
    }
    const list = (a.kind === 'string' ? a.value.trim() : '') || '*';
    const found = layers.filter((l) => wcmatch(l.record.name, list));
    if (found.length === 0) ctx.message('No matching xref layers found.');
    return found;
  }
}

/** `change` made on `x` into `b`: undefined, or why not with nothing built. */
function build(
  b: ChangeSetBuilder,
  ctx: CommandContext,
  x: XrefLayer,
  change: { props: LayerProps; flags?: number },
): string | undefined {
  const why = setLayerProps(b, ctx.model, [x.record.handle], change.props);
  if (why === undefined && change.flags !== undefined && change.flags !== (x.record.flags ?? 0))
    b.updateTableRecord('layers', x.record.handle, { flags: change.flags });
  return why;
}

/**
 * One layer reset in the command's edit (none when it is already as its xref has it), or why
 * not (said); whether it was.
 */
function reset(
  ctx: CommandContext,
  x: XrefLayer,
  change: { props: LayerProps; flags?: number },
): boolean {
  const probe = new ChangeSetBuilder(ctx.model);
  const why = build(probe, ctx, x, change);
  if (why) {
    ctx.message(`${quoted(x.record.name)}: ${why}`);
    return false;
  }
  if (!isEmptyChangeSet(probe.build())) ctx.edit((b) => void build(b, ctx, x, change));
  return true;
}

/** -LAYER Xref: a property (or all) of the xref layers named reset to their xrefs' own. */
export async function* layerXrefOption(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Enter an option',
    options: [...PROPERTIES],
    default: { kind: 'keyword', keyword: 'All' },
  });
  const property: Property = a.kind === 'keyword' ? (a.keyword as Property) : 'All';
  const layers = yield* layersAsked(ctx);
  const files = new Map<Handle, DocumentInit | undefined>();
  let count = 0;
  for (const x of layers) {
    if (!files.has(x.xref)) files.set(x.xref, await xrefFile(ctx, x));
    const drawing = files.get(x.xref);
    if (!drawing) continue;
    const own = drawing.tables?.layers?.find((l) => upper(l.name) === upper(x.name));
    if (!own) {
      ctx.message(`Xref ${quoted(x.xrefName)} has no layer ${quoted(x.name)}: it was not reset.`);
      continue;
    }
    if (reset(ctx, x, resetOf(ctx, x, own, drawing, property))) count++;
  }
  if (layers.length > 0) ctx.message(`${count} xref layer${count === 1 ? '' : 's'} reset.`);
}
