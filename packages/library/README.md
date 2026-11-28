# @triya/library

Pressure-vessel symbol generators: standard flanges, nozzles, supports, weld symbols and notes,
drawn as 2D blocks to scale (PRD FR-Z1). Runs in Node and in a worker; no DOM.

## Nozzle details and vessel supports (M8-02)

Each is a `DetailGenerator`: its principal dimensions (`fields`, lengths in drawing units and
angles in degrees, an optional one 0 for without), `defaults` in inches (`detailDefaults(g,
drawingScale(model))` for a drawing), `checkDetail(g, spec)` naming the first rule a set breaks,
and `parts(spec)`. `addDetailBlock(builder, model, g, spec)` adds it as a block named by its
dimensions (`TRIYA_SADDLE_D60_H42_A120_…`), or finds the drawing's own (DEC-090).

| Generator       | View                       | Base point                                   | Dimensions                                                                                                        |
| --------------- | -------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `NOZZLE_SET_IN` | section on the axis        | axis at the shell's outside                  | neck OD and thickness, shell thickness, projection, internal projection, pad diameter and thickness, weld leg, shell length shown |
| `NOZZLE_SET_ON` | section on the axis        | axis at the shell's outside                  | as set-in, without the internal projection                                                                        |
| `SADDLE`        | end view                   | vessel axis                                  | vessel OD, height to the axis, contact angle, base length and thickness, top plate, wear plate thickness and angle, bolt spacing and hole |
| `LEG`           | elevation                  | vessel axis on the floor                     | vessel OD, leg height and width, base plate width and thickness, hole                                             |
| `BRACKET`       | elevation                  | vessel axis on the bearing level             | vessel OD, projection, height, base thickness, gusset end, hole and its offset, pad thickness and height          |
| `SKIRT`         | elevation                  | skirt axis on the foundation                 | skirt OD, thickness and height, base ring OD, ID and thickness, bolt circle and hole, access opening and height    |
| `ANCHOR_CHAIR`  | elevation from outside     | bolt centre on the foundation                | hole, gusset spacing and thickness, chair height, top plate width and thickness, base ring thickness and length shown |

These are drafting outlines, not designs: the dimensions are the drafter's (a saddle's contact
angle, say, from L. P. Zick's analysis or the vessel code), and the checks only refuse parts
that cannot be drawn (a bolt hole off its plate, a neck thicker than its radius).

## ASME B16.5 flanges (M8-01)

`b165Flange({ flangeClass, nps, type, schedule? })` gives a flange's dimensions in inches for
Classes 150 to 2500, NPS ½ to 24, and the six types (weld neck `WN`, slip-on `SO`, blind `BL`,
lap joint `LJ`, socket welding `SW`, threaded `TH`), or undefined where B16.5 has no such
flange. `flangeParts(d, view, scale)` draws it as its `front` (face), `side` (elevation) or
`section` view; `addFlangeBlock(builder, model, spec, view)` adds it to a drawing as a block
named `ASME_B16.5_<type>_CL<class>_NPS<size>[_SCH<schedule>]_<VIEW>`, in the drawing's units
(DEC-089).

### Provenance

The dimensions are B16.5-2020's inch tables (Mandatory Appendix II), as two decimals, the way
the standard prints them. They were transcribed on 2026-11-28 from Texas Flange's published
B16.5 charts (texasflange.com, "ASME B16.5 Class N Flange Dimensions", one page per class) and
checked against:

| Source                                                                    | What it covers                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| engineeringtoolbox.com, "ASME/ANSI B16.5 Flanges and Bolt Dimensions"     | O, bolt count, bolt and hole diameter, bolt circle: every class and size              |
| engineeringtoolbox.com, the Class 150, 300, 400, 600, 900 and 1500 pages  | O, hole count and diameter, bolt circle                                               |
| apiint.com, Class 150 and 300 weld neck, slip-on and blind charts         | tf, Y, X, A, R, bolting (slip-on and blind thicknesses include the 1/16 in. face)     |
| rtd.thermometricscorp.com, "Dimensions for Class 900 / 1500 Flanges"      | every column of the Class 900 and 1500 charts                                         |
| amesweb.info, Class 150 (millimetres)                                     | tf, lap joint thickness, X, A, Y, bores: within 0.04 in. of the metric values converted |

Nine values disagreed. The value two or more sources share was kept; where only two sources had
the value, Texas Flange's (it fits the sizes either side):

| Value                               | Kept               | Other                       |
| ----------------------------------- | ------------------ | --------------------------- |
| Class 400 NPS 1 bolt holes          | 0.75 (three)       | 0.075 (Texas Flange, typo)  |
| Class 900 NPS 16 bolt circle        | 24.25 (three)      | 24.50 (bolting table)       |
| Class 150 NPS 10 / 14 hub X         | 12.00 / 15.75 (two) | 12.06 / 15.78 (apiint)     |
| Class 150 NPS 22 hub X              | 24.25 (Texas)      | 24.00 (apiint)              |
| Class 150 NPS 22 thickness          | 1.75 (Texas)       | 1.78 (apiint)               |
| Class 300 NPS ½ bolt holes          | 0.62 (two)         | 0.75 (apiint)               |
| Class 300 NPS 22 bolt circle        | 29.25 (two)        | 29.50 (apiint)              |
| Class 1500 NPS 18 weld neck Y       | 12.88 (Texas; rises with size) | 12.00 (Thermometrics) |

engineeringtoolbox's per-class pages also differ from its own bolting table and from the others
in four places (Class 400 NPS 4 bolt circle, Class 600 NPS 5 and 6 holes, Class 900 NPS 3
holes); the bolting table, Texas Flange and Thermometrics agree there and were kept.

Class 150 NPS 22's hub and thickness rest on one source each way: a drafter checking a sample against
their copy of B16.5 should start there. B16.5's rules the tables follow, and the tests check:
Class 400 under NPS 4 takes the Class 600 flange and Class 900 under NPS 3 the Class 1500
(the standard's notes); no NPS 3½ or 22 in Classes 900 and up, Class 2500 stops at NPS 12;
socket welding flanges NPS ½ to 3 only (2½ in Classes 900 and 1500, none in 2500); slip-on
none in Class 2500 and to NPS 2½ in 1500; threaded to NPS 2½ in Classes 1500 and 2500.

The weld neck and socket welding bores are pipe inside diameters by schedule (ASME B36.10M, the
same charts' bore table), standard wall unless asked for another.
