// LAYOUT objects to Triya `Layout` values (M1-18): the tab, its block record, and the page
// setup its sheet is drawn from (DXF AcDbLayout and AcDbPlotSettings groups).

import type { CadDocument, Layout as AcadLayout } from '@node-projects/acad-ts';
import type { Layout, LayoutPlot, LayoutSpace, PlotPaperUnits as Units } from '@triya/engine';
import { common, ref, vec2, vec3 } from './common';

/** DXF 72: 0 inches, 1 millimetres, 2 pixels. */
const UNITS: readonly Units[] = ['inches', 'millimeters', 'pixels'];

function plotOf(l: AcadLayout): LayoutPlot {
  const m = l.unprintableMargin;
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
    plotType: l.plotType as number,
    flags: l.flags as number,
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
