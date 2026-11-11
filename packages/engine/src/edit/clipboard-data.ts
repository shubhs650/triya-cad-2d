// The Clipboard on the system clipboard (M2-32 part 5). COPYCLIP's objects reach other Triya
// windows through the system clipboard, as AutoCAD's reach another AutoCAD session through the
// Windows clipboard: the app writes this text under its own clipboard format beside a picture
// of the objects (what other apps paste), and a paste in another window reads it back.
//
// The text is JSON with the values JSON cannot hold written as tagged objects, so it reads back
// as the structured clone between two drawings of one window does: undefined fields, −0 and the
// non-finite numbers, bigints (xdata 1071), byte arrays (xdata 1004), Maps and Sets. It says its
// version, and a window reads only its own version: a Clipboard from another version of Triya
// pastes nothing rather than something wrong.
//
// It is not a file format: nothing saves it, and only Triya reads it.
import type { Clipboard } from './clipboard';

/** The version of the text `clipboardData` writes; another version is not read. */
export const CLIPBOARD_DATA_VERSION = 1;

/** The key a tagged value is written under; an object that has it itself is tagged too. */
const TAG = '$t';

type Tagged =
  | { $t: 'u' }
  | { $t: 'n'; v: string }
  | { $t: 'b'; v: string }
  | { $t: 'a'; c: string; v: string | number[] }
  | { $t: 'm'; v: unknown[] }
  | { $t: 's'; v: unknown[] }
  | { $t: 'o'; v: Record<string, unknown> };

interface Envelope {
  readonly triya: 'clipboard';
  readonly version: number;
  /** The window that wrote it: a window reading its own Clipboard back keeps its own. */
  readonly source: string;
  readonly clipboard: unknown;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? B64[n & 63]! : '=';
  }
  return out;
}

function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++)
      n = (n << 6) | (i + j < clean.length ? B64.indexOf(clean[i + j]!) : 0);
    out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** The typed arrays a value may hold, by constructor name. */
const ARRAYS: Readonly<Record<string, new (values: number[]) => ArrayLike<number>>> = {
  Int8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
};

function encode(value: unknown): unknown {
  if (value === undefined) return { [TAG]: 'u' };
  if (typeof value === 'bigint') return { [TAG]: 'b', v: value.toString() };
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0)
      ? value
      : { [TAG]: 'n', v: String(value === 0 ? '-0' : value) };
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(encode);
  if (value instanceof Uint8Array) return { [TAG]: 'a', c: 'Uint8Array', v: base64(value) };
  if (ArrayBuffer.isView(value)) {
    const name = value.constructor.name;
    if (!(name in ARRAYS)) throw new Error(`The Clipboard cannot hold a ${name}.`);
    return {
      [TAG]: 'a',
      c: name,
      v: Array.from(value as unknown as ArrayLike<number>, (n) => encode(n)),
    };
  }
  if (value instanceof Map)
    return { [TAG]: 'm', v: [...value].map(([k, v]) => [encode(k), encode(v)]) };
  if (value instanceof Set) return { [TAG]: 's', v: [...value].map(encode) };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = encode(v);
  return TAG in out ? { [TAG]: 'o', v: out } : out;
}

function decodeFields(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = decode(v);
  return out;
}

function decode(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  const o = value as Record<string, unknown>;
  if (!(TAG in o)) return decodeFields(o);
  const t = o as Tagged;
  switch (t.$t) {
    case 'u':
      return undefined;
    case 'n':
      return t.v === '-0' ? -0 : Number(t.v);
    case 'b':
      return BigInt(t.v);
    case 'a': {
      if (t.c === 'Uint8Array') return fromBase64(t.v as string);
      const make = ARRAYS[t.c];
      if (!make) throw new Error(`Unknown array ${t.c}`);
      return new make((t.v as unknown[]).map((n) => decode(n) as number));
    }
    case 'm':
      return new Map((t.v as [unknown, unknown][]).map(([k, v]) => [decode(k), decode(v)]));
    case 's':
      return new Set(t.v.map(decode));
    case 'o':
      return decodeFields(t.v);
  }
  throw new Error('Unknown tag');
}

/** The Clipboard as the text the system clipboard carries; `source` names the window. */
export function clipboardData(clipboard: Clipboard, source: string): string {
  const envelope: Envelope = {
    triya: 'clipboard',
    version: CLIPBOARD_DATA_VERSION,
    source,
    clipboard: encode(clipboard),
  };
  return JSON.stringify(envelope);
}

/**
 * The Clipboard a `clipboardData` text holds and the window that wrote it, or undefined when the
 * text is not one (another app's, or another version of Triya's).
 */
export function readClipboardData(
  text: string,
): { readonly clipboard: Clipboard; readonly source: string } | undefined {
  let envelope: Partial<Envelope>;
  try {
    envelope = JSON.parse(text) as Partial<Envelope>;
  } catch {
    return undefined;
  }
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    envelope.triya !== 'clipboard' ||
    envelope.version !== CLIPBOARD_DATA_VERSION ||
    typeof envelope.source !== 'string'
  ) {
    return undefined;
  }
  try {
    const clipboard = decode(envelope.clipboard) as Clipboard;
    if (!clipboard || !Array.isArray(clipboard.entities)) return undefined;
    return { clipboard, source: envelope.source };
  } catch {
    return undefined;
  }
}

/**
 * Plain text as MTEXT contents (DXF 1 and 3), as AutoCAD's PASTECLIP pastes another app's text
 * as multiline text: the code characters escaped, each line a paragraph (`\P`), a tab `^I`, a
 * caret `^ ` (the rules `@triya/text` writes its spans by). The line breaks the text ends with
 * are left out, as a copied line usually carries one.
 */
export function mtextLiteral(text: string): string {
  let out = '';
  for (const c of text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')) {
    if (c === '\\' || c === '{' || c === '}') out += `\\${c}`;
    else if (c === '^') out += '^ ';
    else if (c === '\t') out += '^I';
    else if (c === '\n') out += '\\P';
    else out += c;
  }
  return out;
}
