// Views kept in the drawing (M2-29). VIEW Save and the navigation bar's Save view write a VIEW
// record, as AutoCAD saves a named view in the drawing's VIEW table, and a save writes the view
// each model-space tile shows into its `*Active` VPORT, which is how AutoCAD reopens a drawing
// where it was left (AutoCAD DXF reference, VIEW and VPORT; AutoCAD 2024 Help, "-VIEW").
//
// Triya's canvas shows plan views of the WCS, so a view saved here looks down +Z at a target of
// the origin with no twist, and its centre (DXF 10, display coordinates) is the world centre. A
// VPORT read with a 3D or twisted view is opened in a plan view (savedModelView in the app) and
// left as read on save, since writing the plan view over it would lose the 3D one.
import type { Vec2 } from '../geom/types';
import { ChangeSetBuilder } from '../model/builder';
import { isEmptyChangeSet, type ChangeSet, type Replacement } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { ViewRecord, ViewportGeometry, VportRecord } from '../model/types';

/** A window on the drawing: its centre and size in world units. */
export interface ViewExtent {
  readonly center: Vec2;
  readonly height: number;
  readonly width: number;
}

/** VIEW table flag 1: a paper-space view. */
export const PAPER_VIEW = 1;

/** Characters AutoCAD refuses in a symbol table name, and its 255-character limit. */
const NAME_INVALID = /[<>/\\":;?*|,=`]/;
const NAME_MAX = 255;

/** A name AutoCAD would take for a view. */
export function validViewName(name: string): boolean {
  return name.trim() !== '' && name.length <= NAME_MAX && !NAME_INVALID.test(name);
}

/** The view `extent` as a VIEW record looking straight down at it (AutoCAD's defaults). */
function viewFields(extent: ViewExtent, paper: boolean): Omit<ViewRecord, 'handle' | 'name'> {
  return {
    // No flags at all is how the I/O layer reads 0 (map/tables.ts).
    ...(paper && { flags: PAPER_VIEW }),
    center: { x: extent.center.x, y: extent.center.y },
    height: extent.height,
    width: extent.width,
    direction: { x: 0, y: 0, z: 1 },
    target: { x: 0, y: 0, z: 0 },
    // AutoCAD's default lens (LENSLENGTH 50 mm) and no clipping.
    lensLength: 50,
    frontClip: 0,
    backClip: 0,
    twist: 0,
    viewMode: 0,
    renderMode: 0,
  };
}

/**
 * Saves `extent` as the named view `name`: a new VIEW record, or the one of that name (names are
 * compared without regard to case, as AutoCAD's) given the new view, keeping its handle and
 * spelling. Its UCS goes: Triya draws in the WCS.
 */
export function saveNamedView(
  b: ChangeSetBuilder,
  model: DocumentModel,
  name: string,
  extent: ViewExtent & { readonly paper: boolean },
): ViewRecord {
  const key = name.toUpperCase();
  const existing = [...model.tables.views.values()].find((v) => v.name.toUpperCase() === key);
  const fields = viewFields(extent, extent.paper);
  if (!existing) return b.addTableRecord('views', { name, ...fields });
  // Keep the xref-dependent and other flags AutoCAD sets; only the paper-space bit is the view's.
  const flags = ((existing.flags ?? 0) & ~PAPER_VIEW) | (fields.flags ?? 0);
  return b.updateTableRecord('views', existing.handle, {
    ...fields,
    flags: flags === 0 ? undefined : flags,
    ucs: undefined,
  });
}

const isPlan = (v: VportRecord): boolean => {
  const d = v.direction;
  const len = Math.hypot(d.x, d.y, d.z);
  return (
    d.z > 0 &&
    Math.abs(d.x) <= 1e-9 * len &&
    Math.abs(d.y) <= 1e-9 * len &&
    Math.abs(v.twist) <= 1e-12
  );
};

/** Equal to a part in 10^12 of the larger: what a view restored from the VPORT comes back as. */
const near = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b), 1);

/**
 * The change that writes each tile's view into its `*Active` VPORT: the centre (DXF 12, display
 * coordinates, so less the target in a plan view), the height (DXF 40) and the window's aspect
 * ratio (DXF 41). A VPORT already showing the view, one with a 3D or twisted view, and a view with
 * no size are left alone. Not an undo step: the app adds it to what it saves only.
 */
