// PDFATTACH (M5-04 part 8): a PDF page attached as a PDFUNDERLAY showing a PDFDEFINITION.
//
// Size: an underlay's own unit is the page's inch (render underlay.ts), so a page is at its true
// size when DXF 41/42 are the drawing units in an inch: 25.4 in a millimetre drawing, as AutoCAD
// attaches one. The Attach PDF Underlay dialog's Scale multiplies that (AutoCAD Help, "Attach PDF
// Underlay Dialog Box", Scale: "applied after the true width ... in AutoCAD units is
// determined"). A unitless drawing takes inches or millimetres by MEASUREMENT, as a pasted
// picture does (edit/picture.ts `unitsPerInch`): AutoCAD's help leaves a PDF's case unstated.
//
// Definitions: one per page, named "<file> - <page>" (how AutoCAD names its ACAD_PDFDEFINITIONS
// entries, as ezdxf writes them too), the file named alone (No path); a page of a file the
// drawing shows already (its name without the folder, case aside, as the app matches supplied
// files, underlay/pages.ts) is attached with that definition. A new one is filed as a pasted
// underlay's is (edit/clipboard.ts): under the drawing's ACAD_PDFDEFINITIONS, else where its
// other definitions are, else a new dictionary the save creates.
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { Entity, PdfDefinition, UnderlayGeometry } from '../model/types';
import type { GeneralProps } from '../properties/sheet';
import { unitsPerInch } from './picture';

/** A page of a PDF file, as the app read it: its number from 1 and its size in inches. */
export interface PdfAttachPage {
  /** DXF 2: the page number from 1. */
  readonly page: string;
  readonly width: number;
  readonly height: number;
}

/** DXF 280: 2 on, 8 adjust colours for the background, as a new underlay is (ezdxf's too). */
const NEW_UNDERLAY_FLAGS = 10;

/** The file name without its folder (either slash), lower case: how files are matched. */
export const pdfFileKey = (path: string): string => (path.split(/[\\/]/).pop() ?? '').toLowerCase();

/** The file's name without folder or extension: the definitions' name stem. */
export const pdfBaseName = (fileName: string): string =>
  fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || 'underlay';

/** Whether `p` is a page with a size. */
export function hasPageSize(p: PdfAttachPage): boolean {
  const ok = (v: number) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  return typeof p.page === 'string' && p.page.trim() !== '' && ok(p.width) && ok(p.height);
}

/** DXF 41/42 for the dialog's `scale`: the drawing units in an inch times it. */
export function underlayScaleFor(model: DocumentModel, scale: number): number {
  return unitsPerInch(model) * scale;
}

/** The drawing's PDFDEFINITION for the file's page, or a new one. */
function pdfDefinition(
  b: ChangeSetBuilder,
  model: DocumentModel,
  fileName: string,
  page: string,
): Handle {
  const key = pdfFileKey(fileName);
  const names = new Set<string>();
  const stems = new Map<string, string>();
  let owner: Handle | undefined = model.meta.pdfDictionary;
  for (const o of b.objects()) {
    if (o.type !== 'PDFDEFINITION') continue;
    const d = o as PdfDefinition;
    const same = pdfFileKey(d.fileName) === key;
    if (same && d.page === page) return d.handle;
    names.add(d.name.toUpperCase());
    // The stem another page of this file was given, so its pages keep one name.
    const m = /^(.*) - [^-]*$/.exec(d.name);
    if (same && m) stems.set(key, m[1]!);
    owner ??= d.owner;
  }
  const taken = (stem: string) => names.has(`${stem} - ${page}`.toUpperCase());
  const base = pdfBaseName(fileName);
  let stem = stems.get(key) ?? base;
  for (let n = 1; taken(stem); n++) stem = `${base}-${n}`;
  owner ??= b.allocateHandle();
  const def: PdfDefinition = {
    type: 'PDFDEFINITION',
    handle: b.allocateHandle(),
    owner,
    name: `${stem} - ${page}`,
    fileName,
    page,
  };
  b.adoptObject(def);
  return def.handle;
}

/**
 * PDFATTACH: a PDFUNDERLAY of the file's page in `owner`, the page's lower-left corner at `at`,
 * `scale` as the dialog takes it, turned `rotation` radians from the world X axis, showing the
 * drawing's definition of that page or a new one. Returns the underlay.
 */
export function attachPdfPage(
  b: ChangeSetBuilder,
  model: DocumentModel,
  fileName: string,
  page: PdfAttachPage,
  owner: Handle,
  at: Vec2,
  scale: number,
  rotation: number,
  props: GeneralProps,
): Entity {
  const definition = pdfDefinition(b, model, fileName, page.page);
  const k = underlayScaleFor(model, scale);
  const geom: UnderlayGeometry = {
    kind: 'PDFUNDERLAY',
    definition,
    position: at,
    scale: { x: k, y: k, z: k },
    rotation,
    flags: NEW_UNDERLAY_FLAGS,
    contrast: 100,
    fade: 0,
    clip: [],
  };
  return b.addEntity({ owner, ...props, geom });
}
