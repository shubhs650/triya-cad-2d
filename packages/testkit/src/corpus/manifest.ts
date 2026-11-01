/**
 * `corpus.json`: the manifest of drawings the round-trip, fidelity and perf harnesses run on
 * (docs/TESTING.md §2.3). `corpus.schema.json` beside the manifest describes the same shape for
 * editors; this module is what CI enforces.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isAcadVersion } from './versions.ts';
import { sniffCadFile, type CadFormat } from './sniff.ts';

export interface CorpusSource {
  name: string;
  url: string;
  /** Upstream commit the files were taken from, for third-party sources. */
  commit?: string;
  license: string;
  /** License text, relative to the corpus directory. */
  licenseFile: string;
}

export interface CorpusReference {
  /** "Model" or a layout name. */
  space: string;
  /** AutoCAD-plotted reference PDF, relative to the corpus directory. */
  pdf: string;
  /** PNG rasterised from `pdf` by `pnpm corpus:ref`, relative to the corpus directory. */
  png?: string;
  /** Plot-style table used for the reference plot, e.g. "monochrome". */
  ctb: string;
}

export interface CorpusFile {
  /** Relative to the corpus directory; starts with `public/` or `private/`. */
  path: string;
  /** `$ACADVER` code, e.g. AC1032. Header-less DXF files are AC1009 and tagged `no-header`. */
  version: string;
  format: Exclude<CadFormat, 'unknown'>;
  /** Key into `sources`. */
  source: string;
  license: string;
  /** Path of the file in the upstream repository, for third-party sources. */
  upstreamPath?: string;
  sha256: string;
  tags: string[];
  references: CorpusReference[];
  tolerance: { pixelMismatch: number; ssim: number };
  /** Font files named by the drawing's text styles. */
  fonts: string[];
  knownIssues: string[];
}

export interface CorpusManifest {
  $schema?: string;
  schemaVersion: 1;
  sources: Record<string, CorpusSource>;
  files: CorpusFile[];
}

/** CLAUDE.md: MIT/BSD/Apache/ISC only (LGPL only as a separate code module, never for data). */
export const ALLOWED_LICENSES: readonly string[] = [
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'ISC',
  'CC0-1.0',
  'Unlicense',
];

const FORMATS: readonly string[] = ['dwg', 'dxf-ascii', 'dxf-binary'];
/** TESTING.md §4: a new file starts at 2 % and may only be tightened. */
const MAX_PIXEL_MISMATCH = 2;
const DRAWING_EXT = /\.(dwg|dxf)$/i;

