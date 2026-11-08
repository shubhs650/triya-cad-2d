// Hand-written ACIS models for the REGION tests: a square with a bulged top and a round hole,
// as SAT text and as SAB binary (acis-region.test.ts, acis-transform.test.ts,
// export-region.test.ts).

export type Rec = [name: string, type: string, body: string];

/**
 * A 10 × 10 square at the origin whose top edge bulges up as a half circle, with a round
 * hole, moved by (100, 200, 5). `$name` refers to another record. Save version 21500 (R2010).
 */
export function square(curves: Partial<Record<'top' | 'hole' | 'plane', string>> = {}): Rec[] {
  return [
    ['hdr', 'asmheader', '@13 230.7.0.65535'],
    ['body', 'body', '$lump $-1 $xf'],
    ['lump', 'lump', '$-1 $shell $body'],
    ['xf', 'transform', '1 0 0 0 1 0 0 0 1 100 200 5 1 no_rotate no_reflect no_shear'],
    ['shell', 'shell', '$-1 $-1 $face $-1 $lump'],
    ['face', 'face', '$-1 $outer $shell $-1 $plane forward single out'],
    ['plane', 'plane-surface', curves.plane ?? '0 0 0 0 0 1 1 0 0 forward_v I I I I'],
    ['outer', 'loop', '$inner $c1 $face'],
    ['c1', 'coedge', '$c2 $c4 $-1 $e1 forward $outer $-1'],
    ['c2', 'coedge', '$c3 $c1 $-1 $e2 forward $outer $-1'],
    ['c3', 'coedge', '$c4 $c2 $-1 $e3 forward $outer $-1'],
    ['c4', 'coedge', '$c1 $c3 $-1 $e4 forward $outer $-1'],
    ['e1', 'edge', '$va 0 $vb 10 $c1 $k1 forward @7 unknown'],
    ['e2', 'edge', '$vb 0 $vc 10 $c2 $k2 forward @7 unknown'],
    ['e3', 'edge', '$vc 0 $vd 3.14 $c3 $k3 forward @7 unknown'],
    ['e4', 'edge', '$vd 0 $va 10 $c4 $k4 forward @7 unknown'],
    ['k1', 'straight-curve', '0 0 0 1 0 0 I I'],
    ['k2', 'straight-curve', '10 0 0 0 1 0 I I'],
    ['k3', 'ellipse-curve', curves.top ?? '5 10 0 0 0 1 5 0 0 1 I I'],
    ['k4', 'straight-curve', '0 10 0 0 -1 0 I I'],
    ['va', 'vertex', '$e1 0 $pa'],
    ['vb', 'vertex', '$e2 0 $pb'],
    ['vc', 'vertex', '$e3 0 $pc'],
    ['vd', 'vertex', '$e4 0 $pd'],
    ['pa', 'point', '0 0 0'],
    ['pb', 'point', '10 0 0'],
    ['pc', 'point', '10 10 0'],
    ['pd', 'point', '0 10 0'],
    ['inner', 'loop', '$-1 $h $face'],
    ['h', 'coedge', '$h $h $-1 $he reversed $inner $-1'],
    ['he', 'edge', '$hv 0 $hv 6.28 $h $hk forward @7 unknown'],
    ['hk', 'ellipse-curve', curves.hole ?? '3 4 0 0 0 1 1 0 0 1 I I'],
    ['hv', 'vertex', '$he 0 $hp'],
    ['hp', 'point', '4 4 0'],
  ];
}

/** The 7.0 header: attribute, history id, and for all but transform and asmheader one more pointer. */
const head = (type: string) =>
  type === 'transform' || type === 'asmheader' ? '$-1 -1' : '$-1 -1 $-1';

/** SAT text: each record is `type header body #`. */
export function sat(recs: Rec[]): string {
  const index = new Map(recs.map(([n], i) => [n, i]));
  const ref = (s: string) => s.replace(/\$([a-z]\w*)/g, (_, n: string) => `$${index.get(n)}`);
  return [
    '21500 43 2 24',
    '16 Autodesk AutoCAD 20 ASM 230.7.0.65535 NT 0',
    '25.4 9.9999999999999995e-07 1e-10',
    ...recs.map(([, type, body]) => `${type} ${head(type)} ${ref(body)} #`),
    'End-of-ASM-data',
  ].join('\n');
}

const FLAGS = new Set(['rotate', 'no_rotate', 'reflect', 'no_reflect', 'shear', 'no_shear']);

/** The same records as SAB, tag by tag (see records.ts). */
export function sab(recs: Rec[]): Uint8Array {
  const index = new Map(recs.map(([n], i) => [n, i]));
  const out: number[] = [];
  const i32 = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, true);
    out.push(...b);
  };
  /** A double, with its tag. */
  const f64 = (v: number) => {
    out.push(6);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    out.push(...b);
  };
  const text = (tag: number, s: string) =>
    out.push(tag, s.length, ...[...s].map((c) => c.charCodeAt(0)));
  out.push(...[...'ACIS BinaryFile'].map((c) => c.charCodeAt(0)));
  [21800, 0, 2, 12].forEach(i32);
  text(7, 'Autodesk AutoCAD');
  text(7, 'ASM 230.7.0.65535 NT');
  text(7, 'Tue Dec  2 10:27:19 2025');
  for (const d of [25.4, 1e-6, 1e-10]) f64(d);
  for (const [, type, body] of recs) {
    const parts = type.split('-');
    parts.slice(0, -1).forEach((p) => text(14, p));
    text(13, parts[parts.length - 1]!);
    const tokens = [...head(type).split(' '), ...body.match(/@\d+ \S+|\S+/g)!];
    if (type === 'transform') {
      // AutoCAD writes a transform's three matrix rows and its translation as vectors (tag 20).
      const [attribute, history, ...rest] = tokens;
      out.push(12);
      i32(attribute === '$-1' ? -1 : 0);
      f64(Number(history));
      for (let v = 0; v < 4; v++) {
        out.push(20);
        for (const n of rest.slice(3 * v, 3 * v + 3)) {
          const b = new Uint8Array(8);
          new DataView(b.buffer).setFloat64(0, Number(n), true);
          out.push(...b);
        }
      }
      tokens.splice(0, tokens.length, ...rest.slice(12));
    }
    for (const t of tokens) {
      if (t.startsWith('$')) {
        out.push(12);
        i32(t === '$-1' ? -1 : index.get(t.slice(1))!);
      } else if (t.startsWith('@')) text(7, t.split(' ')[1]!);
      else if (t === 'forward' || t === 'reversed') out.push(t === 'reversed' ? 10 : 11);
      // A transform's flags are logicals too: AutoCAD writes `11 11 11` for no_rotate ….
      else if (FLAGS.has(t)) out.push(t.startsWith('no_') ? 11 : 10);
      else if (/^-?[\d.]+(e-?\d+)?$/.test(t)) f64(Number(t));
      else text(7, t);
    }
    out.push(17);
  }
  return new Uint8Array(out);
}
