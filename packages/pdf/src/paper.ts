// Paper sizes a plot's page takes exactly (FR-P1: "PDF page size exact"): ISO 216 A sizes and
// ANSI Y14.1 sheets, in millimetres, portrait (width ≤ height). The PLOT dialog (M2-17) offers
// them; a layout's own paper size from its PLOTSETTINGS needs no table.

import { POINTS_PER_MM } from './linetypes';

export interface PaperSize {
  readonly name: string;
  /** Millimetres, portrait. */
  readonly width: number;
  readonly height: number;
}

export const PAPER_SIZES: readonly PaperSize[] = [
  { name: 'ISO A0', width: 841, height: 1189 },
  { name: 'ISO A1', width: 594, height: 841 },
  { name: 'ISO A2', width: 420, height: 594 },
  { name: 'ISO A3', width: 297, height: 420 },
  { name: 'ISO A4', width: 210, height: 297 },
  { name: 'ANSI A', width: 215.9, height: 279.4 },
  { name: 'ANSI B', width: 279.4, height: 431.8 },
  { name: 'ANSI C', width: 431.8, height: 558.8 },
  { name: 'ANSI D', width: 558.8, height: 863.6 },
  { name: 'ANSI E', width: 863.6, height: 1117.6 },
];

/** A paper size by name, case-insensitive. */
export function paperSize(name: string): PaperSize | undefined {
  const key = name.toUpperCase();
  return PAPER_SIZES.find((p) => p.name.toUpperCase() === key);
}

/** Millimetres → PDF points. */
export const mmToPoints = (mm: number): number => mm * POINTS_PER_MM;
