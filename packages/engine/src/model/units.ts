// The length each `$INSUNITS` code names (AutoCAD 2024 Help, "INSUNITS (System Variable)"), in
// metres: what INSERT and PASTECLIP scale by when the drawing brought in is in other units
// (M2-32). The US survey units are the survey foot's 1200/3937 m; the astronomical ones are
// the IAU's (au 149 597 870 700 m, Julian light year, parsec = au × 648 000 / π).
const AU = 149_597_870_700;
const METRES: readonly (number | undefined)[] = [
  undefined, // 0 unitless
  0.0254, // 1 inches
  0.3048, // 2 feet
  1609.344, // 3 miles
  0.001, // 4 millimetres
  0.01, // 5 centimetres
  1, // 6 metres
  1000, // 7 kilometres
  2.54e-8, // 8 microinches
  2.54e-5, // 9 mils
  0.9144, // 10 yards
  1e-10, // 11 angstroms
  1e-9, // 12 nanometres
  1e-6, // 13 microns
  0.1, // 14 decimetres
  10, // 15 decametres
  100, // 16 hectometres
  1e9, // 17 gigametres
  AU, // 18 astronomical units
  9_460_730_472_580_800, // 19 light years
  (AU * 648_000) / Math.PI, // 20 parsecs
  1200 / 3937, // 21 US survey feet
  100 / 3937, // 22 US survey inches
  3600 / 3937, // 23 US survey yards
  6_336_000 / 3937, // 24 US survey miles
];

/** Metres in one unit of INSUNITS `code`; undefined for unitless (0) or a code AutoCAD lists not. */
export function metresPerUnit(code: number): number | undefined {
  return Number.isInteger(code) ? METRES[code] : undefined;
}

/**
 * What objects drawn in INSUNITS `from` are scaled by to be the same size in a drawing in
 * `to`: 1 where either is unitless or unknown, as AutoCAD scales nothing then (its
 * INSUNITSDEFSOURCE/INSUNITSDEFTARGET, which stood in for a unitless drawing, are obsolete).
 */
export function insUnitsScale(from: number, to: number): number {
  if (from === to) return 1;
  const a = metresPerUnit(from);
  const b = metresPerUnit(to);
  return a === undefined || b === undefined ? 1 : a / b;
}
