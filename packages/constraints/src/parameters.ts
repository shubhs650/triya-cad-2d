// The Parameters Manager's table (M9-03; AutoCAD 2024 Help, "Parameters Manager (Drawing)"):
// the parameters of dimensional constraints and the user parameters, each with a Name, an
// Expression, its Value, a Type and a Description. A value is evaluated after the values its
// expression names; an edit that would leave a parameter without a value (a circular reference,
// an unknown name, a division by zero downstream) is refused and the table kept as it was. A
// table loaded from a drawing may hold such rows: each shows its error (the Manager's red text)
// until an edit puts it right.
import {
  isValidParameterName,
  parseExpression,
  renameInExpression,
  type ExpressionOptions,
  type ParsedExpression,
} from './expression';

/** A parameter of a dimensional constraint, or one the user made in the Parameters Manager. */
export type ParameterKind = 'constraint' | 'user';

export interface ParameterDefinition {
  readonly name: string;
  readonly expression: string;
  /** `user` when not given. */
  readonly kind?: ParameterKind;
  /** The Type column: `User` for user parameters, else the constraint's (`Horizontal`, …). */
  readonly type?: string;
  readonly description?: string;
}

export interface ParameterRow {
  readonly name: string;
  readonly expression: string;
  /** Undefined while the parameter has no value: `error` says why. */
  readonly value: number | undefined;
  readonly error?: string;
  readonly kind: ParameterKind;
  readonly type: string;
  readonly description: string;
}

export type ParameterEdit =
  | { readonly ok: true; readonly changed: readonly string[] }
  | { readonly ok: false; readonly error: string };

export type ParameterAdd =
  { readonly ok: true; readonly name: string } | { readonly ok: false; readonly error: string };

interface Entry {
  readonly name: string;
  readonly expression: string;
  readonly kind: ParameterKind;
  readonly type: string;
  readonly description: string;
  readonly parsed: ParsedExpression | undefined;
  readonly parseError: string | undefined;
  value: number | undefined;
  error: string | undefined;
}

const nameError = (name: string): string =>
  `Invalid name "${name}": a letter first, then letters, digits or underscores (at most 256).`;
const missing = (name: string): string => `No parameter named "${name}".`;
const taken = (name: string): string => `A parameter named "${name}" already exists.`;

export class ParameterTable {
  private entries = new Map<string, Entry>();
  /** Every name in evaluation order: each after the parameters its expression names. */
  private order: string[] = [];

  constructor(private readonly options: ExpressionOptions = {}) {}

  /**
   * A table as a drawing stores it, rows with errors kept and shown; a row whose name is
   * invalid or repeats an earlier row's is left out, since no expression could name it.
   */
  static load(
    definitions: readonly ParameterDefinition[],
    options: ExpressionOptions = {},
  ): ParameterTable {
    const table = new ParameterTable(options);
    for (const d of definitions) {
      if (isValidParameterName(d.name) && !table.entries.has(d.name)) {
        table.entries.set(d.name, table.entry(d));
      }
    }
    table.recompute();
    return table;
  }

  /** The rows in the order they were added. */
  rows(): ParameterRow[] {
    return [...this.entries.values()].map(row);
  }

  get(name: string): ParameterRow | undefined {
    const e = this.entries.get(name);
    return e && row(e);
  }

  value(name: string): number | undefined {
    return this.entries.get(name)?.value;
  }

  /** The rows without a value, in the order they were added. */
  errors(): string[] {
    return [...this.entries.values()].filter((e) => e.error !== undefined).map((e) => e.name);
  }

  /** The parameters another parameter's expression names (the "used in expressions" filter). */
  usedInExpressions(): string[] {
    const used = new Set<string>();
    for (const e of this.entries.values()) for (const r of refs(e)) used.add(r);
    return [...this.entries.keys()].filter((n) => used.has(n));
  }

  /** Every parameter whose value follows from `name`'s, in evaluation order. */
  dependents(name: string): string[] {
    const found = new Set<string>([name]);
    for (const n of this.order) {
      const e = this.entries.get(n) as Entry;
      if (refs(e).some((r) => found.has(r))) found.add(n);
    }
    found.delete(name);
    return this.order.filter((n) => found.has(n));
  }

  /** `prefix` and the lowest number from 1 no parameter has: user1, d2, ang1… */
  nextName(prefix: string): string {
    for (let n = 1; ; n++) if (!this.entries.has(`${prefix}${n}`)) return `${prefix}${n}`;
  }

  /** A user parameter as the New User Parameter button makes one: user1 = 1. */
  addUser(): ParameterAdd {
    return this.add({ name: this.nextName('user'), expression: '1' });
  }

  add(definition: ParameterDefinition): ParameterAdd {
    const { name } = definition;
    if (!isValidParameterName(name)) return { ok: false, error: nameError(name) };
    if (this.entries.has(name)) return { ok: false, error: taken(name) };
    const result = this.transact(name, () => {
      this.entries.set(name, this.entry(definition));
    });
    return result.ok ? { ok: true, name } : result;
  }

  /** Sets a parameter's expression; `changed` is it and every parameter that follows from it. */
  setExpression(name: string, expression: string): ParameterEdit {
    const e = this.entries.get(name);
    if (!e) return { ok: false, error: missing(name) };
    return this.transact(name, () => {
      this.entries.set(name, this.entry({ ...e, expression }));
    });
  }

  setDescription(name: string, description: string): { ok: true } | { ok: false; error: string } {
    const e = this.entries.get(name);
    if (!e) return { ok: false, error: missing(name) };
    this.entries.set(name, { ...e, description });
    return { ok: true };
  }

