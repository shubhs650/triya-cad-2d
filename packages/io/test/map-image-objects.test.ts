// IMAGEDEF, RASTERVARIABLES and WIPEOUTVARIABLES to Triya (M1-19), on drawings authored in
// memory with acad-ts. The renderer reads them for an image's bitmap and the frame settings.
import {
  ACadVersion,
  CadDocument,
  ImageDefinition,
  RasterVariables,
  ResolutionUnit,
  WipeoutVariables,
  XY,
} from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { mapImageObjects } from '../src/index';

const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

function drawing(): CadDocument {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.updateCollections(true, false);
  return doc;
}

describe('mapImageObjects', () => {
  it('maps an image definition’s file, pixel size and resolution', () => {
    const doc = drawing();
    const def = new ImageDefinition('site-photo');
    def.fileName = '.\\site-photo.png';
    def.size = new XY(640, 480);
    def.defaultSize = new XY(0.25, 0.25);
    def.isLoaded = false;
    def.units = ResolutionUnit.Inches;
    doc.rootDictionary!.add(def);

    expect(mapImageObjects(doc)).toEqual([
      expect.objectContaining({
        handle: H(def),
        type: 'IMAGEDEF',
        owner: H(doc.rootDictionary!),
        fileName: '.\\site-photo.png',
        size: { x: 640, y: 480 },
        pixelSize: { x: 0.25, y: 0.25 },
        loaded: false,
        units: 5,
      }),
    ]);
  });

  it('maps IMAGEFRAME, IMAGEQUALITY and WIPEOUTFRAME', () => {
    const doc = drawing();
    const raster = new RasterVariables('ACAD_IMAGE_VARS');
    raster.isDisplayFrameShown = false;
    raster.displayQuality = 0;
    raster.units = 1;
    const wipeout = new WipeoutVariables('ACAD_WIPEOUT_VARS');
    wipeout.displayImageFrame = true;
    doc.rootDictionary!.add(raster);
    doc.rootDictionary!.add(wipeout);

    const mapped = mapImageObjects(doc);
    expect(mapped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          handle: H(raster),
          type: 'RASTERVARIABLES',
          frame: false,
          quality: 'draft',
          units: 1,
        }),
        expect.objectContaining({ handle: H(wipeout), type: 'WIPEOUTVARIABLES', frame: true }),
      ]),
    );
    expect(mapped).toHaveLength(2);
  });

  it('gives nothing for a drawing without images', () => {
    expect(mapImageObjects(drawing())).toEqual([]);
  });
});
