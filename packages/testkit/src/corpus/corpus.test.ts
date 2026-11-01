import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOWED_LICENSES, loadManifest, validateCorpus, type CorpusFile } from './manifest.ts';

// The committed public corpus is the data the round-trip and fidelity gates run on;
// this test keeps the manifest truthful (M0-04 acceptance: >= 40 files, R12-R2018).
const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

describe('public corpus', () => {
  const manifest = loadManifest(`${corpusDir}corpus.json`);

  it('validates against the files on disk', () => {
    expect(validateCorpus(manifest, corpusDir)).toEqual([]);
  });

  it('has at least 40 drawings', () => {
    expect(manifest.files.length).toBeGreaterThanOrEqual(40);
  });

  it('covers every release from R12 to R2018', () => {
    const versions = new Set(manifest.files.map((f) => f.version));
    for (const v of ['AC1009', 'AC1012', 'AC1014', 'AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032']) {
      expect(versions, v).toContain(v);
    }
  });

  it('has both DWG and DXF (ASCII and binary) files', () => {
    const formats = new Set(manifest.files.map((f) => f.format));
    expect(formats).toEqual(new Set(['dwg', 'dxf-ascii', 'dxf-binary']));
  });

  it('keeps corpus/private out of git', () => {
    const ignore = readFileSync(`${repoRoot}.gitignore`, 'utf8').split('\n').map((l) => l.trim());
    expect(ignore).toContain('corpus/private/*');
  });
});

// Every required field of a manifest entry, so the JSON schema cannot drift from the validator.
const requiredFileFields: Required<Omit<CorpusFile, 'upstreamPath'>> = {
  path: '',
  version: '',
  format: 'dwg',
  source: '',
  license: '',
  sha256: '',
  tags: [],
  references: [],
  tolerance: { pixelMismatch: 0, ssim: 1 },
  fonts: [],
  knownIssues: [],
};

describe('corpus.schema.json', () => {

  const schema = JSON.parse(readFileSync(`${corpusDir}corpus.schema.json`, 'utf8')) as {
    properties: { files: { items: { required: string[] } } };
    $defs: { license: { enum: string[] } };
  };

  it('requires the same file fields the validator enforces', () => {
    expect(new Set(schema.properties.files.items.required)).toEqual(
      new Set(Object.keys(requiredFileFields)),
    );
  });

  it('allows the same licenses as the validator', () => {
    expect(schema.$defs.license.enum).toEqual([...ALLOWED_LICENSES]);
  });
});
