// Expressions of dimensional constraints and user parameters (M9-03, ARCHITECTURE.md §11): a
// small safe parser, never `eval`. The operators, functions and constants are AutoCAD 2024's
// (Help, "About Controlling Geometry With the Parameters Manager"):
//   + - % * / ^ ( ), evaluated innermost parentheses first, then unary negation, exponents,
//   multiplication / division / modulo, addition / subtraction, equal precedence left to right
//   (so -2^2 is 4 and 2^3^2 is 64, as that order says);
//   cos sin tan acos asin atan cosh sinh tanh acosh asinh atanh sqrt sign round trunc floor ceil
//   abs max min d2r r2d ln log exp exp10 pow random; the constants pi and e.
// Ambiguities the Help leaves open, decided for the common drafter expectation:
// - Trigonometric functions take and return degrees: angular constraint parameters hold
//   degrees (ang1 = 30), so sin(ang1) must mean the sine of 30°. d2r and r2d convert values
//   written in radians.
// - Two-argument functions separate their arguments with `;` as the Help writes them; `,` is
//   accepted too (the decimal separator is always `.`).
// - Function and constant names are read in any case (the Help writes `Random`, `pi` and `PI`);
//   parameter names are case sensitive, and a name a function or constant has is refused.
// - `random` takes no argument; `random()` reads the same.
// - In Engineering and Architectural units (LUNITS 3, 4) a number may carry a foot or an inch
//   mark: `5'-9"` is 69 inches (the dash with no space parts feet from inches), `5' -9"` is
//   51 (a space beside the minus makes it a subtraction, the Help's own example).

/** How to read the numbers: LUNITS (feet and inch marks in 3 and 4), and the `random` source. */
export interface ExpressionOptions {
  readonly lunits?: number;
  readonly random?: () => number;
}

export type ExpressionResult =
  { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: string };

/** The value of a named parameter, or undefined when no parameter has the name. */
export type ParameterLookup = (name: string) => number | undefined;

export interface ParsedExpression {
  readonly text: string;
  /** The parameters the expression names, once each, in the order they first appear. */
  readonly references: readonly string[];
  evaluate(lookup: ParameterLookup): ExpressionResult;
}

export type ParseResult =
  | { readonly ok: true; readonly expression: ParsedExpression }
  | { readonly ok: false; readonly error: string; readonly at: number };

/** AutoCAD keeps expression values within -1e100 to 1e100. */
const LIMIT = 1e100;
const RAD = Math.PI / 180;

interface FunctionDef {
  readonly arity: number;
  readonly fn: (...args: number[]) => number;
}

const FUNCTIONS: Readonly<Record<string, FunctionDef>> = {
  cos: { arity: 1, fn: (x) => Math.cos(x * RAD) },
  sin: { arity: 1, fn: (x) => Math.sin(x * RAD) },
  tan: { arity: 1, fn: (x) => Math.tan(x * RAD) },
  acos: { arity: 1, fn: (x) => Math.acos(x) / RAD },
  asin: { arity: 1, fn: (x) => Math.asin(x) / RAD },
  atan: { arity: 1, fn: (x) => Math.atan(x) / RAD },
  cosh: { arity: 1, fn: Math.cosh },
  sinh: { arity: 1, fn: Math.sinh },
  tanh: { arity: 1, fn: Math.tanh },
  acosh: { arity: 1, fn: Math.acosh },
  asinh: { arity: 1, fn: Math.asinh },
  // Infinite at ±1 and at 0 below, where the function has no value: not a real number.
  atanh: { arity: 1, fn: (x) => (Math.abs(x) < 1 ? Math.atanh(x) : Number.NaN) },
  sqrt: { arity: 1, fn: Math.sqrt },
  sign: { arity: 1, fn: (x) => Math.sign(x) },
  // To the nearest integer, halves away from zero (Math.round takes -2.5 to -2).
  round: { arity: 1, fn: (x) => Math.sign(x) * Math.round(Math.abs(x)) },
  trunc: { arity: 1, fn: Math.trunc },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  abs: { arity: 1, fn: Math.abs },
  max: { arity: 2, fn: (a, b) => Math.max(a, b) },
  min: { arity: 2, fn: (a, b) => Math.min(a, b) },
  d2r: { arity: 1, fn: (x) => x * RAD },
  r2d: { arity: 1, fn: (x) => x / RAD },
  ln: { arity: 1, fn: (x) => (x > 0 ? Math.log(x) : Number.NaN) },
  log: { arity: 1, fn: (x) => (x > 0 ? Math.log10(x) : Number.NaN) },
  exp: { arity: 1, fn: Math.exp },
  exp10: { arity: 1, fn: (x) => 10 ** x },
  pow: { arity: 2, fn: (a, b) => a ** b },
  // `random` is bound to the options' source when parsed.
  random: { arity: 0, fn: () => 0 },
};

const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,255}$/;