  /** Renames a parameter and every mention of it; `changed` is the rows whose expression did. */
  rename(from: string, to: string): ParameterEdit {
    const e = this.entries.get(from);
    if (!e) return { ok: false, error: missing(from) };
    if (from === to) return { ok: true, changed: [] };
    if (!isValidParameterName(to)) return { ok: false, error: nameError(to) };
    if (this.entries.has(to)) return { ok: false, error: taken(to) };
    const changed: string[] = [];
    const next = new Map<string, Entry>();
    for (const [n, entry] of this.entries) {
      const own = n === from ? { ...entry, name: to } : entry;
      const expression = refs(entry).includes(from)
        ? renameInExpression(entry.expression, from, to, this.options)
        : entry.expression;
      if (expression !== entry.expression) changed.push(own.name);
      next.set(
        own.name,
        expression === entry.expression ? own : this.entry({ ...own, expression }),
      );
    }
    this.entries = next;
    this.recompute();
    return { ok: true, changed: this.order.filter((n) => changed.includes(n)) };
  }

  /**
   * Deletes a parameter. As AutoCAD does, the parameters whose expressions named it keep the
   * values those expressions gave, as constants, so no geometry moves.
   */
  delete(name: string): ParameterEdit {
    if (!this.entries.has(name)) return { ok: false, error: missing(name) };
    const changed: string[] = [];
    for (const e of this.entries.values()) {
      if (e.value !== undefined && refs(e).includes(name)) {
        this.entries.set(e.name, this.entry({ ...e, expression: String(e.value) }));
        changed.push(e.name);
      }
    }
    this.entries.delete(name);
    this.recompute();
    return { ok: true, changed: this.order.filter((n) => changed.includes(n)) };
  }

  private entry(d: ParameterDefinition): Entry {
    const parsed = parseExpression(d.expression, this.options);
    const kind = d.kind ?? 'user';
    return {
      name: d.name,
      expression: d.expression,
      kind,
      type: d.type ?? (kind === 'user' ? 'User' : ''),
      description: d.description ?? '',
      parsed: parsed.ok ? parsed.expression : undefined,
      parseError: parsed.ok ? undefined : parsed.error,
      value: undefined,
      error: undefined,
    };
  }

  /**
   * Applies an edit of `name` and evaluates the table again. The edit stands only when `name`
   * has a value and every row that had one still has: else the table is put back and the edit
   * refused with the first error.
   */
  private transact(name: string, edit: () => void): ParameterEdit {
    const saved = new Map(this.entries);
    const savedOrder = this.order;
    const hadValue = new Set(
      [...saved.values()].filter((e) => e.value !== undefined).map((e) => e.name),
    );
    edit();
    this.recompute();
    const own = this.entries.get(name) as Entry;
    let error = own.error;
    if (error === undefined) {
      const broken = this.order
        .map((n) => this.entries.get(n) as Entry)
        .find((e) => e.error !== undefined && hadValue.has(e.name));
      if (broken) error = `${broken.name}: ${broken.error}`;
    }
    if (error !== undefined) {
      // Entries are replaced, never changed in place, apart from value and error: put those
      // back as they were.
      this.entries = saved;
      this.order = savedOrder;
      this.recompute();
      return { ok: false, error };
    }
    return { ok: true, changed: [name, ...this.dependents(name)] };
  }

  /** Orders the table and evaluates each row after the rows it names. */
  private recompute(): void {
    const entries = this.entries;
    for (const e of entries.values()) {
      e.value = undefined;
      e.error = e.parseError ?? cycleError(entries, e.name);
    }
    const order: string[] = [];
    const done = new Set<string>();
    const visit = (e: Entry): void => {
      if (done.has(e.name)) return;
      done.add(e.name);
      // A row on a cycle already has its error; its references lead back to it.
      if (e.error === undefined) {
        for (const r of refs(e)) {
          const dep = entries.get(r);
          if (dep) visit(dep);
        }
      }
      order.push(e.name);
      if (e.error !== undefined || !e.parsed) return;
      for (const r of refs(e)) {
        const dep = entries.get(r);
        if (!dep) {
          e.error = `Unknown parameter "${r}".`;
          return;
        }
        if (dep.value === undefined) {
          e.error = `${r} has no value.`;
          return;
        }
      }
      const result = e.parsed.evaluate((n) => entries.get(n)?.value);
      if (result.ok) e.value = result.value;
      else e.error = result.error;
    };
    for (const e of entries.values()) visit(e);
    this.order = order;
  }
}

function refs(e: Entry): readonly string[] {
  return e.parsed?.references ?? [];
}

function row(e: Entry): ParameterRow {
  const r = {
    name: e.name,
    expression: e.expression,
    value: e.value,
    kind: e.kind,
    type: e.type,
    description: e.description,
  };
  return e.error === undefined ? r : { ...r, error: e.error };
}

/** `Circular reference: a → c → b → a.` when `name`'s references lead back to it. */
function cycleError(entries: ReadonlyMap<string, Entry>, name: string): string | undefined {
  const seen = new Set<string>();
  const path: string[] = [name];
  const search = (n: string): boolean => {
    const e = entries.get(n);
    if (!e) return false;
    for (const r of refs(e)) {
      if (r === name) {
        path.push(r);
        return true;
      }
      if (seen.has(r)) continue;
      seen.add(r);
      path.push(r);
      if (search(r)) return true;
      path.pop();
    }
    return false;
  };
  return search(name) ? `Circular reference: ${path.join(' → ')}.` : undefined;
}
