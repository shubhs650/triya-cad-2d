// The drawing's scale list (M6-02 part 21): the SCALE objects of its ACAD_SCALELIST dictionary,
// which the annotation scale menu, CANNOSCALE, the viewport scale prompts and SCALELISTEDIT
// share. AutoCAD 2024 Help, "SCALELISTEDIT (Command)" ("Controls the list of scales available
// for layout viewports, page layouts, and plotting") and "Edit Drawing Scales Dialog Box":
//   - Add makes a scale of a name and a ratio of paper units to drawing units;
//   - Edit changes a scale's name, and its ratio unless an object in the drawing uses it ("You
//     cannot change the scale properties of a scale referenced by an object in the drawing");
//   - Move Up and Move Down reorder the list;
//   - Delete removes a scale, but not the current one or one an annotative object uses;
//   - Reset "Deletes all custom scales and unused scales and restores the default list".
// Every one of them is the list as it should end up (`ScaleListEntry[]`), which `scaleListEdit`
// turns into the SCALE objects' changes: the dialog's OK and each -SCALELISTEDIT option alike.
//
// Ambiguities, settled for the common drafter expectation:
//   - The list's order is its entries' keys (A0 … A9, B0 …), as the sorted dictionary AutoCAD
//     keeps lists them; a list whose kept scales stay in order keeps their keys and gives new
//     scales the next ones, any other order numbers every entry again from A0. After Z9 the
//     letters go on as spreadsheet columns do (AA0), Triya's choice. A drawing another program
//     wrote may key its scales otherwise (by name, say): its list is in the order it holds
//     them, and its first edit numbers them from A0.
//   - Reset's default list is the one AutoCAD writes into a new drawing (17 metric scales, then
//     16 imperial ones, the ACadSharp samples' list); a kept scale of a default name takes its
//     place, other kept scales follow the defaults.
//   - Names are unique without regard to case, as the dictionary keys AutoCAD compares.
//   - A drawing with no scale list (before AutoCAD 2008) edits the list the viewport scale
//     prompts offer it (`viewportScales`), which its first change writes.
import type { DocumentModel } from '../model/document';
import type { ChangeSetBuilder } from '../model/builder';
import type { Handle } from '../model/handle';
import {
  isDrawingScale,
  type AnnotationScale,
  type DrawingScale,
  type NonGraphicalObject,
} from '../model/types';

/** A scale as a scale list edit states it: an existing one by handle, or a new one. */
export interface ScaleListEntry {
  /** The SCALE it is, absent for a new scale. */
  readonly handle?: Handle;
  readonly name: string;
  readonly paperUnits: number;
  readonly drawingUnits: number;
  /** A new scale's DXF 290 (Reset's 1:1); an existing scale keeps its own. */
  readonly unitScale?: boolean;
}

/** One scale of AutoCAD's default list. */
const scale = (name: string, paperUnits: number, drawingUnits: number): ScaleListEntry => ({
  name,
  paperUnits,
  drawingUnits,
  ...(name === '1:1' ? { unitScale: true } : {}),
});

const ft = (inches: string, paperUnits: number) => scale(`${inches}" = 1'-0"`, paperUnits, 12);

/**
 * The scale list Reset restores: what AutoCAD writes into a new drawing, metric then imperial
 * (the ACadSharp R2010–R2018 samples' 33 SCALEs, names and ratios as they hold them).
 */
export const DEFAULT_SCALE_LIST: readonly ScaleListEntry[] = [
  scale('1:1', 1, 1),
  ...[2, 4, 5, 8, 10, 16, 20, 30, 40, 50, 100].map((d) => scale(`1:${d}`, 1, d)),
  ...[2, 4, 8, 10, 100].map((p) => scale(`${p}:1`, p, 1)),
  ft('1/128', 1 / 128),
  ft('1/64', 1 / 64),
  ft('1/32', 1 / 32),
  ft('1/16', 1 / 16),
  ft('3/32', 3 / 32),
  ft('1/8', 1 / 8),
  ft('3/16', 3 / 16),
  ft('1/4', 1 / 4),
  ft('3/8', 3 / 8),
  ft('1/2', 1 / 2),
  ft('3/4', 3 / 4),
  ft('1', 1),
  ft('1-1/2', 1.5),
  ft('3', 3),
  ft('6', 6),
  scale(`1'-0" = 1'-0"`, 12, 12),
];