/**
 * Whether a parameter may have the name (Help, "Parameters Manager (Drawing)": alphanumeric,
 * not starting with a number, no spaces, at most 256 characters). The underscore is allowed after
 * the first letter (AutoCAD's own names are letters and digits; `Wall_Height` reads the same in
 * any expression). A function's or a constant's name would be read as the function or constant.
 */
export function isValidParameterName(name: string): boolean {
  const lower = name.toLowerCase();
  return NAME.test(name) && !(lower in FUNCTIONS) && !(lower in CONSTANTS);
}

type TokenKind = 'num' | 'name' | 'op' | 'end';

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly at: number;
  readonly value: number;
}

class ExpressionError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

const NUMBER = /\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?/y;
const IDENT = /[A-Za-z][A-Za-z0-9_]*/y;
const OPERATORS = '+-*/%^();,';

function matchAt(re: RegExp, text: string, at: number): string | undefined {
  re.lastIndex = at;
  return re.exec(text)?.[0];
}

function isDigitAt(text: string, at: number): boolean {
  return matchAt(NUMBER, text, at) !== undefined;
}

function tokenize(text: string, lunits: number): Token[] {
  const imperial = lunits === 3 || lunits === 4;
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = matchAt(NUMBER, text, i);
    if (num !== undefined) {
      const start = i;
      let value = Number(num);
      i += num.length;
      if (imperial && text[i] === "'") {
        // Feet, then inches written straight after or after a dash with no space (`5'-9"`).
        value *= 12;
        i++;
        const dash = text[i] === '-' && isDigitAt(text, i + 1) ? 1 : 0;
        const inches = matchAt(NUMBER, text, i + dash);
        if (inches !== undefined) {
          value += Number(inches);
          i += dash + inches.length;
          if (text[i] === '"') i++;
        }
      } else if (imperial && text[i] === '"') {
        i++;
      }
      tokens.push({ kind: 'num', text: text.slice(start, i), at: start, value });
      continue;
    }
    const ident = matchAt(IDENT, text, i);
    if (ident !== undefined) {
      tokens.push({ kind: 'name', text: ident, at: i, value: 0 });
      i += ident.length;
      continue;
    }
    if (OPERATORS.includes(ch)) {
      tokens.push({ kind: 'op', text: ch, at: i, value: 0 });
      i++;
      continue;
    }
    throw new ExpressionError(`Unexpected "${ch}".`, i);
  }
  tokens.push({ kind: 'end', text: '', at: text.length, value: 0 });
  return tokens;
}

/** A node of the parsed expression: its value, or an error thrown as an `EvaluationError`. */
type Node = (lookup: ParameterLookup) => number;

class EvaluationError extends Error {}

function checked(v: number): number {
  if (Number.isNaN(v)) throw new EvaluationError('The result is not a real number.');
  if (!Number.isFinite(v)) throw new EvaluationError(OUT_OF_RANGE);
  return v;
}

const OUT_OF_RANGE = 'The value is out of range (-1e100 to 1e100).';

interface Reference {
  readonly name: string;
  readonly at: number;
}

class Parser {
  private i = 0;
  readonly references: Reference[] = [];

  constructor(
    private readonly tokens: readonly Token[],
    private readonly random: () => number,
  ) {}

  parse(): Node {
    const node = this.expr();
    const t = this.peek();
    if (t.kind !== 'end') throw this.unexpected(t);
    return node;
  }

  private peek(): Token {
    return this.tokens[this.i] as Token;
  }

  private isOp(...ops: string[]): boolean {
    const t = this.peek();
    return t.kind === 'op' && ops.includes(t.text);
  }

  private unexpected(t: Token): ExpressionError {
    return t.kind === 'end'
      ? new ExpressionError('The expression ends early.', t.at)
      : new ExpressionError(`Unexpected "${t.text}".`, t.at);
  }

  private expect(op: string): void {
    const t = this.peek();
    if (t.kind === 'op' && t.text === op) {
      this.i++;
      return;
    }
    throw new ExpressionError(`"${op}" expected.`, t.at);
  }

  private expr(): Node {
    let left = this.term();
    while (this.isOp('+', '-')) {
      const op = this.tokens[this.i++]?.text;
      const l = left;
      const r = this.term();
      left = op === '+' ? (k) => checked(l(k) + r(k)) : (k) => checked(l(k) - r(k));
    }
    return left;
  }

  private term(): Node {
    let left = this.power();
    while (this.isOp('*', '/', '%')) {
      const op = this.tokens[this.i++]?.text;
      const l = left;
      const r = this.power();
      left =
        op === '*'
          ? (k) => checked(l(k) * r(k))
          : (k) => {
              const a = l(k);
              const b = r(k);
              if (b === 0) throw new EvaluationError('Division by zero.');
              // `%` is the floating point modulo, keeping the dividend's sign as C's fmod does.
              return checked(op === '/' ? a / b : a % b);
            };
    }
    return left;
  }

