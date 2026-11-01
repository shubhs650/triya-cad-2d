// Reader for AutoCAD linetype definition files (.lin), from the published format:
// "About Simple Custom Linetypes", "About Text in Custom Linetypes" and "About Shapes in
// Custom Linetypes" (AutoCAD help). Nothing here comes from an Autodesk .lin file.
//
//   *NAME[,description]
//   A,dash,gap,["text",STYLE,S=.1,R=0,X=-.1,Y=-.05],gap,[SHAPE,file.shx,S=.2],...
//
// A text or shape in brackets belongs to the element before it and is drawn at that
// element's end ("computed from the end of the linetype definition vertex"), which is how
// LTYPE records store it.

import type { EmbedRotation, LinePattern, PatternElement, PatternEmbed } from './pattern';

export interface LinIssue {
  /** 1-based line number in the file. */
  readonly line: number;
  readonly message: string;
}

export interface LinFile {
  readonly linetypes: readonly LinePattern[];
  /** Definitions that could not be read; they are left out of `linetypes`. */
  readonly errors: readonly LinIssue[];
  /** Definitions that were read but break a documented limit. */
  readonly warnings: readonly LinIssue[];
}

/** "A description cannot exceed 47 characters." */
const MAX_DESCRIPTION = 47;

export function parseLin(source: string): LinFile {
  const linetypes: LinePattern[] = [];
  const errors: LinIssue[] = [];
  const warnings: LinIssue[] = [];
  const lines = source.split(/\r?\n/);
  let header: { name: string; description: string; line: number } | undefined;

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    // "You can include comments in a LIN file by beginning the line with a semicolon."
    if (line === '' || line.startsWith(';')) return;
    if (line.startsWith('*')) {
      if (header)
        errors.push({ line: header.line, message: `*${header.name} has no pattern line` });
      const comma = line.indexOf(',');
      const name = (comma < 0 ? line.slice(1) : line.slice(1, comma)).trim();
      const description = comma < 0 ? '' : line.slice(comma + 1).trim();
      if (!name) {
        errors.push({ line: n, message: 'linetype name is empty' });
        header = undefined;
        return;
      }
      if (description.length > MAX_DESCRIPTION) {
        warnings.push({
          line: n,
          message: `description of ${name} exceeds ${MAX_DESCRIPTION} characters`,
        });
      }
      header = { name, description, line: n };
      return;
    }
    if (!header) {
      errors.push({ line: n, message: 'pattern line without a *name line' });
      return;
    }
    const { name, description } = header;
    header = undefined;
    try {
      linetypes.push({ name, description, elements: parsePattern(line) });
    } catch (e) {
      errors.push({ line: n, message: `${name}: ${(e as Error).message}` });
    }
  });
  if (header) errors.push({ line: header.line, message: `*${header.name} has no pattern line` });
  return { linetypes, errors, warnings };
}

function parsePattern(line: string): PatternElement[] {
  const [alignment, ...fields] = splitTopLevel(line, ',');
  // "The program supports only A-type alignment."
  if (alignment?.trim().toUpperCase() !== 'A') {
    throw new Error(`alignment must be A, not "${alignment ?? ''}"`);
  }
  const elements: { length: number; embed?: PatternEmbed }[] = [];
  for (const raw of fields) {
    const f = raw.trim();
    if (f.startsWith('[')) {
      if (!f.endsWith(']')) throw new Error(`unclosed bracket in ${f}`);
      const prev = elements[elements.length - 1];
      if (!prev) throw new Error('a text or shape must follow a dash or gap');
      if (prev.embed) throw new Error('two texts or shapes on one element');
      prev.embed = parseEmbed(f.slice(1, -1));
    } else {
      elements.push({ length: number(f, 'dash length') });
    }
  }
  // "A-type alignment requires that the first dash length be 0 or greater … You must have at
  // least two dash specifications for A-type alignment."
  if (elements.length < 2) throw new Error('needs at least two dash specifications');
  if (elements[0]!.length < 0) throw new Error('the first dash must be 0 or greater');
  return elements;
}

function parseEmbed(body: string): PatternEmbed {
  const fields = splitTopLevel(body, ',').map((s) => s.trim());
  const first = fields.shift() ?? '';
  const isText = first.startsWith('"');
  if (isText && !(first.length >= 2 && first.endsWith('"'))) {
    throw new Error(`unclosed text string ${first}`);
  }
  if (!first) throw new Error('a shape needs a shape name');
  // Text: the style is optional ("If no text style is specified, the currently defined style
  // is used"). Shape: name and file are both mandatory and positional.
  let style: string | undefined;
  if (fields[0] !== undefined && !/^[A-Za-z]\s*=/.test(fields[0])) style = fields.shift();
  if (!isText && !style) throw new Error(`shape ${first} needs a shape file`);

  let scale = 1;
  let rotation = 0;
  let rotationMode: EmbedRotation = 'relative';
  let x = 0;
  let y = 0;
  for (const f of fields) {
    const m = /^([A-Za-z])\s*=\s*(.*)$/.exec(f);
    if (!m) throw new Error(`expected KEY=value, got "${f}"`);
    const key = m[1]!.toUpperCase();
    const value = m[2]!;
    if (key === 'S') scale = number(value, 'S');
    else if (key === 'X') x = number(value, 'X');
    else if (key === 'Y') y = number(value, 'Y');
    else if (key === 'R' || key === 'A' || key === 'U') {
      rotation = angle(value);
      rotationMode = key === 'R' ? 'relative' : key === 'A' ? 'absolute' : 'upright';
    } else throw new Error(`unknown key ${key}=`);
  }
  return {
    kind: isText ? 'text' : 'shape',
    ...(isText ? { text: first.slice(1, -1) } : { shapeName: first }),
    ...(style !== undefined ? { style } : {}),
    scale,
    rotation,
    rotationMode,
    offset: { x, y },
  };
}

/** Degrees by default; a `d`, `r` or `g` suffix gives degrees, radians or grads. */
function angle(s: string): number {
  const m = /^(.*?)([dDrRgG]?)$/.exec(s.trim())!;
  const v = number(m[1]!, 'rotation');
  const unit = m[2]!.toLowerCase();
  return unit === 'r' ? v : unit === 'g' ? (v * Math.PI) / 200 : (v * Math.PI) / 180;
}

function number(s: string, what: string): number {
  const t = s.trim();
  // .lin values are plain decimals such as `.5`, `-.25` or `1.0e-1`.
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    throw new Error(`${what} "${s}" is not a number`);
  }
  return Number(t);
}

/** Splits on `sep` outside brackets and double quotes. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '[') depth++;
    else if (!quoted && c === ']') depth--;
    else if (!quoted && depth === 0 && c === sep) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}
