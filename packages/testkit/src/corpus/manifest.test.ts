import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCorpus, validateManifestShape, type CorpusManifest } from './manifest.ts';

const DXF_R2000 = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nEOF\n';
const sha256 = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');

function goodManifest(): CorpusManifest {
  return {
    schemaVersion: 1,
    sources: {
      ezdxf: { name: 'ezdxf', url: 'https://github.com/mozman/ezdxf', commit: 'abc', license: 'MIT', licenseFile: 'public/LICENSES/ezdxf-MIT.txt' },
    },
    files: [
      {
        path: 'public/third-party/ezdxf/a.dxf',
        version: 'AC1015',
        format: 'dxf-ascii',
        source: 'ezdxf',
        license: 'MIT',
        sha256: sha256(DXF_R2000),
        tags: ['r2000'],
        references: [],
        tolerance: { pixelMismatch: 2, ssim: 0.95 },
        fonts: [],
        knownIssues: [],
      },
    ],
  };
}

/** Lays out a corpus directory on disk that matches `goodManifest()`. */
function makeCorpusDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'triya-corpus-'));
  mkdirSync(join(dir, 'public/third-party/ezdxf'), { recursive: true });
  mkdirSync(join(dir, 'public/LICENSES'), { recursive: true });
  writeFileSync(join(dir, 'public/third-party/ezdxf/a.dxf'), DXF_R2000);
  writeFileSync(join(dir, 'public/LICENSES/ezdxf-MIT.txt'), 'MIT License');
  return dir;
}

describe('validateManifestShape', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifestShape(goodManifest())).toEqual([]);
  });

  it('rejects a non-object and a wrong schemaVersion', () => {
    expect(validateManifestShape(null)).not.toEqual([]);
    expect(validateManifestShape({ ...goodManifest(), schemaVersion: 2 })).toContainEqual(expect.stringContaining('schemaVersion'));
  });

  it.each([
    ['path', undefined, 'path'],
    ['version', 'R2000', 'version'],
    ['format', 'svg', 'format'],
    ['source', 'nowhere', 'source'],
    ['license', 'GPL-3.0', 'license'],
    ['sha256', 'xyz', 'sha256'],
    ['tags', 'r2000', 'tags'],
    ['references', undefined, 'references'],
    ['fonts', undefined, 'fonts'],
    ['knownIssues', undefined, 'knownIssues'],
  ])('reports a bad %s field', (field, value, expected) => {
    const m = goodManifest();
    (m.files[0] as unknown as Record<string, unknown>)[field] = value;
    const errors = validateManifestShape(m);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(expected);
    // Each message names the file; a file without a usable path is named by its index.
    expect(errors[0]).toContain(field === 'path' ? 'files[0]' : 'public/third-party/ezdxf/a.dxf');
  });

  it('forbids GPL/AGPL and other non-allowed licenses on sources too', () => {
    const m = goodManifest();
    m.sources['ezdxf']!.license = 'AGPL-3.0';
    expect(validateManifestShape(m)).toContainEqual(expect.stringContaining('license'));
  });

  it('rejects paths that escape the corpus or are not under public/ or private/', () => {
    for (const path of ['../etc/passwd', 'public/../../x.dxf', 'other/a.dxf', '/abs/a.dxf', 'public\\a.dxf']) {
      const m = goodManifest();
      m.files[0]!.path = path;
      expect(validateManifestShape(m), path).toContainEqual(expect.stringContaining('path'));
    }
  });

  it('rejects duplicate paths', () => {
    const m = goodManifest();
    m.files.push({ ...m.files[0]! });
    expect(validateManifestShape(m)).toContainEqual(expect.stringContaining('duplicate'));
  });

  it('rejects tolerances looser than the 2 % starting point or outside SSIM range', () => {
    const m = goodManifest();
    m.files[0]!.tolerance = { pixelMismatch: 5, ssim: 1.2 };
    const errors = validateManifestShape(m);
    expect(errors).toContainEqual(expect.stringContaining('pixelMismatch'));
    expect(errors).toContainEqual(expect.stringContaining('ssim'));
  });

  it('requires pdf, space and ctb on every reference', () => {
    const m = goodManifest();
    m.files[0]!.references = [{ space: 'Model', pdf: '', ctb: 'monochrome' }];
    expect(validateManifestShape(m)).toContainEqual(expect.stringContaining('references[0].pdf'));
  });
});

describe('validateCorpus', () => {
  it('passes when every listed file exists with the declared hash, format and version', () => {
    expect(validateCorpus(goodManifest(), makeCorpusDir())).toEqual([]);
  });

  it('reports a missing file', () => {
    const m = goodManifest();
    m.files[0]!.path = 'public/third-party/ezdxf/missing.dxf';
    expect(validateCorpus(m, makeCorpusDir())).toContainEqual(expect.stringContaining('missing.dxf'));
  });

  it('reports a hash mismatch', () => {
    const m = goodManifest();
    m.files[0]!.sha256 = sha256('something else');
    expect(validateCorpus(m, makeCorpusDir())).toContainEqual(expect.stringContaining('sha256'));
  });

  it('reports a version that disagrees with the file header', () => {
    const m = goodManifest();
    m.files[0]!.version = 'AC1032';
    expect(validateCorpus(m, makeCorpusDir())).toContainEqual(expect.stringContaining('AC1015'));
  });

  it('reports a format that disagrees with the file content', () => {
    const m = goodManifest();
    m.files[0]!.format = 'dwg';
    expect(validateCorpus(m, makeCorpusDir())).toContainEqual(expect.stringContaining('format'));
  });

  it('accepts a header-less DXF only when tagged no-header and declared AC1009', () => {
    const dir = makeCorpusDir();
    const body = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n';
    writeFileSync(join(dir, 'public/third-party/ezdxf/a.dxf'), body);
    const m = goodManifest();
    m.files[0]!.sha256 = sha256(body);
    m.files[0]!.version = 'AC1009';
    expect(validateCorpus(m, dir)).toContainEqual(expect.stringContaining('no-header'));
    m.files[0]!.tags = ['no-header'];
    expect(validateCorpus(m, dir)).toEqual([]);
  });

  it('reports drawings on disk that the manifest does not list', () => {
    const dir = makeCorpusDir();
    writeFileSync(join(dir, 'public/third-party/ezdxf/orphan.DWG'), 'AC1032');
    expect(validateCorpus(goodManifest(), dir)).toContainEqual(expect.stringContaining('orphan.DWG'));
  });

  it('reports a missing source license file', () => {
    const m = goodManifest();
    m.sources['ezdxf']!.licenseFile = 'public/LICENSES/nope.txt';
    expect(validateCorpus(m, makeCorpusDir())).toContainEqual(expect.stringContaining('nope.txt'));
  });

  it('reports a missing reference plot', () => {
    const m = goodManifest();
    m.files[0]!.references = [{ space: 'Model', pdf: 'public/refs/a-Model.pdf', png: 'public/refs/a-Model.png', ctb: 'monochrome' }];
    const errors = validateCorpus(m, makeCorpusDir());
    expect(errors).toContainEqual(expect.stringContaining('a-Model.pdf'));
    expect(errors).toContainEqual(expect.stringContaining('a-Model.png'));
  });
});
