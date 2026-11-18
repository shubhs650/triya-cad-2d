// The bundled linetype files (M5-08): `assets/linetypes/triya-iso.lin`, `triya-utilities.lin`
// and (part 2) `triya-drafting.lin` / `triya-drafting-iso.lin`, embedded so the loader works in a worker and in Node without reading
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

export const TRIYA_DRAFTING_LIN = `;; Triya CAD 2D bundled drafting linetypes, inches (MIT, see LICENSE).
;; Authored for Triya from the line conventions of ASME Y14.2 (center, hidden and phantom lines:
;; long dashes, short dashes and gaps), written in the .lin format AutoCAD documents. Not
;; derived from any Autodesk file. The names are the drafting names AutoCAD's CENTERLTYPE and
;; other settings use (CENTER2 for center marks): "2" is half size, "X2" twice size (DEC-073).
;;
;; Lengths are inches, for a drawing in inches at LTSCALE 1; triya-drafting-iso.lin has the same
;; linetypes in millimetres (25.4 times these).
;;
*CENTER,Center line
A,1.25,-0.125,0.25,-0.125
*CENTER2,Center line (half size)
A,0.625,-0.0625,0.125,-0.0625
*CENTERX2,Center line (twice size)
A,2.5,-0.25,0.5,-0.25
*DASHED,Dashed line
A,0.5,-0.125
*DASHED2,Dashed line (half size)
A,0.25,-0.0625
*DASHEDX2,Dashed line (twice size)
A,1,-0.25
*HIDDEN,Hidden line
A,0.25,-0.125
*HIDDEN2,Hidden line (half size)
A,0.125,-0.0625
*HIDDENX2,Hidden line (twice size)
A,0.5,-0.25
*PHANTOM,Phantom line
A,1.25,-0.125,0.25,-0.125,0.25,-0.125
*PHANTOM2,Phantom line (half size)
A,0.625,-0.0625,0.125,-0.0625,0.125,-0.0625
*PHANTOMX2,Phantom line (twice size)
A,2.5,-0.25,0.5,-0.25,0.5,-0.25
`;

export const TRIYA_DRAFTING_ISO_LIN = `;; Triya CAD 2D bundled drafting linetypes, millimetres (MIT, see LICENSE).
;; Authored for Triya from the line conventions of ASME Y14.2 (center, hidden and phantom lines:
;; long dashes, short dashes and gaps), written in the .lin format AutoCAD documents. Not
;; derived from any Autodesk file. The names are the drafting names AutoCAD's CENTERLTYPE and
;; other settings use (CENTER2 for center marks): "2" is half size, "X2" twice size (DEC-073).
;;
;; Lengths are millimetres, for a drawing in millimetres at LTSCALE 1: triya-drafting.lin's
;; inches times 25.4.
;;
*CENTER,Center line
A,31.75,-3.175,6.35,-3.175
*CENTER2,Center line (half size)
A,15.875,-1.5875,3.175,-1.5875
*CENTERX2,Center line (twice size)
A,63.5,-6.35,12.7,-6.35
*DASHED,Dashed line
A,12.7,-3.175
*DASHED2,Dashed line (half size)
A,6.35,-1.5875
*DASHEDX2,Dashed line (twice size)
A,25.4,-6.35
*HIDDEN,Hidden line
A,6.35,-3.175
*HIDDEN2,Hidden line (half size)
A,3.175,-1.5875
*HIDDENX2,Hidden line (twice size)
A,12.7,-6.35
*PHANTOM,Phantom line
A,31.75,-3.175,6.35,-3.175,6.35,-3.175
*PHANTOM2,Phantom line (half size)
A,15.875,-1.5875,3.175,-1.5875,3.175,-1.5875
*PHANTOMX2,Phantom line (twice size)
A,63.5,-6.35,12.7,-6.35,12.7,-6.35
`;

/** The bundled .lin files by name, in the order the Load or Reload Linetypes dialog lists them. */
export const BUNDLED_LIN_FILES: readonly { readonly name: string; readonly source: string }[] = [
  { name: 'triya-iso.lin', source: TRIYA_ISO_LIN },
  { name: 'triya-utilities.lin', source: TRIYA_UTILITIES_LIN },
  { name: 'triya-drafting.lin', source: TRIYA_DRAFTING_LIN },
  { name: 'triya-drafting-iso.lin', source: TRIYA_DRAFTING_ISO_LIN },
];