  private power(): Node {
    let left = this.unary();
    while (this.isOp('^')) {
      this.i++;
      const l = left;
      const r = this.unary();
      left = (k) => checked(l(k) ** r(k));
    }
    return left;
  }

  private unary(): Node {
    if (this.isOp('+', '-')) {
      const op = this.tokens[this.i++]?.text;
      const v = this.unary();
      return op === '-' ? (k) => -v(k) : v;
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.peek();
    if (t.kind === 'num') {
      this.i++;
      const v = t.value;
      return () => checked(v);
    }
    if (t.kind === 'op' && t.text === '(') {
      this.i++;
      const v = this.expr();
      this.expect(')');
      return v;
    }
    if (t.kind === 'name') return this.name(t);
    throw this.unexpected(t);
  }

  private name(t: Token): Node {
    this.i++;
    const lower = t.text.toLowerCase();
    const def = FUNCTIONS[lower];
    const call = this.isOp('(');
    if (def) return this.call(lower, def, call, t.at);
    const constant = CONSTANTS[lower];
    if (constant !== undefined && !call) return () => constant;
    if (call) throw new ExpressionError(`Unknown function "${t.text}".`, t.at);
    const name = t.text;
    this.references.push({ name, at: t.at });
    return (lookup) => {
      const v = lookup(name);
      if (v === undefined) throw new EvaluationError(`Unknown parameter "${name}".`);
      return v;
    };
  }

  private call(name: string, def: FunctionDef, call: boolean, at: number): Node {
    const args: Node[] = [];
    if (call) {
      this.i++;
      if (!this.isOp(')')) {
        args.push(this.expr());
        while (this.isOp(';', ',')) {
          this.i++;
          args.push(this.expr());
        }
      }
      this.expect(')');
    } else if (def.arity !== 0) {
      throw new ExpressionError('"(" expected.', this.peek().at);
    }
    if (args.length !== def.arity) {
      const takes =
        def.arity === 0 ? 'no arguments' : `${def.arity} argument${def.arity === 1 ? '' : 's'}`;
      throw new ExpressionError(`${name} takes ${takes}.`, at);
    }
    if (name === 'random') {
      const random = this.random;
      return () => random();
    }
    const [a, b] = args as [Node, Node];
    return def.arity === 1 ? (k) => checked(def.fn(a(k))) : (k) => checked(def.fn(a(k), b(k)));
  }
}

interface Parsed {
  readonly node: Node;
  readonly references: readonly Reference[];
}

function parseNode(text: string, options: ExpressionOptions): Parsed {
  if (text.trim() === '') throw new ExpressionError('The expression is empty.', 0);
  const parser = new Parser(tokenize(text, options.lunits ?? 2), options.random ?? Math.random);
  const node = parser.parse();
  return { node, references: parser.references };
}

/** Parses an expression once, to evaluate it as often as its parameters change. */
export function parseExpression(text: string, options: ExpressionOptions = {}): ParseResult {
  let parsed: Parsed;
  try {
    parsed = parseNode(text, options);
  } catch (e) {
    if (e instanceof ExpressionError) return { ok: false, error: e.message, at: e.at };
    throw e;
  }
  const { node } = parsed;
  const references = [...new Set(parsed.references.map((r) => r.name))];
  return {
    ok: true,
    expression: {
      text,
      references,
      evaluate(lookup: ParameterLookup): ExpressionResult {
        try {
          const value = node(lookup);
          if (Math.abs(value) > LIMIT) return { ok: false, error: OUT_OF_RANGE };
          return { ok: true, value };
        } catch (e) {
          if (e instanceof EvaluationError) return { ok: false, error: e.message };
          throw e;
        }
      },
    },
  };
}

/** The value of an expression, or what is wrong with it. */
export function evaluateExpression(
  text: string,
  lookup: ParameterLookup,
  options: ExpressionOptions = {},
): ExpressionResult {
  const parsed = parseExpression(text, options);
  return parsed.ok ? parsed.expression.evaluate(lookup) : { ok: false, error: parsed.error };
}

/** The parameters an expression names, once each in order; none when it does not parse. */
export function expressionReferences(text: string, options: ExpressionOptions = {}): string[] {
  const parsed = parseExpression(text, options);
  return parsed.ok ? [...parsed.expression.references] : [];
}

/**
 * The expression with the parameter `from` named `to`, the rest kept as typed (renaming a
 * parameter updates every expression that names it). Unchanged when it does not parse.
 */
export function renameInExpression(
  text: string,
  from: string,
  to: string,
  options: ExpressionOptions = {},
): string {
  let parsed: Parsed;
  try {
    parsed = parseNode(text, options);
  } catch (e) {
    if (e instanceof ExpressionError) return text;
    throw e;
  }
  let out = text;
  const hits = parsed.references.filter((r) => r.name === from);
  for (const r of hits.reverse()) out = out.slice(0, r.at) + to + out.slice(r.at + from.length);
  return out;
}
