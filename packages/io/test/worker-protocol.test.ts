import { ACadVersion } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { handleIoRequest } from '../src/index';
import { ascii, sampleDwg } from './fixtures';

// The worker entry is a thin binding of handleIoRequest to the worker's message port, so the
// request/response contract is tested here in Node; tests/e2e/io proves the real Worker.
describe('handleIoRequest', () => {
  it('answers a read request with a summary and echoes the id', () => {
    const res = handleIoRequest({ id: 7, kind: 'read', bytes: sampleDwg(ACadVersion.AC1018) });

    expect(res).toMatchObject({
      id: 7,
      ok: true,
      summary: { format: 'dwg', version: 'AC1018', modelSpaceEntities: { LINE: 1 } },
    });
  });

  it('reports a parse failure as an error response instead of throwing', () => {
    const res = handleIoRequest({
      id: 8,
      kind: 'read',
      bytes: ascii('AC1032 this is not a drawing'),
      format: 'dwg',
    });

    expect(res.id).toBe(8);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toBe('');
  });
});
