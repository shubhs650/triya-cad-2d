import { describe, expect, it } from 'vitest';
import { ACAD_VERSIONS, releaseName } from './versions.ts';

describe('ACAD_VERSIONS', () => {
  it('maps every version code the PRD targets (R12-R2018) to its release name', () => {
    expect(releaseName('AC1009')).toBe('R12');
    expect(releaseName('AC1012')).toBe('R13');
    expect(releaseName('AC1014')).toBe('R14');
    expect(releaseName('AC1015')).toBe('R2000');
    expect(releaseName('AC1018')).toBe('R2004');
    expect(releaseName('AC1021')).toBe('R2007');
    expect(releaseName('AC1024')).toBe('R2010');
    expect(releaseName('AC1027')).toBe('R2013');
    expect(releaseName('AC1032')).toBe('R2018');
  });

  it('orders codes from oldest to newest', () => {
    const codes = Object.keys(ACAD_VERSIONS);
    expect([...codes].sort()).toEqual(codes);
  });

  it('returns undefined for an unknown code', () => {
    expect(releaseName('AC9999')).toBeUndefined();
  });
});
