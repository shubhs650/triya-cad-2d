// LAYOUT objects to Triya `Layout` values (M1-18): the tab, its block record, and the page
// setup its sheet is drawn from (DXF AcDbLayout and AcDbPlotSettings groups).

import type { CadDocument, Layout as AcadLayout } from '@node-projects/acad-ts';
import type { Layout, LayoutPlot, LayoutSpace, PlotPaperUnits as Units } from '@triya/engine';
import { common, ref, vec2, vec3 } from './common';

/** DXF 72: 0 inches, 1 millimetres, 2 pixels. */
const UNITS: readonly Units[] = ['inches', 'millimeters', 'pixels'];

/** DXF 48 / 49 and 140 / 141, or undefined when the page setup stores no window (all 0). */
function windowOf(l: AcadLayout): LayoutPlot['window'] {
  const c = [l.windowLowerLeftX, l.windowLowerLeftY, l.windowUpperLeftX, l.windowUpperLeftY];
  if (c.every((v) => v === 0)) return undefined;
  return { min: { x: c[0]!, y: c[1]! }, max: { x: c[2]!, y: c[3]! } };
}

function plotOf(l: AcadLayout): LayoutPlot {
  const m = l.unprintableMargin;
  const window = windowOf(l);
  const rotation = l.paperRotation as number;
  return {
    paperSize: l.paperSize,
    paperWidth: l.paperWidth,
    paperHeight: l.paperHeight,
    margins: { left: m.left, bottom: m.bottom, right: m.right, top: m.top },
    paperUnits: UNITS[l.paperUnits as number] ?? 'millimeters',
    rotation: rotation === 1 || rotation === 2 || rotation === 3 ? rotation : 0,
    origin: { x: l.plotOriginX, y: l.plotOriginY },
    scale: { numerator: l.numeratorScale, denominator: l.denominatorScale },
    // M2-17 part 4: the rest of the page setup the Plot dialog opens on and Apply to Layout
    // writes. acad-ts names DXF 75 `scaledFit` (147, the factor, is its `standardScale`) and
    // DXF 140 / 141, the window's upper right corner, `windowUpperLeft`.
    // DXF 75 means something only while flag 16 (UseStandardScale) is on.
    ...(((l.flags as number) & 16) !== 0 && { standardScaleType: l.scaledFit as number }),
    plotType: l.plotType as number,
    ...(window && { window }),
    flags: l.flags as number,
    // M2-17 part 3: the Plot dialog opens on it.
    ...(l.styleSheet && { styleSheet: l.styleSheet }),
  };
}

/** DXF 12–17 and 146: what the header's `$P…` variables hold while the layout is current. */
function spaceOf(l: AcadLayout): LayoutSpace {
  return {
    insertionBase: vec3(l.insertionBasePoint),
    extents: { min: vec3(l.minExtents), max: vec3(l.maxExtents) },
    elevation: l.elevation,
    ucs: { origin: vec3(l.origin), xAxis: vec3(l.xAxis), yAxis: vec3(l.yAxis) },
  };
}

/**
 * Every layout with its block record, in tab order (Model first). A layout whose block record
 * is missing (a damaged file) has no space to show and is left to the retained original.
 */
export function mapLayouts(doc: CadDocument): Layout[] {
  const out: Layout[] = [];
  for (const l of doc.layouts ?? []) {
    const blockRecord = ref(l.associatedBlock);
    if (!blockRecord || l.handle === 0) continue;
    out.push({
      ...common(l),
      name: l.name,
      tabOrder: l.tabOrder,
      blockRecord,
      flags: l.layoutFlags as number,
      limits: { min: vec2(l.minLimits), max: vec2(l.maxLimits) },
      plot: plotOf(l),
      space: spaceOf(l),
    });
  }
  return out.sort((a, b) => a.tabOrder - b.tabOrder || a.name.localeCompare(b.name));
}
