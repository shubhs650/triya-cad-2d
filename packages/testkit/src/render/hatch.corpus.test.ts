// M1-16 on the public corpus: every pattern hatch generates its lines (none is denser than
// HPMAXLINES), and every dash it draws lies in the hatched area. The area is tested point by
// point with a ray cast to +x against the flattened loops, counting the loops around the dash's
// midpoint, independently of the line sweep `hatchPattern` uses.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gradientRamp, hatchPattern, loopSegments, patternLines } from '@triya/hatch';
import { mapEntities, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

/**
 * How many loops contain (x, y): each loop's crossings of a ray from the point, by parity. The
 * ray leaves at an odd angle so it does not run along pattern lines or through the vertices of
 * loops that meet at round coordinates.
 */
const RAY = 0.3183098861837907;
function depth(loops: readonly (readonly number[])[], x: number, y: number): number {
  const c = Math.cos(RAY);
  const s = Math.sin(RAY);
  // In a frame turned by −RAY the ray runs along +x.
  const v = (px: number, py: number) => -(px - x) * s + (py - y) * c;
  const u = (px: number, py: number) => (px - x) * c + (py - y) * s;
  let k = 0;
  for (const seg of loops) {
    let inside = false;
    for (let i = 0; i < seg.length; i += 4) {
      const v1 = v(seg[i]!, seg[i + 1]!);
      const v2 = v(seg[i + 2]!, seg[i + 3]!);
      if (v1 > 0 === v2 > 0) continue;
      const u1 = u(seg[i]!, seg[i + 1]!);
      const u2 = u(seg[i + 2]!, seg[i + 3]!);
      if (u1 + (-v1 / (v2 - v1)) * (u2 - u1) > 0) inside = !inside;
    }
    if (inside) k++;
  }
  return k;
}

/** Whether (x, y) is within `eps` of a loop segment: on the boundary, so in or out by choice. */
function onBoundary(loops: readonly (readonly number[])[], x: number, y: number, eps: number) {
  for (const seg of loops) {
    for (let i = 0; i < seg.length; i += 4) {
      const [x1, y1, x2, y2] = [seg[i]!, seg[i + 1]!, seg[i + 2]!, seg[i + 3]!];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const t = Math.max(
        0,
        Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)),
      );
      if (Math.hypot(x1 + t * dx - x, y1 + t * dy - y) <= eps) return true;
    }
  }
  return false;
}

const hatched = (style: number, k: number) =>
  style === 1 ? k === 1 : style === 2 ? k >= 1 : k % 2 === 1;

