// TriyaToAcad for symbol table records (M1-75 parts 6 and 8) and the style objects Triya keeps
// beside them (MLEADERSTYLE, part 11): the planning every table writer shares. Each record the model changes or adds is matched to its acad-ts original by handle
// (or made under the engine's handle), its name is checked as AutoCAD checks it, and the
// table's own rules add their problems. Nothing is changed until every table has planned.

import {
  ACadVersion,
  INamedCadObjectExtensions,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type { Handle, SymbolTableRecord } from '@triya/engine';
import { resolve, same, type Resolver } from './entities';

/** DXF 70 bits that mark a record as an xref's: the xref owns them, not the drawing. */
export const XREF_BITS = 16 | 32;

/** Record fields no table writer handles yet. */
const UNSUPPORTED = ['xdata', 'reactors', 'extDict'] as const;

export interface RecordPlan<A extends CadObject & { name: string }, R extends SymbolTableRecord> {
  readonly updated: { readonly acad: A; readonly before: R; readonly after: R }[];
  /** New acad-ts records, already holding their handle, with the record to write. */
  readonly added: { readonly acad: A; readonly after: R }[];
}

export interface RecordRules<A extends CadObject & { name: string }, R extends SymbolTableRecord> {
  /** What the problems call a record ("layer"). */
  readonly what: string;
  readonly type: abstract new (...args: never[]) => A;
  /** A new acad-ts record for `after` (flags that decide how the table keys it set). */
  readonly make: (after: R) => A;
  /** Names AutoCAD does not let a drawing rename (layer 0, Standard, ByLayer, …). */
  readonly fixedNames: readonly string[];
  /** The table's own problems with the change from `before` (undefined: a new record). */
  readonly problems: (before: R | undefined, after: R, acad: A | undefined) => string[];
  /** Records may share a name (VPORT: every tiled viewport is *Active). */
  readonly namesRepeat?: boolean;
  /** A name may be empty (a shape file's STYLE record). */
  readonly mayBeNameless?: (after: R) => boolean;
  /** Removing a record is purge.ts's to check (PURGE, M1-75 part 25). */
  readonly removable?: true;
}

/** The model's changes to one table against the original's mapping, and why any cannot be written. */
export function planRecords<A extends CadObject & { name: string }, R extends SymbolTableRecord>(
  doc: CadDocument,
  base: readonly R[],
  after: ReadonlyMap<Handle, R>,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
  rules: RecordRules<A, R>,
): { plan: RecordPlan<A, R>; problems: string[] } {
  const plan: RecordPlan<A, R> = { updated: [], added: [] };
  const problems: string[] = [];
  const version = doc.header?.version;
  const before = new Map(base.map((l) => [l.handle, l]));
  for (const [h, b] of before) {
    if (!after.has(h) && !rules.removable)
      problems.push(`${rules.what} ${b.name} (${h}): removing a ${rules.what}`);
  }
  // Names are unique without regard to case, among the records the drawing ends up with.
  const names = new Map<string, number>();
  for (const l of after.values()) {
    const key = l.name.toUpperCase();
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  const fixed = new Set(rules.fixedNames.map((n) => n.toUpperCase()));
  for (const [h, a] of after) {
    const b = before.get(h);
    if (b && same(b, a)) continue;
    const out: string[] = [];
    let acad: A | undefined;
    if (b) {
      acad = resolve(r, h, rules.type);
      if (!acad) out.push(`the original is not a ${rules.what}`);
      // An R12 file reads with records acad-ts makes up (layer 0, ByLayer, …) and does not
      // write back (a written one would move every other made-up handle on reopening).
      if (
        acad &&
        doc.madeUpHandles?.added.has(acad.handle) &&
        (version ?? ACadVersion.AC1032) <= ACadVersion.AC1009
      )
        out.push(
          `the file does not have this ${rules.what} (acad-ts made it up and writes it back only as read)`,
        );
    } else if (doc.getCadObject(Number.parseInt(h, 16))) {
      out.push('the handle is already used');
    }
    if (!b || b.name !== a.name) {
      const nameless = a.name === '' && (rules.mayBeNameless?.(a) ?? false);
      // Table.add would make up a name for a nameless record, and a rename to '' loses its key.
      if (nameless && b) out.push('a record cannot be renamed to no name');
      if (b && fixed.has(b.name.toUpperCase())) out.push(`${b.name} cannot be renamed`);
      else if (b && ((b.flags ?? 0) & XREF_BITS) !== 0)
        out.push(`an xref-dependent ${rules.what} cannot be renamed`);
      else if (!nameless && !rules.namesRepeat && (names.get(a.name.toUpperCase()) ?? 0) > 1)
        out.push(`another ${rules.what} is named ${a.name}`);
      else if (
        !nameless &&
        !INamedCadObjectExtensions.isValidDxfName({ name: a.name } as never, version)
      )
        out.push(`${JSON.stringify(a.name)} is not a valid ${rules.what} name`);
    }
    for (const k of UNSUPPORTED) {
      if (b ? !same(b[k], a[k]) : a[k] !== undefined) out.push(`${k} changes`);
    }
    out.push(...rules.problems(b, a, acad));
    if (out.length > 0) {
      problems.push(...out.map((p) => `${rules.what} ${a.name} (${h}): ${p}`));
    } else if (b) {
      plan.updated.push({ acad: acad!, before: b, after: a });
    } else {
      acad = rules.make(a);
      // acad-ts keeps a non-zero handle it has not seen, so the record keeps Triya's handle.
      acad.handle = Number.parseInt(h, 16);
      plan.added.push({ acad, after: a });
      r.created.set(h, acad);
    }
  }
  return { plan, problems };
}

/** `changed(k)`: whether field `k` differs between `b` and `a` (every set field of a new record). */
export function changes<R extends object>(
  b: R | undefined,
  a: R,
): (...keys: (keyof R)[]) => boolean {
  return (...keys) => !b || keys.some((k) => !same(b[k], a[k]));
}
