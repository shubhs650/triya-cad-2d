// The bundled linetype files (M5-08): `assets/linetypes/triya-iso.lin` and
// `triya-utilities.lin`, embedded so the loader works in a worker and in Node without reading
// files, as the bundled hatch patterns are (`@triya/hatch` bundled.ts). A test keeps them equal.

export const TRIYA_ISO_LIN = `;; Triya CAD 2D bundled linetypes (MIT, see LICENSE).
;; Authored for Triya from the line type definitions of ISO 128-20 (basic line types 02-15),
;; written in the .lin format AutoCAD documents. Not derived from any Autodesk file.
;;
;; Lengths are in multiples of the line width d, for d = 1 mm: set LTSCALE (or the object's
;; linetype scale) to the line width in drawing units, e.g. 0.35 for a 0.35 mm pen in a
;; drawing in millimetres. Dots are drawn as 0-length dashes, which take the line's width.
;;
*TRIYA_ISO02,ISO 02 dashed
A,12,-3
*TRIYA_ISO03,ISO 03 dashed spaced
A,12,-18
*TRIYA_ISO04,ISO 04 long-dashed dotted
A,24,-3,0,-3
*TRIYA_ISO05,ISO 05 long-dashed double-dotted
A,24,-3,0,-3,0,-3
*TRIYA_ISO06,ISO 06 long-dashed triplicate-dotted
A,24,-3,0,-3,0,-3,0,-3
*TRIYA_ISO07,ISO 07 dotted
A,0,-3
*TRIYA_ISO08,ISO 08 long-dashed short-dashed
A,24,-3,6,-3
*TRIYA_ISO09,ISO 09 long-dashed double-short-dashed
A,24,-3,6,-3,6,-3
*TRIYA_ISO10,ISO 10 dashed dotted
A,12,-3,0,-3
*TRIYA_ISO11,ISO 11 double-dashed dotted
A,12,-3,12,-3,0,-3
*TRIYA_ISO12,ISO 12 dashed double-dotted
A,12,-3,0,-3,0,-3
*TRIYA_ISO13,ISO 13 double-dashed double-dotted
A,12,-3,12,-3,0,-3,0,-3
*TRIYA_ISO14,ISO 14 dashed triplicate-dotted
A,12,-3,0,-3,0,-3,0,-3
*TRIYA_ISO15,ISO 15 double-dashed triplicate-dotted
A,12,-3,12,-3,0,-3,0,-3,0,-3
`;

export const TRIYA_UTILITIES_LIN = `;; Triya CAD 2D bundled utility linetypes (MIT, see LICENSE). Authored for Triya in the
;; complex linetype format AutoCAD documents ("About Text in Custom Linetypes"). Not derived
;; from any Autodesk file.
;;
;; Lengths are millimetres, for a drawing in millimetres at LTSCALE 1. Each line carries its
;; letters in the Standard text style, 2.5 mm high, upright (U=0), centred on the line in a
;; 9 mm gap between 12 mm dashes.
;;
*TRIYA_GAS,Gas line ----GAS----GAS----
A,12,-1.5,["GAS",Standard,S=2.5,U=0,X=0,Y=-1.25],-7.5
*TRIYA_WATER,Water line ----W----W----
A,12,-3.5,["W",Standard,S=2.5,U=0,X=0,Y=-1.25],-5.5
*TRIYA_HOT_WATER,Hot water line ----HW----HW----
A,12,-2.5,["HW",Standard,S=2.5,U=0,X=0,Y=-1.25],-6.5
`;

/** The bundled .lin files by name, in the order the Load or Reload Linetypes dialog lists them. */
export const BUNDLED_LIN_FILES: readonly { readonly name: string; readonly source: string }[] = [
  { name: 'triya-iso.lin', source: TRIYA_ISO_LIN },
  { name: 'triya-utilities.lin', source: TRIYA_UTILITIES_LIN },
];