describe('pattern hatches on the public corpus (M1-16)', () => {
  const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

  it('generates every pattern hatch, with every dash inside the hatched area', () => {
    const wrong: string[] = [];
    let hatches = 0;
    let drawing = 0;
    let dashes = 0;
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue; // read failures are the round-trip suite's concern
      }
      for (const e of mapEntities(doc).entities) {
        const g = e.geom;
        if (g.kind !== 'HATCH' || g.solid || g.gradient) continue;
        const where = `${f.path} HATCH ${e.handle} ${g.pattern}`;
        const r = hatchPattern(g);
        if (r.kind !== 'lines') {
          wrong.push(`${where}: ${r.kind} (${r.lines} lines)`);
          continue;
        }
        hatches++;
        // A hatch can rightly draw nothing: in transform_hatch_pattern.dxf the stored lines are
        // 50.8 apart across a 10 × 10 boundary, so none crosses it.
        if (r.families.length > 0) drawing++;
        const loops = g.loops.map(loopSegments);
        const s = r.families.flatMap((fam) => fam.segments);
        for (let i = 0; i < s.length; i += 4) {
          dashes++;
          const mx = (s[i]! + s[i + 2]!) / 2;
          const my = (s[i + 1]! + s[i + 3]!) / 2;
          // A pattern line along a boundary edge (transform_hatch_pattern.dxf) is on the edge.
          const eps = 1e-9 * Math.max(1, Math.abs(mx), Math.abs(my));
          if (!hatched(g.style, depth(loops, mx, my)) && !onBoundary(loops, mx, my, eps)) {
            wrong.push(`${where}: dash at (${mx}, ${my}) outside the hatched area`);
            break;
          }
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    // Counts at M1-16 part 1; raise them when corpus files are added.
    expect(hatches).toBeGreaterThanOrEqual(140);
    expect(drawing).toBeGreaterThanOrEqual(133);
    expect(dashes).toBeGreaterThan(20_000);
  });

  it('fits every gradient’s ramp to its boundary (M1-16 part 2)', () => {
    // Centred ramps (shift 0) run over the boundary exactly: a linear ramp from 0 at its
    // first point across to 1 at its last, and a radial one out to 1 at its farthest point.
    const wrong: string[] = [];
    let gradients = 0;
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue;
      }
      for (const e of mapEntities(doc).entities) {
        const g = e.geom;
        if (g.kind !== 'HATCH' || !g.gradient) continue;
        const where = `${f.path} HATCH ${e.handle} ${g.gradient.name}`;
        const ramp = gradientRamp({ loops: g.loops, gradient: g.gradient });
        if (!ramp) {
          wrong.push(`${where}: no ramp`);
          continue;
        }
        gradients++;
        const { a, b, c, d, e: tx, f: ty } = ramp.frame;
        const det = a * d - b * c;
        let lo = Infinity;
        let hi = -Infinity;
        for (const seg of g.loops.map(loopSegments)) {
          for (let i = 0; i < seg.length; i += 2) {
            // World → the unit frame.
            const x = seg[i]! - tx;
            const y = seg[i + 1]! - ty;
            const u = (d * x - c * y) / det;
            const v = (-b * x + a * y) / det;
            const t = ramp.kind === 'linear' ? u : Math.hypot(u, v);
            lo = Math.min(lo, t);
            hi = Math.max(hi, t);
          }
        }
        if (g.gradient.shift === 0) {
          if (ramp.kind === 'linear' && (Math.abs(lo) > 1e-9 || Math.abs(hi - 1) > 1e-9))
            wrong.push(`${where}: linear ramp spans ${lo}..${hi}`);
          if (ramp.kind === 'radial' && hi > 1 + 1e-9)
            wrong.push(`${where}: radial ramp reaches ${hi}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // 15 drawings × LINEAR and SPHERICAL (acadsharp samples) at M1-16 part 2.
    expect(gradients).toBeGreaterThanOrEqual(30);
  });

  it('places a pattern at a hatch’s angle and scale as AutoCAD stored it (M1-16 part 3)', () => {
    // ANSI31, general-purpose section lining: 45° lines 1/8 in apart (3.175 mm in a metric
    // drawing). Written here from that geometry, then placed at each corpus ANSI31 hatch's
    // stored angle and scale, it must give the line the file stores.
    const def = (spacing: number) => ({
      name: 'ANSI31',
      description: '',
      lines: [{ angle: 45, origin: { x: 0, y: 0 }, delta: { x: 0, y: spacing }, dashes: [] }],
    });
    const TURN = 2 * Math.PI;
    const wrong: string[] = [];
    let checked = 0;
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue;
      }
      for (const e of mapEntities(doc).entities) {
        const g = e.geom;
        if (g.kind !== 'HATCH' || g.pattern !== 'ANSI31' || g.patternLines.length !== 1) continue;
        checked++;
        const stored = g.patternLines[0]!;
        const fits = [0.125, 3.175].some((spacing) => {
          const [l] = patternLines(def(spacing), { angle: g.patternAngle, scale: g.patternScale });
          const da = Math.abs(((l!.angle - stored.angle) % TURN) + TURN) % TURN;
          const eps = 1e-9 * Math.max(1, Math.hypot(stored.offset.x, stored.offset.y));
          return (
            Math.min(da, TURN - da) < 1e-9 &&
            Math.abs(l!.offset.x - stored.offset.x) < eps &&
            Math.abs(l!.offset.y - stored.offset.y) < eps &&
            stored.dashes.length === 0
          );
        });
        if (!fits) wrong.push(`${f.path} HATCH ${e.handle}: ${JSON.stringify(stored)}`);
      }
    }
    expect(wrong).toEqual([]);
    // 20 AutoCAD-saved acadsharp samples and 4 in ezdxf's hatch_issues.dxf.
    expect(checked).toBeGreaterThanOrEqual(24);
  });
});
