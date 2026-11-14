// M2-74: an object's whole hyperlink (its PE_URL xdata) for a saved PDF's links: the URL, the
// description and the named location, read as ezdxf's `get_hyperlink` reads them (the first three
// 1000 strings in order) and AutoCAD writes them.
import { describe, expect, it } from 'vitest';
import { DocumentModel, hyperlinkDetails, type Xdata } from '../../src/index';
import { entityInit, lineGeom, record, sampleInit } from '../model/fixtures';

const PE_URL = '60';
const ACAD = '61';

function model(
  xdata: Xdata | undefined,
  appIds = [record(ACAD, 'ACAD'), record(PE_URL, 'pe_url')],
) {
  const base = sampleInit();
  return DocumentModel.create({
    ...base,
    tables: { ...base.tables, appIds },
    entities: [entityInit('25', lineGeom(0, 5, 10, 5), xdata ? { xdata } : {})],
  });
}
const details = (m: DocumentModel) => hyperlinkDetails(m, m.entityByHandle('25')!);

describe('hyperlinkDetails', () => {
  it('reads the URL, description and named location', () => {
    const m = model([
      { appId: ACAD, values: [{ code: 1000, value: 'not a link' }] },
      {
        appId: PE_URL,
        values: [
          { code: 1000, value: 'https://example.com/spec.pdf' },
          { code: 1002, value: '{' },
          { code: 1000, value: 'Specification' },
          { code: 1000, value: 'page=3' },
          { code: 1002, value: '{' },
          { code: 1071, value: 1 },
          { code: 1002, value: '}' },
          { code: 1002, value: '}' },
        ],
      },
    ]);
    expect(details(m)).toEqual({
      url: 'https://example.com/spec.pdf',
      description: 'Specification',
      location: 'page=3',
    });
  });

  it('reads a link with only a URL, and a location-only link to a layout', () => {
    expect(
      details(model([{ appId: PE_URL, values: [{ code: 1000, value: 'https://a.example' }] }])),
    ).toEqual({ url: 'https://a.example', description: '', location: '' });
    expect(
      details(
        model([
          {
            appId: PE_URL,
            values: [
              { code: 1000, value: '' },
              { code: 1002, value: '{' },
              { code: 1000, value: 'Sheet 2' },
              { code: 1000, value: 'Layout2' },
              { code: 1002, value: '}' },
            ],
          },
        ]),
      ),
    ).toEqual({ url: '', description: 'Sheet 2', location: 'Layout2' });
  });

  it('is undefined without a link: no xdata, no PE_URL application, or nothing in it', () => {
    expect(details(model(undefined))).toBeUndefined();
    expect(
      details(
        model([{ appId: ACAD, values: [{ code: 1000, value: 'x' }] }], [record(ACAD, 'ACAD')]),
      ),
    ).toBeUndefined();
    expect(
      details(model([{ appId: PE_URL, values: [{ code: 1000, value: '' }] }])),
    ).toBeUndefined();
    expect(details(model([{ appId: PE_URL, values: [] }]))).toBeUndefined();
  });
});
