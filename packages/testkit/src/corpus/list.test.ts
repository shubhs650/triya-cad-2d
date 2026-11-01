import { describe, expect, it } from 'vitest';
import { formatCorpusList } from './list.ts';
import type { CorpusFile, CorpusManifest } from './manifest.ts';

const file = (path: string, version: string, format: CorpusFile['format']): CorpusFile => ({
  path,
  version,
  format,
  source: 'ezdxf',
  license: 'MIT',
  sha256: '0'.repeat(64),
  tags: ['hatch'],
  references: [],
  tolerance: { pixelMismatch: 2, ssim: 0.95 },
  fonts: [],
  knownIssues: [],
});

const manifest: CorpusManifest = {
  schemaVersion: 1,
  sources: { ezdxf: { name: 'ezdxf', url: 'https://github.com/mozman/ezdxf', license: 'MIT', licenseFile: 'x' } },
  files: [
    file('public/b.dwg', 'AC1032', 'dwg'),
    file('public/a.dxf', 'AC1009', 'dxf-ascii'),
    file('public/c.dxf', 'AC1032', 'dxf-binary'),
  ],
};

describe('formatCorpusList', () => {
  const out = formatCorpusList(manifest);
  const lines = out.split('\n');

  it('prints one row per file with release, version code, format, source and path', () => {
    const row = lines.find((l) => l.includes('public/a.dxf'));
    expect(row).toMatch(/R12\s+AC1009\s+dxf-ascii\s+ezdxf\s+public\/a\.dxf/);
  });

  it('sorts rows oldest version first, then by path', () => {
    const order = lines.filter((l) => l.includes('public/')).map((l) => l.trim().split(/\s+/).at(-2));
    expect(order).toEqual(['public/a.dxf', 'public/b.dwg', 'public/c.dxf']);
  });

  it('ends with a total and a per-release and per-format summary', () => {
    expect(out).toContain('3 files');
    expect(out).toMatch(/R12: 1/);
    expect(out).toMatch(/R2018: 2/);
    expect(out).toMatch(/dwg: 1/);
  });
});
