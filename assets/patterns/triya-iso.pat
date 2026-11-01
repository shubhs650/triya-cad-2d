;; Triya CAD 2D bundled hatch patterns (MIT, see LICENSE). Authored for Triya in
;; the .pat format AutoCAD documents ("Overview of Hatch Pattern Definitions"),
;; from the geometry each comment states. Not derived from any Autodesk file.
;;
;; Lengths are millimetres: hatch a drawing in inches at a pattern scale of
;; 1/25.4. Each line: angle, x-origin, y-origin, delta-x (along), delta-y
;; (across), dashes.
;;
;; Section lining (ISO 128-50): thin continuous lines, 45 degrees to the outline
;; or axis by preference, the other way (135) for an adjacent part. ISO leaves
;; the spacing to the size of the area; 3 mm suits most parts at 1:1.
*TRIYA_LINES45, Lines at 45 degrees, 3 mm apart
45, 0,0, 0,3
*TRIYA_LINES135, Lines at 135 degrees, 3 mm apart
135, 0,0, 0,3
*TRIYA_LINES0, Horizontal lines, 3 mm apart
0, 0,0, 0,3
*TRIYA_LINES90, Vertical lines, 3 mm apart
90, 0,0, 0,3
;; Two and three families through one origin.
*TRIYA_CROSS45, Lines at 45 and 135 degrees, 3 mm apart
45, 0,0, 0,3
135, 0,0, 0,3
*TRIYA_GRID, Square grid, 3 mm
0, 0,0, 0,3
90, 0,0, 0,3
;; Lines at 0, 60 and 120 degrees, 3 sin 60 apart, meet in equilateral triangles
;; of side 3.
*TRIYA_TRIANGLES, Equilateral triangles, 3 mm sides
0, 0,0, 0,2.598076211
60, 0,0, 0,2.598076211
120, 0,0, 0,2.598076211
;; Dots: a 3 mm square grid of dots; dashes: 3 mm dashes and gaps, each line
;; shifted half a repetition along from the one below.
*TRIYA_DOTS, Dots on a 3 mm grid
0, 0,0, 0,3, 0,-3
*TRIYA_DASH, Staggered 3 mm dashes, lines 3 mm apart
0, 0,0, 3,3, 3,-3
;; Running (stretcher) bond on a 225 x 75 mm brick module (215 x 65 brick, 10 mm
;; joints): bed joints every course; head joints every 225 along a course,
;; offset half a brick on the next.
*TRIYA_BRICK, Running bond brickwork, 225 x 75 mm module
0, 0,0, 0,75
90, 0,0, 75,112.5, 75,-75
;; The line types of ISO 128-20 (as in triya-iso.lin, line width d = 1 mm) as
;; horizontal lines 5 mm apart.
*TRIYA_ISO02W100, ISO 02 dashed lines, 5 mm apart
0, 0,0, 0,5, 12,-3
*TRIYA_ISO03W100, ISO 03 dashed spaced lines, 5 mm apart
0, 0,0, 0,5, 12,-18
*TRIYA_ISO04W100, ISO 04 long-dashed dotted lines, 5 mm apart
0, 0,0, 0,5, 24,-3,0,-3
*TRIYA_ISO05W100, ISO 05 long-dashed double-dotted lines, 5 mm apart
0, 0,0, 0,5, 24,-3,0,-3,0,-3
*TRIYA_ISO06W100, ISO 06 long-dashed triplicate-dotted lines, 5 mm apart
0, 0,0, 0,5, 24,-3,0,-3,0,-3,0,-3
*TRIYA_ISO07W100, ISO 07 dotted lines, 5 mm apart
0, 0,0, 0,5, 0,-3
*TRIYA_ISO08W100, ISO 08 long-dashed short-dashed lines, 5 mm apart
0, 0,0, 0,5, 24,-3,6,-3
*TRIYA_ISO09W100, ISO 09 long-dashed double-short-dashed lines, 5 mm apart
0, 0,0, 0,5, 24,-3,6,-3,6,-3
*TRIYA_ISO10W100, ISO 10 dashed dotted lines, 5 mm apart
0, 0,0, 0,5, 12,-3,0,-3
*TRIYA_ISO11W100, ISO 11 double-dashed dotted lines, 5 mm apart
0, 0,0, 0,5, 12,-3,12,-3,0,-3
*TRIYA_ISO12W100, ISO 12 dashed double-dotted lines, 5 mm apart
0, 0,0, 0,5, 12,-3,0,-3,0,-3
*TRIYA_ISO13W100, ISO 13 double-dashed double-dotted lines, 5 mm apart
0, 0,0, 0,5, 12,-3,12,-3,0,-3,0,-3
*TRIYA_ISO14W100, ISO 14 dashed triplicate-dotted lines, 5 mm apart
0, 0,0, 0,5, 12,-3,0,-3,0,-3,0,-3
*TRIYA_ISO15W100, ISO 15 double-dashed triplicate-dotted lines, 5 mm apart
0, 0,0, 0,5, 12,-3,12,-3,0,-3,0,-3,0,-3