export function activeViewsChange(
  tiles: readonly { readonly vport: VportRecord; readonly view: ViewExtent }[],
): ChangeSet {
  const updated: Replacement<VportRecord>[] = [];
  for (const { vport, view } of tiles) {
    const { center, height, width } = view;
    if (
      !(height > 0) ||
      !(width > 0) ||
      ![center.x, center.y, height, width].every(Number.isFinite)
    )
      continue;
    if (!isPlan(vport)) continue;
    const c = { x: center.x - vport.target.x, y: center.y - vport.target.y };
    const aspectRatio = width / height;
    if (
      near(vport.center.x, c.x) &&
      near(vport.center.y, c.y) &&
      near(vport.height, height) &&
      near(vport.aspectRatio, aspectRatio)
    )
      continue;
    updated.push({ before: vport, after: { ...vport, center: c, height, aspectRatio } });
  }
  return updated.length > 0 ? { tables: { vports: { updated } } } : {};
}

/**
 * DXF 90 of a paper-space viewport the save makes: ezdxf's for a layout's main viewport (fast
 * zoom 32, UCS icon visibility 32768, current lineweight display 524288). AutoCAD's own carry
 * 262144 too (sample_AC1015 and later: 819232); none of these bits changes what is drawn.
 */
export const PAPER_VIEWPORT_FLAGS = 557_088;

/** What a layout's canvas shows: the layout by its block record, and the window on its sheet. */
export interface PaperView {
  readonly block: Handle;
  readonly view: ViewExtent;
}

const isCurrentPaper = (name: string | undefined): boolean =>
  name?.toUpperCase() === '*PAPER_SPACE';

/**
 * The change that writes the view each layout shows into its paper-space viewport (DXF 69 id 1):
 * its frame (DXF 10, 40, 41) and its view (12, 45) are the same window in AutoCAD's own files,
 * and the canvas opens a layout on them (`paperSpaceView` in the app). A layout without one gets
 * one, as AutoCAD makes it the first time a layout is shown, unless it holds floating viewports
 * already (another program's, with no id 1: which of them would be the sheet is unclear).
 * Built on the drawing but not applied to it, so its handles are the drawing's from now on and
 * a second save takes others; not an undo step, the app adds it to what it saves only.
 */
export function paperViewsChange(model: DocumentModel, layouts: readonly PaperView[]): ChangeSet {
  const b = new ChangeSetBuilder(model);
  for (const { block, view } of layouts) {
    const { center, height, width } = view;
    if (
      !(height > 0) ||
      !(width > 0) ||
      ![center.x, center.y, height, width].every(Number.isFinite)
    )
      continue;
    if (!model.layouts.some((l) => l.blockRecord === block)) continue;
    const name = model.blocks.get(block)?.name;
    if (name === undefined || name.toUpperCase() === '*MODEL_SPACE') continue;
    const c = { x: center.x, y: center.y };
    const viewports = model
      .blockEntities(block)
      .map((id) => model.entity(id)!)
      .filter((e) => e.geom.kind === 'VIEWPORT');
    const sheet = viewports.find((e) => (e.geom as ViewportGeometry).id === 1);
    if (sheet) {
      const g = sheet.geom as ViewportGeometry;
      if (
        near(g.center.x, c.x) &&
        near(g.center.y, c.y) &&
        near(g.viewCenter.x, c.x) &&
        near(g.viewCenter.y, c.y) &&
        near(g.width, width) &&
        near(g.height, height) &&
        near(g.viewHeight, height)
      )
        continue;
      b.updateEntity(sheet.id, {
        geom: { ...g, center: c, width, height, viewCenter: c, viewHeight: height },
      });
      continue;
    }
    if (viewports.length > 0) continue;
    const zero = [...model.tables.layers.values()].find((l) => l.name === '0');
    if (!zero) continue;
    b.addEntity({
      owner: block,
      layer: zero.handle,
      geom: {
        kind: 'VIEWPORT',
        center: c,
        width,
        height,
        id: 1,
        // DXF 68: on and first in a current layout, 0 in one that is not (DXF reference).
        status: isCurrentPaper(name) ? 1 : 0,
        flags: PAPER_VIEWPORT_FLAGS,
        viewCenter: c,
        viewHeight: height,
        viewDirection: { x: 0, y: 0, z: 1 },
        viewTarget: { x: 0, y: 0, z: 0 },
        twist: 0,
        lensLength: 50,
        frontClip: 0,
        backClip: 0,
        frozenLayers: [],
        plotStyleSheet: '',
        renderMode: 0,
      },
    });
  }
  const change = b.build();
  return isEmptyChangeSet(change) ? {} : change;
}
