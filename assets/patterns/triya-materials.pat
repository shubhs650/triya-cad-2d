;; Triya CAD 2D bundled material and architectural hatch patterns (MIT, see
;; LICENSE). Authored for Triya in the .pat format AutoCAD documents
;; ("Overview of Hatch Pattern Definitions"); not derived from any Autodesk
;; file. Generated from the motifs in packages/hatch/src/materials.ts: edit
;; those, not this file.
;;
;; Lengths are millimetres: hatch a drawing in inches at a pattern scale of
;; 1/25.4. Each line: angle, x-origin, y-origin, delta-x (along), delta-y
;; (across), dashes. Each stroke of a motif is a family of its own, dashed so it
;; repeats once in every tile.
;;
;; Steel (ASME Y14.2 section lining): 45 degree lines in pairs about 1 mm apart,
;; the pairs 4.24 mm apart (a 6 mm square lattice).
*TRIYA_STEEL, Steel, pairs of 45 degree lines
45, 0,0, 4.2426407,4.2426407
45, 1.5,0, 4.2426407,4.2426407
;;
;; Bronze, brass and copper (ASME Y14.2 section lining): 45 degree lines, every
;; other one dashed (2.12 mm dashes and gaps), 2.12 mm apart.
*TRIYA_BRONZE, Bronze, brass, copper: solid and dashed 45 degree lines
45, 0,0, 4.2426407,4.2426407
45, 3,0, 4.2426407,4.2426407, 2.1213203,-6.363961
45, 6,3, 4.2426407,4.2426407, 2.1213203,-6.363961
;;
;; Plastic, rubber and electrical insulation: 45 degree lines in groups of three
;; 0.71 mm apart, the groups 5.66 mm apart. Standards draw this symbol
;; differently; Triya's groups of three read apart from steel's pairs.
*TRIYA_PLASTIC, Plastic and rubber, 45 degree lines in threes
45, 0,0, 5.6568542,5.6568542
45, 1,0, 5.6568542,5.6568542
45, 2,0, 5.6568542,5.6568542
;;
;; Concrete in section: small triangles of aggregate and dots of sand, scattered
;; over a 12 mm tile. Reinforced concrete: add TRIYA_LINES45 over it.
*TRIYA_CONCRETE, Concrete, aggregate and sand
26.5650512, 1.5,2, 16.0996894,5.3665631, 1.7888544,-25.0439613
-45, 2.3,3.6, 8.4852814,8.4852814, 1.1313708,-15.8391919
63.4349488, 1.5,2, 10.7331263,5.3665631, 1.7888544,-25.0439613
0, 7,6.5, 0,12, 1.4,-10.6
-63.4349488, 7.7,7.9, 16.0996894,5.3665631, 1.5652476,-25.2675681
63.4349488, 7,6.5, 10.7331263,5.3665631, 1.5652476,-25.2675681
63.4349488, 3.5,8.5, 10.7331263,5.3665631, 1.3416408,-25.4911749
26.5650512, 2.9,9.1, 16.0996894,5.3665631, 1.3416408,-25.4911749
-45, 2.9,9.1, 8.4852814,8.4852814, 0.8485281,-16.1220346
26.5650512, 9.5,1.5, 16.0996894,5.3665631, 1.3416408,-25.4911749
-33.6900675, 9.8,2.7, 26.6256094,3.3282012, 1.0816654,-42.1849499
75.9637565, 9.5,1.5, 11.64171,2.9104275, 1.2369317,-48.2403358
26.5650512, 9,9, 16.0996894,5.3665631, 1.3416408,-25.4911749
-45, 9.3,10.5, 8.4852814,8.4852814, 1.2727922,-15.6977705
78.6900675, 9,9, 11.7669681,2.3533936, 1.5297059,-59.6585283
0, 5,4.5, 0,12, 0,-12
0, 10.6,4.4, 0,12, 0,-12
0, 1.2,6.2, 0,12, 0,-12
0, 8.2,11, 0,12, 0,-12
0, 5.8,10.8, 0,12, 0,-12
0, 11,7.6, 0,12, 0,-12
0, 4.6,1.2, 0,12, 0,-12
0, 5.6,6.8, 0,12, 0,-12
;;
;; Concrete masonry units in running bond on a 400 x 200 mm module (390 x 190 mm
;; blocks, 10 mm joints): bed joints every course, head joints every 400 mm
;; along a course, offset half a block on the next.
*TRIYA_BLOCK, Concrete block, running bond, 400 x 200 mm module
0, 0,0, 200,200
90, 0,0, 200,200, 200,-200
;;
;; Earth (ground) in section: groups of three 2.2 mm strokes 1 mm apart,
;; horizontal and vertical by turns in a 3 mm checkerboard.
*TRIYA_EARTH, Earth, groups of horizontal and vertical strokes
0, 0.4,0.5, 0,6, 2.2,-3.8
0, 3.4,3.5, 0,6, 2.2,-3.8
90, 3.5,0.4, 0,6, 2.2,-3.8
90, 0.5,3.4, 0,6, 2.2,-3.8
0, 0.4,1.5, 0,6, 2.2,-3.8
0, 3.4,4.5, 0,6, 2.2,-3.8
90, 4.5,0.4, 0,6, 2.2,-3.8
90, 1.5,3.4, 0,6, 2.2,-3.8
0, 0.4,2.5, 0,6, 2.2,-3.8
0, 3.4,5.5, 0,6, 2.2,-3.8
90, 5.5,0.4, 0,6, 2.2,-3.8
90, 2.5,3.4, 0,6, 2.2,-3.8
;;
;; Gravel or hardcore: stones of five shapes, 1.2 to 3.6 mm across, over a 15 mm
;; tile.
*TRIYA_GRAVEL, Gravel, rounded stones
0, 1.8,1, 0,15, 1.6,-13.4
45, 3.4,1, 10.6066017,10.6066017, 1.1313708,-20.0818326
90, 4.2,1.8, 0,15, 0.8,-14.2
-26.5650512, 2.6,3.4, 13.4164079,6.7082039, 1.7888544,-31.7521653
0, 1.8,3.4, 0,15, 0.8,-14.2
45, 1,2.6, 10.6066017,10.6066017, 1.1313708,-20.0818326
90, 1,1.8, 0,15, 0.8,-14.2
-45, 1,1.8, 10.6066017,10.6066017, 1.1313708,-20.0818326
0, 8,2, 0,15, 1.4,-13.6
63.4349488, 9.4,2, 13.4164079,6.7082039, 1.5652476,-31.9757721
-45, 9.4,4.1, 10.6066017,10.6066017, 0.9899495,-20.2232539
0, 8,4.1, 0,15, 1.4,-13.6
63.4349488, 7.3,2.7, 13.4164079,6.7082039, 1.5652476,-31.9757721
-45, 7.3,2.7, 10.6066017,10.6066017, 0.9899495,-20.2232539
-45, 3,8.9, 10.6066017,10.6066017, 1.2727922,-19.9404112
26.5650512, 3.9,8, 20.1246118,6.7082039, 2.0124612,-31.5285585
90, 5.7,8.9, 0,15, 1.8,-13.2
0, 3.9,10.7, 0,15, 1.8,-13.2
63.4349488, 3,8.9, 13.4164079,6.7082039, 2.0124612,-31.5285585
0, 10,9, 0,15, 2.4,-12.6
90, 12.4,9, 0,15, 0.8,-14.2
-45, 11.6,10.6, 10.6066017,10.6066017, 1.1313708,-20.0818326
0, 10,10.6, 0,15, 1.6,-13.4
90, 10,9, 0,15, 1.6,-13.4
-45, 7,12.6, 10.6066017,10.6066017, 0.8485281,-20.3646753
45, 7.6,12, 10.6066017,10.6066017, 0.8485281,-20.3646753
-45, 7.6,13.2, 10.6066017,10.6066017, 0.8485281,-20.3646753
45, 7,12.6, 10.6066017,10.6066017, 0.8485281,-20.3646753
;;
;; Sand, mortar and plaster: ten dots scattered over a 6 mm tile.
*TRIYA_SAND, Sand, mortar or plaster, stippled dots
0, 0.5,0.7, 0,6, 0,-6
0, 2.3,1.4, 0,6, 0,-6
0, 4.1,0.4, 0,6, 0,-6
0, 5.2,2.1, 0,6, 0,-6
0, 1.2,2.9, 0,6, 0,-6
0, 3.4,3.1, 0,6, 0,-6
0, 0.4,4.6, 0,6, 0,-6
0, 2.6,5.2, 0,6, 0,-6
0, 4.6,4.3, 0,6, 0,-6
0, 5.6,5.5, 0,6, 0,-6
;;
;; Batt (quilt) insulation: zigzag bands 6 mm deep with 4 mm teeth, rows 8 mm
;; apart. Scale it so one band fills the insulation layer.
*TRIYA_INSULATION, Batt insulation, zigzag bands
71.5650512, 0,1, 16.4438438,1.2649111, 6.3245553,-18.973666
-71.5650512, 2,7, 8.8543774,1.2649111, 6.3245553,-18.973666
;;
;; Rigid (board) insulation: 10 x 5 mm boxes, each crossed by its diagonals.
*TRIYA_INSULATION_RIGID, Rigid insulation, crossed boards
0, 0,0, 0,5
90, 0,0, 0,10
26.5650512, 0,0, 2.236068,4.472136
-26.5650512, 0,5, 8.9442719,4.472136
;;
;; Wood along the grain: gently waving lines 3 mm apart, each row out of step
;; with the next. Across the grain (rings) a .pat file cannot draw.
*TRIYA_WOOD, Wood along the grain, wavy lines
7.1250163, 0,0, 36.466212,1.4884168, 6.0466933,-42.3268532
-7.1250163, 6,0.75, 11.9073345,1.4884168, 6.0466933,-42.3268532
9.4623222, 3,3, 24.6598481,1.9727878, 6.0827625,-30.4138127
-9.4623222, 9,4, 11.8367271,1.9727878, 6.0827625,-30.4138127
;;
;; Glass and glazing: three short 45 degree strokes in every 12 mm tile.
*TRIYA_GLASS, Glass, groups of three short 45 degree strokes
45, 3,3, 8.4852814,8.4852814, 7.0710678,-9.8994949
45, 4.5,3, 8.4852814,8.4852814, 4.9497475,-12.0208153
45, 6,3, 8.4852814,8.4852814, 2.8284271,-14.1421356
;;
;; Water and other liquids: horizontal lines growing shorter downwards, 10, 6
;; and 2 mm long, 1.5 mm apart, in 6 mm rows.
*TRIYA_LIQUID, Water and other liquids, horizontal dashes
0, 0,4, 0,6, 10,-2
0, 2,2.5, 0,6, 6,-6
0, 4,1, 0,6, 2,-10