export function loadManifest(file: string): CorpusManifest {
  const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const errors = validateManifestShape(json);
  if (errors.length > 0) throw new Error(`${file} is invalid:\n  ${errors.join('\n  ')}`);
  return json as CorpusManifest;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

function isCorpusPath(p: unknown): p is string {
  return (
    isString(p) &&
    /^(public|private)\//.test(p) &&
    !p.includes('\\') &&
    !p.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')
  );
}

/** Structural checks only; no file-system access. Returns one message per problem. */
export function validateManifestShape(json: unknown): string[] {
  if (!isObject(json)) return ['manifest: must be a JSON object'];
  const errors: string[] = [];
  if (json['schemaVersion'] !== 1) errors.push('manifest: schemaVersion must be 1');

  const sources = json['sources'];
  if (!isObject(sources)) {
    errors.push('manifest: sources must be an object');
  } else {
    for (const [key, src] of Object.entries(sources)) {
      const at = `sources.${key}`;
      if (!isObject(src)) {
        errors.push(`${at}: must be an object`);
        continue;
      }
      if (!isString(src['name'])) errors.push(`${at}.name: required`);
      if (!isString(src['url'])) errors.push(`${at}.url: required`);
      if (!ALLOWED_LICENSES.includes(src['license'] as string)) {
        errors.push(`${at}.license: "${String(src['license'])}" is not an allowed license`);
      }
      if (!isString(src['licenseFile'])) errors.push(`${at}.licenseFile: required`);
    }
  }

  const files = json['files'];
  if (!Array.isArray(files)) return [...errors, 'manifest: files must be an array'];
  const seen = new Set<string>();
  files.forEach((f: unknown, i) => {
    if (!isObject(f)) {
      errors.push(`files[${i}]: must be an object`);
      return;
    }
    const at = isString(f['path']) ? f['path'] : `files[${i}]`;
    if (!isCorpusPath(f['path'])) {
      errors.push(`${at}: path must be a relative path under public/ or private/`);
    } else if (seen.has(f['path'])) {
      errors.push(`${at}: duplicate path`);
    } else {
      seen.add(f['path']);
    }
    if (!isString(f['version']) || !isAcadVersion(f['version'])) {
      errors.push(`${at}: version "${String(f['version'])}" is not a known $ACADVER code`);
    }
    if (!FORMATS.includes(f['format'] as string)) {
      errors.push(`${at}: format must be one of ${FORMATS.join(', ')}`);
    }
    if (!isString(f['source']) || !isObject(sources) || !(f['source'] in sources)) {
      errors.push(`${at}: source "${String(f['source'])}" is not declared in sources`);
    }
    if (!ALLOWED_LICENSES.includes(f['license'] as string)) {
      errors.push(`${at}: license "${String(f['license'])}" is not an allowed license`);
    }
    if (typeof f['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(f['sha256'])) {
      errors.push(`${at}: sha256 must be 64 lowercase hex digits`);
    }
    if (!isStringArray(f['tags'])) errors.push(`${at}: tags must be an array of strings`);
    if (!isStringArray(f['fonts'])) errors.push(`${at}: fonts must be an array of strings`);
    if (!isStringArray(f['knownIssues'])) {
      errors.push(`${at}: knownIssues must be an array of strings`);
    }
    const tol = f['tolerance'];
    if (!isObject(tol)) {
      errors.push(`${at}: tolerance is required`);
    } else {
      const pm = tol['pixelMismatch'];
      const ssim = tol['ssim'];
      if (typeof pm !== 'number' || !(pm >= 0 && pm <= MAX_PIXEL_MISMATCH)) {
        errors.push(`${at}: tolerance.pixelMismatch must be a percentage in [0, 2]`);
      }
      if (typeof ssim !== 'number' || !(ssim > 0 && ssim <= 1)) {
        errors.push(`${at}: tolerance.ssim must be in (0, 1]`);
      }
    }
    const refs = f['references'];
    if (!Array.isArray(refs)) {
      errors.push(`${at}: references must be an array`);
    } else {
      refs.forEach((r: unknown, j) => {
        const rat = `${at}: references[${j}]`;
        if (!isObject(r)) {
          errors.push(`${rat} must be an object`);
          return;
        }
        if (!isString(r['space'])) errors.push(`${rat}.space is required`);
        if (!isCorpusPath(r['pdf'])) errors.push(`${rat}.pdf must be a corpus path`);
        if (r['png'] !== undefined && !isCorpusPath(r['png'])) {
          errors.push(`${rat}.png must be a corpus path`);
        }
        if (!isString(r['ctb'])) errors.push(`${rat}.ctb is required`);
      });
    }
  });
  return errors;
}

/**
 * Full check of a manifest against a corpus directory: shape, presence, hashes, format and
 * version as stated by each file's own header, license files, reference plots, and drawings
 * on disk that the manifest forgot.
 */
export function validateCorpus(manifest: CorpusManifest, corpusDir: string): string[] {
  const errors = validateManifestShape(manifest);
  if (errors.length > 0) return errors;

  for (const [key, src] of Object.entries(manifest.sources)) {
    if (!existsSync(join(corpusDir, src.licenseFile))) {
      errors.push(`sources.${key}.licenseFile: ${src.licenseFile} does not exist`);
    }
  }

  const listed = new Set<string>();
  const scopes = new Set<string>();
  for (const f of manifest.files) {
    listed.add(f.path);
    scopes.add(f.path.split('/')[0]!);
    const abs = join(corpusDir, f.path);
    if (!existsSync(abs)) {
      errors.push(`${f.path}: file does not exist`);
      continue;
    }
    const bytes = readFileSync(abs);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== f.sha256) errors.push(`${f.path}: sha256 is ${hash}, manifest says ${f.sha256}`);

    const sniffed = sniffCadFile(bytes);
    if (sniffed.format !== f.format) {
      errors.push(`${f.path}: format is ${sniffed.format}, manifest says ${f.format}`);
    }
    if (sniffed.version === null) {
      // A DXF without a HEADER is legal; readers treat it as R12 (DXF Reference, "Header Section").
      if (!(f.tags.includes('no-header') && f.version === 'AC1009')) {
        errors.push(
          `${f.path}: file states no $ACADVER; declare version AC1009 and tag it no-header`,
        );
      }
    } else if (sniffed.version !== f.version) {
      errors.push(`${f.path}: file header says ${sniffed.version}, manifest says ${f.version}`);
    }
    for (const r of f.references) {
      for (const p of [r.pdf, r.png]) {
        if (p !== undefined && !existsSync(join(corpusDir, p))) {
          errors.push(`${f.path}: reference ${p} does not exist`);
        }
      }
    }
  }

  // Every drawing in a scope the manifest covers must be listed, so nothing untracked
  // (and possibly unlicensed) slips into the corpus.
  for (const scope of scopes.size > 0 ? scopes : ['public']) {
    for (const file of walk(join(corpusDir, scope))) {
      const rel = relative(corpusDir, file).split(sep).join('/');
      if (DRAWING_EXT.test(rel) && !listed.has(rel)) {
        errors.push(`${rel}: drawing on disk is not listed in the manifest`);
      }
    }
  }
  return errors;
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}