/** Keys compare shorter first, then as text: A0 < Z9 < AA0. */
export function compareScaleKeys(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The `i`th key of a list numbered from A0: A0 … A9, B0 … Z9, AA0 … */
export function scaleKey(i: number): string {
  let n = Math.floor(i / 10);
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${letters}${i % 10}`;
}

/** The index `scaleKey` gives `key`, or undefined for a key of another form. */
function keyIndex(key: string): number | undefined {
  const m = /^([A-Z]+)(\d)$/.exec(key);
  if (!m) return undefined;
  let n = 0;
  for (const c of m[1]!) n = n * 26 + (c.charCodeAt(0) - 64);
  return (n - 1) * 10 + Number(m[2]);
}

type Objects = Pick<DocumentModel, 'objects'>;

/**
 * The drawing's SCALEs in list order: by key while every key is one of AutoCAD's (A0, A1, …),
 * else as the drawing holds them (another program may file them under their names).
 */
export function drawingScales(model: Objects): DrawingScale[] {
  const out: DrawingScale[] = [];
  for (const o of model.objects.values()) if (isDrawingScale(o)) out.push(o);
  if (out.every((s) => keyIndex(s.key) !== undefined))
    out.sort((a, b) => compareScaleKeys(a.key, b.key));
  return out;
}

const ratio = (s: Pick<DrawingScale, 'paperUnits' | 'drawingUnits'>): number | undefined =>
  s.paperUnits > 0 && s.drawingUnits > 0 && Number.isFinite(s.paperUnits / s.drawingUnits)
    ? s.paperUnits / s.drawingUnits
    : undefined;

/**
 * The scale list as CANNOSCALE and the scale menus read it: each SCALE with a valid ratio, the
 * first of a name, in list order.
 */
export function annotationScales(model: Objects): AnnotationScale[] {
  const out: AnnotationScale[] = [];
  for (const s of drawingScales(model)) {
    const value = ratio(s);
    if (value !== undefined && s.name && !out.some((o) => o.name === s.name))
      out.push({ name: s.name, value, handle: s.handle });
  }
  return out;
}

/** The scale list's scale called `name` (as spelled), if any. */
export function annotationScaleNamed(model: Objects, name: string): AnnotationScale | undefined {
  for (const s of drawingScales(model))
    if (s.name === name) {
      const value = ratio(s);
      return value === undefined ? undefined : { name: s.name, value, handle: s.handle };
    }
  return undefined;
}

type Model = Pick<DocumentModel, 'objects' | 'header' | 'meta' | 'entities'>;

/** Why SCALELISTEDIT may not delete a scale or change its ratio, if it may not. */
export type ScaleUse = 'current' | 'object';

/** The SCALE handles an annotative object's representations name, in any space or block. */
function representedScales(model: Pick<DocumentModel, 'entities'>): Set<Handle> {
  const out = new Set<Handle>();
  for (const e of model.entities())
    for (const r of e.annotative?.representations ?? []) if (r.scale) out.add(r.scale);
  return out;
}

/**
 * How each scale of the list is in use: `object` when an annotative object names it (one Triya
 * maps, or one it keeps as read), `current` when CANNOSCALE names it.
 */
export function scaleUses(model: Model): Map<Handle, ScaleUse> {
  const out = new Map<Handle, ScaleUse>();
  const named = representedScales(model);
  const current = model.header.get('CANNOSCALE');
  for (const s of drawingScales(model)) {
    if (s.referenced || named.has(s.handle)) out.set(s.handle, 'object');
    else if (s.name === current) out.set(s.handle, 'current');
  }
  return out;
}

/** The list SCALELISTEDIT starts from: the drawing's, else the viewport scale prompts' own. */
export function scaleListOf(model: Objects, fallback: readonly ScaleListEntry[]): ScaleListEntry[] {
  const own = drawingScales(model);
  if (own.length === 0) return fallback.map((s) => ({ ...s }));
  return own.map((s) => ({
    handle: s.handle,
    name: s.name,
    paperUnits: s.paperUnits,
    drawingUnits: s.drawingUnits,
  }));
}

/** The list Reset leaves: the defaults, the scales in use kept (see the head comment). */
export function resetScaleList(model: Model, list: readonly ScaleListEntry[]): ScaleListEntry[] {
  const uses = scaleUses(model);
  const kept = list.filter((s) => s.handle !== undefined && uses.has(s.handle));
  const upper = (n: string) => n.toUpperCase();
  const out: ScaleListEntry[] = DEFAULT_SCALE_LIST.map((d) => {
    const mine = kept.find((k) => upper(k.name) === upper(d.name));
    if (mine) return mine;
    // An unused scale of a default name stays itself with the default's ratio.
    const same = list.find(
      (s) => s.handle !== undefined && !uses.has(s.handle) && upper(s.name) === upper(d.name),
    );
    return same
      ? { ...same, name: d.name, paperUnits: d.paperUnits, drawingUnits: d.drawingUnits }
      : d;
  });
  for (const k of kept) if (!out.includes(k)) out.push(k);
  return out;
}

/** The longest scale name SCALELISTEDIT takes (a dictionary entry's text). */
const NAME_MAX = 255;

/** Why `name` cannot name a scale of `list` other than the one at `self`, or undefined. */
export function scaleNameProblem(
  list: readonly ScaleListEntry[],
  name: string,
  self?: number,
): string | undefined {
  if (name.trim() === '' || name.length > NAME_MAX) return 'Invalid scale name.';
  const key = name.toUpperCase();
  const other = list.findIndex((s, i) => i !== self && s.name.toUpperCase() === key);
  return other >= 0 ? `A scale named "${list[other]!.name}" already exists.` : undefined;
}

const NUMBER = String.raw`(\d*\.?\d+(?:e[+-]?\d+)?)`;

/**
 * A typed scale ratio: `a:b` or `a=b`, paper units to drawing units, or a number (that many
 * paper units to one drawing unit); undefined for anything else or a ratio not positive.
 */
export function parseScaleRatio(
  text: string,
): { readonly paperUnits: number; readonly drawingUnits: number } | undefined {
  const t = text.trim();
  const pair = new RegExp(`^${NUMBER}\\s*[:=]\\s*${NUMBER}$`, 'i').exec(t);
  const one = new RegExp(`^${NUMBER}$`, 'i').exec(t);
  const paperUnits = Number(pair ? pair[1] : one?.[1]);
  const drawingUnits = pair ? Number(pair[2]) : one ? 1 : NaN;
  return paperUnits > 0 && drawingUnits > 0 && Number.isFinite(paperUnits / drawingUnits)
    ? { paperUnits, drawingUnits }
    : undefined;
}

export const SCALE_IN_USE_BY_OBJECT = (name: string) =>
  `Scale "${name}" is used by an annotative object and cannot be deleted.`;
export const SCALE_IS_CURRENT = (name: string) =>
  `Scale "${name}" is the current annotation scale and cannot be deleted.`;
export const SCALE_RATIO_IN_USE = (name: string) =>
  `Scale "${name}" is used by an annotative object: its paper and drawing units cannot change.`;
export const SCALE_LIST_NO_DICTIONARY = 'The drawing has no scale list to add scales to.';
export const SCALE_LIST_EMPTY = 'The scale list needs at least one scale.';

/** Why the scale list cannot become `list`, the first reason, or undefined. */
export function scaleListProblem(
  model: Model,
  list: readonly ScaleListEntry[],
): string | undefined {
  if (list.length === 0) return SCALE_LIST_EMPTY;
  const uses = scaleUses(model);
  const now = new Map(drawingScales(model).map((s) => [s.handle, s]));
  for (const [i, s] of list.entries()) {
    const name = scaleNameProblem(list, s.name, i);
    if (name) return name;
    if (!(s.paperUnits > 0 && s.drawingUnits > 0 && Number.isFinite(s.paperUnits / s.drawingUnits)))
      return 'Invalid scale.';
    if (s.handle === undefined) continue;
    const was = now.get(s.handle);
    if (!was) return 'Invalid scale.';
    const ratioChanged = was.paperUnits !== s.paperUnits || was.drawingUnits !== s.drawingUnits;
    if (ratioChanged && uses.get(s.handle) === 'object') return SCALE_RATIO_IN_USE(was.name);
  }
  const kept = new Set(list.flatMap((s) => (s.handle === undefined ? [] : [s.handle])));
  for (const [h, s] of now) {
    if (kept.has(h)) continue;
    const use = uses.get(h);
    if (use === 'object') return SCALE_IN_USE_BY_OBJECT(s.name);
    if (use === 'current') return SCALE_IS_CURRENT(s.name);
  }
  if (list.some((s) => s.handle === undefined) && !scaleListDictionary(model))
    return SCALE_LIST_NO_DICTIONARY;
  return undefined;
}

/** The ACAD_SCALELIST dictionary new scales are filed in. */
function scaleListDictionary(model: Pick<DocumentModel, 'meta' | 'objects'>): Handle | undefined {
  return model.meta.scaleListDictionary ?? drawingScales(model)[0]?.owner;
}

/**
 * The keys `list` gives its scales: the kept scales' own while they stay in key order and every
 * new scale follows them (new ones numbered on from the last), else every entry from A0.
 */
function listKeys(model: Objects, list: readonly ScaleListEntry[]): string[] {
  const keys = new Map(drawingScales(model).map((s) => [s.handle, s.key]));
  let last: string | undefined;
  let added = false;
  let keep = true;
  for (const s of list) {
    const key = s.handle === undefined ? undefined : keys.get(s.handle);
    if (key === undefined) {
      added = true;
      continue;
    }
    if (added || (last !== undefined && compareScaleKeys(last, key) >= 0)) keep = false;
    last = key;
  }
  const lastIndex = last === undefined ? -1 : keyIndex(last);
  if (!keep || lastIndex === undefined) return list.map((_, i) => scaleKey(i));
  let next = lastIndex + 1;
  return list.map((s) => (s.handle !== undefined ? keys.get(s.handle)! : scaleKey(next++)));
}

/**
 * Makes the drawing's scale list `list` in `b`, which `scaleListProblem` passed: SCALEs left out
 * are deleted, kept ones renamed, given new ratios and keys, new ones filed in ACAD_SCALELIST
 * (listing it as their reactor, as AutoCAD files one). CANNOSCALE follows its scale's new name,
 * and CANNOSCALEVALUE its new ratio.
 */
export function writeScaleList(
  model: Model,
  b: ChangeSetBuilder,
  list: readonly ScaleListEntry[],
): void {
  const now = new Map(drawingScales(model).map((s) => [s.handle, s]));
  const keys = listKeys(model, list);
  const current = model.header.get('CANNOSCALE');
  const kept = new Set(list.flatMap((s) => (s.handle === undefined ? [] : [s.handle])));
  for (const h of now.keys()) if (!kept.has(h)) b.removeObject(h);
  const owner = scaleListDictionary(model);
  for (const [i, s] of list.entries()) {
    const key = keys[i]!;
    const fields = {
      key,
      name: s.name,
      paperUnits: s.paperUnits,
      drawingUnits: s.drawingUnits,
    };
    const was = s.handle === undefined ? undefined : now.get(s.handle);
    if (was) {
      const patch = Object.fromEntries(
        Object.entries(fields).filter(([k, v]) => was[k as keyof typeof fields] !== v),
      );
      if (Object.keys(patch).length > 0) b.updateObject(was.handle, patch);
      if (was.name === current) {
        if (s.name !== was.name) b.setHeader('CANNOSCALE', s.name);
        const value = ratio(s);
        if (value !== undefined && value !== ratio(was)) b.setHeader('CANNOSCALEVALUE', value);
      }
    } else {
      b.addObject({
        type: 'SCALE',
        owner: owner!,
        reactors: [owner!],
        ...fields,
        unitScale: s.unitScale === true,
      } as Omit<DrawingScale, 'handle'> as Omit<NonGraphicalObject, 'handle'>);
    }
  }
}
