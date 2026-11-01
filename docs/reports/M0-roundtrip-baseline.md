<!-- Snapshot of test-results/roundtrip/report.md from the M0-05 PR (#5), acad-ts @315f3d8 + patch 0001. Regenerate with pnpm corpus:roundtrip; the live numbers are in corpus/roundtrip-baseline.json. -->
# M0 round-trip baseline: public corpus

open → save (same version and format) → reopen → `structuralDiff` (docs/TESTING.md §3). Expected end state: every file `clean`.

**119 files:** clean 0 · diff 118 · read-error 1 · write-error 0 · reread-error 0

## Differences by object type and property (all files)

| Object · path | Differences | Files |
|---|---:|---:|
| `DICTIONARY _entries[]` | 2540 | 108 |
| `DICTIONARY _entryNames[]` | 2282 | 105 |
| `HEADER $PSTYLEMODE` | 100 | 100 |
| `DICTIONARY <missing>` | 1314 | 97 |
| `DICTIONARY <added>` | 363 | 97 |
| `HEADER $EXTMAX.x` | 94 | 94 |
| `HEADER $EXTMAX.y` | 94 | 94 |
| `VPORT viewMode` | 93 | 93 |
| `HEADER $PLIMMAX.x` | 91 | 91 |
| `HEADER $PLIMMAX.y` | 91 | 91 |
| `HEADER _dimensionStyleOverrides.separateArrowBlocks` | 90 | 90 |
| `HEADER _shadeEdge` | 90 | 90 |
| `HEADER $LIMMAX.x` | 90 | 90 |
| `HEADER $LIMMAX.y` | 90 | 90 |
| `HEADER $REGENMODE` | 90 | 90 |
| `HEADER $SPLINETYPE` | 90 | 90 |
| `HEADER $TRACEWID` | 90 | 90 |
| `HEADER $USRTIMER` | 90 | 90 |
| `HEADER $VISRETAIN` | 89 | 89 |
| `HEADER $EXTMIN.y` | 87 | 87 |
| `HEADER $TILEMODE` | 87 | 87 |
| `HEADER $TREEDEPTH` | 85 | 85 |
| `LAYER plotStyleName` | 380 | 83 |
| `MATERIAL <missing>` | 345 | 83 |
| `LAYOUT layoutFlags` | 227 | 81 |
| `HEADER _dimensionStyleOverrides.decimalSeparator` | 81 | 81 |
| `HEADER $XEDIT` | 81 | 81 |
| `HEADER $LASTSAVEDBY` | 74 | 74 |
| `HEADER $SORTENTS` | 74 | 74 |
| `HEADER $EXTMIN.x` | 73 | 73 |
| `HEADER $3DDWFPREC` | 71 | 71 |
| `HEADER $DGNFRAME` | 71 | 71 |
| `HEADER $DIMLTEX1` | 71 | 71 |
| `HEADER $DIMLTEX2` | 71 | 71 |
| `HEADER $DIMLTYPE` | 71 | 71 |
| `HEADER $DWFFRAME` | 71 | 71 |
| `HEADER $LENSLENGTH` | 71 | 71 |
| `HEADER $LIGHTGLYPHDISPLAY` | 71 | 71 |
| `HEADER $LOFTANG1` | 71 | 71 |
| `HEADER $LOFTANG2` | 71 | 71 |
| `HEADER $LOFTNORMALS` | 71 | 71 |
| `HEADER $LOFTPARAM` | 71 | 71 |
| `HEADER $PSOLHEIGHT` | 71 | 71 |
| `HEADER $PSOLWIDTH` | 71 | 71 |
| `HEADER $SHOWHIST` | 71 | 71 |
| `HEADER $STEPSIZE` | 71 | 71 |
| `HEADER $ACADMAINTVER` | 70 | 70 |
| `HEADER $PEXTMAX.x` | 69 | 69 |
| `HEADER $PEXTMAX.y` | 69 | 69 |
| `HEADER $PEXTMIN.x` | 69 | 69 |
| `HEADER $PEXTMIN.y` | 69 | 69 |
| `HEADER $TIMEZONE` | 69 | 69 |
| `DIMSTYLE extensionLineWeight` | 190 | 67 |
| `DIMSTYLE dimensionLineWeight` | 178 | 67 |
| `VISUALSTYLE <missing>` | 1493 | 62 |
| `CELLSTYLEMAP cellStyles[].bottomMargin` | 186 | 62 |
| `CELLSTYLEMAP cellStyles[].marginHorizontalSpacing` | 186 | 62 |
| `CELLSTYLEMAP cellStyles[].marginVerticalSpacing` | 186 | 62 |
| `CELLSTYLEMAP cellStyles[].rightMargin` | 186 | 62 |
| `TABLESTYLE cellStyles[].backgroundColor._color` | 186 | 62 |

## Per file

| File | Version | Format | Status | Differences | Objects (orig → reopened) | Top paths / error |
|---|---|---|---|---:|---|---|
| acadsharp/aec_objects/AecObjects.dwg | R2018 | dwg | diff | 42 | 320 → 320 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`BLOCK_RECORD ownedObjectHandles[]` ×2<br>`BLOCK_RECORD preview` ×2 |
| acadsharp/dynamic-blocks/BLOCKALIGNMENTPARAMETER.dwg | R2018 | dwg | diff | 39 | 156 → 154 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`LAYOUT maxLimits.x` ×3<br>`LAYOUT maxLimits.y` ×3 |
| acadsharp/dynamic-blocks/BLOCKALIGNMENTPARAMETER.dxf | R2018 | dxf-ascii | diff | 221 | 158 → 115 | `DICTIONARY _entries[]` ×33<br>`DICTIONARY _entryNames[]` ×30<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/dynamic-blocks/BLOCKBASEPOINTPARAMETER.dwg | R2018 | dwg | diff | 39 | 155 → 153 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`LAYOUT maxLimits.x` ×3<br>`LAYOUT maxLimits.y` ×3 |
| acadsharp/dynamic-blocks/BLOCKBASEPOINTPARAMETER.dxf | R2018 | dxf-ascii | diff | 218 | 157 → 114 | `DICTIONARY _entries[]` ×33<br>`DICTIONARY _entryNames[]` ×30<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/dynamic-blocks/BLOCKFLIPPARAMETER.dwg | R2018 | dwg | diff | 45 | 186 → 182 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`DICTIONARY _entries[]` ×4<br>`DICTIONARY _entryNames[]` ×4 |
| acadsharp/dynamic-blocks/BLOCKFLIPPARAMETER.dxf | R2018 | dxf-ascii | diff | 226 | 188 → 143 | `DICTIONARY _entries[]` ×35<br>`DICTIONARY _entryNames[]` ×32<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/dynamic-blocks/BLOCKLINEARPARAMETER.dwg | R2018 | dwg | diff | 42 | 172 → 169 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`DICTIONARY _entries[]` ×3<br>`DICTIONARY _entryNames[]` ×3 |
| acadsharp/dynamic-blocks/BLOCKLINEARPARAMETER.dxf | R2018 | dxf-ascii | diff | 224 | 174 → 130 | `DICTIONARY _entries[]` ×34<br>`DICTIONARY _entryNames[]` ×31<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/dynamic-blocks/BLOCKLOOKUPPARAMETER.dwg | R2018 | dwg | diff | 51 | 340 → 334 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`DICTIONARY _entries[]` ×6<br>`DICTIONARY _entryNames[]` ×6 |
| acadsharp/dynamic-blocks/BLOCKLOOKUPPARAMETER.dxf | R2018 | dxf-ascii | diff | 232 | 342 → 295 | `DICTIONARY _entries[]` ×37<br>`DICTIONARY _entryNames[]` ×34<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/dynamic-blocks/BLOCKPOINTPARAMETER.dwg | R2018 | dwg | diff | 44 | 190 → 186 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`DICTIONARY _entries[]` ×4<br>`DICTIONARY _entryNames[]` ×4 |
| acadsharp/dynamic-blocks/BLOCKPOINTPARAMETER.dxf | R2018 | dxf-ascii | diff | 227 | 192 → 147 | `DICTIONARY _entries[]` ×35<br>`DICTIONARY _entryNames[]` ×32<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/dynamic-blocks/BLOCKPOLARPARAMETER.dwg | R2018 | dwg | diff | 48 | 222 → 217 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`DICTIONARY _entries[]` ×5<br>`DICTIONARY _entryNames[]` ×5 |
| acadsharp/dynamic-blocks/BLOCKPOLARPARAMETER.dxf | R2018 | dxf-ascii | diff | 224 | 176 → 132 | `DICTIONARY _entries[]` ×34<br>`DICTIONARY _entryNames[]` ×31<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/dynamic-blocks/BLOCKROTATIONPARAMETER.dwg | R2018 | dwg | diff | 48 | 210 → 205 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`DICTIONARY _entries[]` ×5<br>`DICTIONARY _entryNames[]` ×5 |
| acadsharp/dynamic-blocks/BLOCKROTATIONPARAMETER.dxf | R2018 | dxf-ascii | diff | 232 | 212 → 166 | `DICTIONARY _entries[]` ×36<br>`DICTIONARY _entryNames[]` ×33<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/dynamic-blocks/BLOCKVISIBILITYPARAMETER.dwg | R2018 | dwg | diff | 50 | 292 → 286 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`DICTIONARY _entries[]` ×6<br>`DICTIONARY _entryNames[]` ×6 |
| acadsharp/dynamic-blocks/BLOCKVISIBILITYPARAMETER.dxf | R2018 | dxf-ascii | diff | 229 | 294 → 247 | `DICTIONARY _entries[]` ×37<br>`DICTIONARY _entryNames[]` ×34<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/dynamic-blocks/BLOCKXYPARAMETER.dwg | R2018 | dwg | diff | 45 | 212 → 208 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`DICTIONARY _entries[]` ×4<br>`DICTIONARY _entryNames[]` ×4 |
| acadsharp/dynamic-blocks/BLOCKXYPARAMETER.dxf | R2018 | dxf-ascii | diff | 227 | 214 → 169 | `DICTIONARY _entries[]` ×35<br>`DICTIONARY _entryNames[]` ×32<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/geolocation/geoloc_AC1021.dxf | R2007 | dxf-ascii | diff | 268 | 208 → 118 | `DICTIONARY <missing>` ×35<br>`DICTIONARY _entries[]` ×32<br>`XRECORD <missing>` ×31 |
| acadsharp/geolocation/geoloc.dwg | R2018 | dwg | diff | 32 | 147 → 147 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`LAYOUT maxLimits.x` ×3<br>`LAYOUT maxLimits.y` ×3 |
| acadsharp/geolocation/geoloc.dxf | R2018 | dxf-ascii | diff | 215 | 149 → 108 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×24 |
| acadsharp/sample_AC1009_ascii.dxf | R12 | dxf-ascii | diff | 3066 | 2785 → 2781 | `LINE owner` ×1324<br>`SOLID owner` ×345<br>`POLYLINE owner` ×312 |
| acadsharp/sample_AC1009_binary.dxf | R12 | dxf-binary | diff | 3065 | 2785 → 2781 | `LINE owner` ×1324<br>`SOLID owner` ×345<br>`POLYLINE owner` ×312 |
| acadsharp/sample_AC1014.dwg | R14 | dwg | diff | 133 | 1132 → 1128 | `BLOCK_RECORD ownedObjectHandles[]` ×87<br>`SORTENTSTABLE _sorters[].entity` ×8<br>`SORTENTSTABLE _sorters[].sortHandle` ×8 |
| acadsharp/sample_AC1015_ascii.dxf | R2000 | dxf-ascii | diff | 912 | 911 → 708 | `XRECORD <missing>` ×110<br>`BLOCK_RECORD ownedObjectHandles[]` ×97<br>`DICTIONARY <missing>` ×50 |
| acadsharp/sample_AC1015_binary.dxf | R2000 | dxf-binary | diff | 928 | 911 → 708 | `XRECORD <missing>` ×110<br>`BLOCK_RECORD ownedObjectHandles[]` ×97<br>`DICTIONARY <missing>` ×50 |
| acadsharp/sample_AC1015.dwg | R2000 | dwg | diff | 208 | 938 → 934 | `BLOCK_RECORD ownedObjectHandles[]` ×156<br>`SORTENTSTABLE _sorters[].entity` ×8<br>`SORTENTSTABLE _sorters[].sortHandle` ×8 |
| acadsharp/sample_AC1018_ascii.dxf | R2004 | dxf-ascii | diff | 912 | 881 → 678 | `XRECORD <missing>` ×110<br>`BLOCK_RECORD ownedObjectHandles[]` ×97<br>`DICTIONARY <missing>` ×50 |
| acadsharp/sample_AC1018_binary.dxf | R2004 | dxf-binary | diff | 928 | 883 → 680 | `XRECORD <missing>` ×110<br>`BLOCK_RECORD ownedObjectHandles[]` ×97<br>`DICTIONARY <missing>` ×50 |
| acadsharp/sample_AC1018.dwg | R2004 | dwg | diff | 184 | 911 → 907 | `ACAD_TABLE _content.rows[].cells[].styleOverride.textHeight` ×21<br>`HATCH gradientColor.colors[].color._color` ×16<br>`LINE color._color` ×10 |
| acadsharp/sample_AC1021_ascii.dxf | R2007 | dxf-ascii | diff | 965 | 866 → 672 | `XRECORD <missing>` ×99<br>`BLOCK_RECORD ownedObjectHandles[]` ×97<br>`DICTIONARY <missing>` ×50 |
| acadsharp/sample_AC1021_binary.dxf | R2007 | dxf-binary | diff | 981 | 870 → 676 | `XRECORD <missing>` ×99<br>`BLOCK_RECORD ownedObjectHandles[]` ×97<br>`DICTIONARY <missing>` ×50 |
| acadsharp/sample_AC1021.dwg | R2007 | dwg | diff | 185 | 865 → 861 | `ACAD_TABLE _content.rows[].cells[].styleOverride.textHeight` ×21<br>`HATCH gradientColor.colors[].color._color` ×16<br>`LINE color._color` ×10 |
| acadsharp/sample_AC1024_ascii.dxf | R2010 | dxf-ascii | diff | 997 | 856 → 662 | `XRECORD <missing>` ×99<br>`BLOCK_RECORD ownedObjectHandles[]` ×97<br>`DICTIONARY <missing>` ×50 |
| acadsharp/sample_AC1024_binary.dxf | R2010 | dxf-binary | diff | 1013 | 861 → 667 | `XRECORD <missing>` ×99<br>`BLOCK_RECORD ownedObjectHandles[]` ×97<br>`DICTIONARY <missing>` ×50 |
| acadsharp/sample_AC1024.dwg | R2010 | dwg | diff | 131 | 862 → 858 | `HATCH gradientColor.colors[].color._color` ×16<br>`LINE color._color` ×10<br>`SORTENTSTABLE _sorters[].entity` ×8 |
| acadsharp/sample_AC1027_ascii.dxf | R2013 | dxf-ascii | diff | 949 | 805 → 659 | `BLOCK_RECORD ownedObjectHandles[]` ×97<br>`XRECORD <missing>` ×75<br>`DICTIONARY _entries[]` ×46 |
| acadsharp/sample_AC1027_binary.dxf | R2013 | dxf-binary | diff | 965 | 810 → 664 | `BLOCK_RECORD ownedObjectHandles[]` ×97<br>`XRECORD <missing>` ×75<br>`DICTIONARY _entries[]` ×46 |
| acadsharp/sample_AC1027.dwg | R2013 | dwg | diff | 155 | 804 → 800 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`HATCH gradientColor.colors[].color._color` ×16<br>`LINE color._color` ×10 |
| acadsharp/sample_AC1032_ascii.dxf | R2018 | dxf-ascii | diff | 965 | 793 → 648 | `BLOCK_RECORD ownedObjectHandles[]` ×97<br>`XRECORD <missing>` ×75<br>`DICTIONARY _entries[]` ×45 |
| acadsharp/sample_AC1032_binary.dxf | R2018 | dxf-binary | diff | 982 | 798 → 653 | `BLOCK_RECORD ownedObjectHandles[]` ×97<br>`XRECORD <missing>` ×75<br>`DICTIONARY _entries[]` ×45 |
| acadsharp/sample_AC1032.dwg | R2018 | dwg | diff | 157 | 792 → 788 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`HATCH gradientColor.colors[].color._color` ×16<br>`LINE color._color` ×10 |
| acadsharp/sample_base/empty.dwg | R2018 | dwg | diff | 32 | 143 → 143 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`LAYOUT maxLimits.x` ×3<br>`LAYOUT maxLimits.y` ×3 |
| acadsharp/sample_base/sample_base.dwg | R2018 | dwg | diff | 157 | 792 → 788 | `VISUALSTYLE dwgExtendedProperties[].value._color` ×24<br>`HATCH gradientColor.colors[].color._color` ×16<br>`LINE color._color` ×10 |
| ezdxf/examples_dxf/3dface.dxf | R2018 | dxf-ascii | diff | 300 | 217 → 175 | `DICTIONARY _entries[]` ×32<br>`DICTIONARY _entryNames[]` ×29<br>`VISUALSTYLE <missing>` ×24 |
| ezdxf/examples_dxf/acad_table_simple.dxf | R2013 | dxf-ascii | diff | 221 | 135 → 102 | `DICTIONARY _entries[]` ×33<br>`DICTIONARY _entryNames[]` ×30<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/acad_table_with_blk_ref.dxf | R2018 | dxf-ascii | diff | 222 | 188 → 155 | `DICTIONARY _entries[]` ×33<br>`DICTIONARY _entryNames[]` ×30<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/caret_encoding.dxf | R2013 | dxf-ascii | diff | 89 | 105 → 98 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/examples_dxf/circle_radius_le_0.dxf | R2013 | dxf-ascii | diff | 89 | 46 → 39 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/examples_dxf/clockwise_arcs_hatch.dxf | R2013 | dxf-ascii | diff | 95 | 47 → 40 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/examples_dxf/colors.dxf | R2018 | dxf-ascii | diff | 311 | 209 → 168 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×24 |
| ezdxf/examples_dxf/columns_R2007.dxf | R2007 | dxf-ascii | diff | 263 | 250 → 169 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY <missing>` ×31<br>`DICTIONARY _entryNames[]` ×28 |
| ezdxf/examples_dxf/columns_R2018.dxf | R2018 | dxf-ascii | diff | 347 | 197 → 146 | `DICTIONARY _entries[]` ×30<br>`DICTIONARY _entryNames[]` ×27<br>`MTEXT _columnData.columnCount` ×24 |
| ezdxf/examples_dxf/dimension_in_block.dxf | R2013 | dxf-ascii | diff | 229 | 155 → 121 | `DICTIONARY _entries[]` ×34<br>`DICTIONARY _entryNames[]` ×31<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/dimension_in_nested_blocks.dxf | R2013 | dxf-ascii | diff | 227 | 179 → 146 | `DICTIONARY _entries[]` ×33<br>`DICTIONARY _entryNames[]` ×30<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/hatch_issues.dxf | R2018 | dxf-ascii | diff | 222 | 131 → 99 | `DICTIONARY _entries[]` ×32<br>`DICTIONARY _entryNames[]` ×29<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/hatch_text_box_in_fill.dxf | R2013 | dxf-ascii | diff | 227 | 126 → 93 | `DICTIONARY _entries[]` ×33<br>`DICTIONARY _entryNames[]` ×30<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/hatch_text_box_in_hole.dxf | R2013 | dxf-ascii | diff | 227 | 126 → 93 | `DICTIONARY _entries[]` ×33<br>`DICTIONARY _entryNames[]` ×30<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/hatch_text_box_overlapping_fill_and_hole.dxf | R2013 | dxf-ascii | diff | 228 | 126 → 93 | `DICTIONARY _entries[]` ×33<br>`DICTIONARY _entryNames[]` ×30<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/hatches_1.dxf | R2018 | dxf-ascii | diff | 279 | 183 → 141 | `DICTIONARY _entries[]` ×32<br>`SORTENTSTABLE _sorters[].entity` ×31<br>`SORTENTSTABLE _sorters[].sortHandle` ×31 |
| ezdxf/examples_dxf/hatches_2.dxf | R2018 | dxf-ascii | diff | 240 | 162 → 121 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×24 |
| ezdxf/examples_dxf/images.dxf | R2000 | dxf-ascii | diff | 281 | 457 → 368 | `IMAGE definitionReactor` ×60<br>`IMAGEDEF_REACTOR <missing>` ×60<br>`DICTIONARY <missing>` ×13 |
| ezdxf/examples_dxf/insert_bricscad_level_1.dxf | R2013 | dxf-ascii | diff | 219 | 180 → 148 | `DICTIONARY _entries[]` ×32<br>`DICTIONARY _entryNames[]` ×29<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/Minimal_DXF_AC1006.dxf | R10 | dxf-ascii | diff | 56 | 35 → 35 | `DICTIONARY <added>` ×15<br>`DICTIONARY <missing>` ×15<br>`3DFACE owner` ×2 |
| ezdxf/examples_dxf/Minimal_DXF_AC1009.dxf | R12 | dxf-ascii | diff | 46 | 30 → 21 | `DICTIONARY _entries[]` ×14<br>`DICTIONARY <missing>` ×14<br>`DICTIONARY _entryNames[]` ×9 |
| ezdxf/examples_dxf/Minimal_DXF_AC1021.dxf | R2007 | dxf-ascii | diff | 20 | 29 → 29 | `DICTIONARY _entries[]` ×5<br>`DICTIONARY <added>` ×5<br>`DICTIONARY <missing>` ×5 |
| ezdxf/examples_dxf/mtext_columns_R2000.dxf | R2000 | dxf-ascii | diff | 67 | 56 → 49 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/examples_dxf/mtext_columns_R2007.dxf | R2007 | dxf-ascii | diff | 90 | 56 → 49 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/examples_dxf/mtext_columns_R2018.dxf | R2018 | dxf-ascii | diff | 103 | 50 → 43 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/examples_dxf/mtext_complex_inline_codes.dxf | R2013 | dxf-ascii | diff | 263 | 168 → 128 | `DICTIONARY _entries[]` ×40<br>`DICTIONARY _entryNames[]` ×37<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/multi_insert_with_attribs.dxf | R2013 | dxf-ascii | diff | 93 | 54 → 47 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/examples_dxf/text_alignments.dxf | R2004 | dxf-ascii | diff | 71 | 108 → 101 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/examples_dxf/text_fonts.dxf | R2013 | dxf-ascii | diff | 225 | 1453 → 1422 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/text_in_viewports.dxf | R2013 | dxf-ascii | diff | 278 | 142 → 110 | `DICTIONARY _entries[]` ×32<br>`DICTIONARY _entryNames[]` ×29<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/text_mirror_shx_font.dxf | R2013 | dxf-ascii | diff | 215 | 772 → 741 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/text_mirror_true_type_font.dxf | R2013 | dxf-ascii | diff | 215 | 772 → 741 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/text_negative_extrusion.dxf | R2018 | dxf-ascii | diff | 441 | 421 → 383 | `DICTIONARY _entries[]` ×32<br>`DICTIONARY _entryNames[]` ×29<br>`MTEXT _columnData.columnCount` ×26 |
| ezdxf/examples_dxf/text_oblique_rotate.dxf | R2013 | dxf-ascii | diff | 215 | 417 → 386 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/text_stacked_shx_font.dxf | R2013 | dxf-ascii | diff | 213 | 540 → 509 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/text_stacked_true_type_font.dxf | R2013 | dxf-ascii | diff | 213 | 540 → 509 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/text.dxf | R2018 | dxf-ascii | diff | 442 | 420 → 382 | `DICTIONARY _entries[]` ×32<br>`DICTIONARY _entryNames[]` ×29<br>`MTEXT _columnData.columnCount` ×26 |
| ezdxf/examples_dxf/transform_hatch_pattern.dxf | R2013 | dxf-ascii | diff | 217 | 142 → 110 | `DICTIONARY _entries[]` ×32<br>`DICTIONARY _entryNames[]` ×29<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/uncommon.dxf | R2018 | dxf-ascii | diff | 596 | 597 → 546 | `SORTENTSTABLE _sorters[].entity` ×73<br>`SORTENTSTABLE _sorters[].sortHandle` ×73<br>`DICTIONARY _entries[]` ×41 |
| ezdxf/examples_dxf/valid_lineweights.dxf | R2013 | dxf-ascii | diff | 89 | 94 → 87 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/examples_dxf/viewport_frozen_layers.dxf | R2013 | dxf-ascii | diff | 255 | 128 → 96 | `DICTIONARY _entries[]` ×32<br>`DICTIONARY _entryNames[]` ×29<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/viewports.dxf | R2013 | dxf-ascii | diff | 361 | 187 → 147 | `DICTIONARY _entries[]` ×35<br>`DICTIONARY _entryNames[]` ×32<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/visibility.dxf | R2018 | dxf-ascii | diff | 237 | 162 → 121 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×24 |
| ezdxf/examples_dxf/VP4.dxf | R2013 | dxf-ascii | diff | 263 | 146 → 114 | `DICTIONARY _entries[]` ×32<br>`DICTIONARY _entryNames[]` ×29<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/examples_dxf/wipeout_door.dxf | R2018 | dxf-ascii | diff | 539 | 379 → 337 | `SORTENTSTABLE _sorters[].entity` ×148<br>`SORTENTSTABLE _sorters[].sortHandle` ×148<br>`DICTIONARY _entries[]` ×32 |
| ezdxf/examples_dxf/wipeout_random.dxf | R2013 | dxf-ascii | diff | 90 | 78 → 71 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/examples_dxf/xclip.dxf | R2013 | dxf-ascii | diff | 320 | 207 → 168 | `DICTIONARY _entries[]` ×39<br>`DICTIONARY _entryNames[]` ×36<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/integration_tests/AC1003_LINE_Example.dxf | R2.6 | dxf-ascii | diff | 76 | 53 → 53 | `DICTIONARY <added>` ×15<br>`DICTIONARY <missing>` ×15<br>`LINE owner` ×13 |
| ezdxf/integration_tests/ASCII_R12.dxf | R12 | dxf-ascii | diff | 95 | 56 → 53 | `DICTIONARY <added>` ×15<br>`DICTIONARY <missing>` ×15<br>`BLOCK_RECORD <missing>` ×4 |
| ezdxf/integration_tests/bin_dxf_r12.dxf | R12 | dxf-binary | diff | 85 | 42 → 39 | `DICTIONARY <added>` ×15<br>`DICTIONARY <missing>` ×15<br>`BLOCK_RECORD <missing>` ×3 |
| ezdxf/integration_tests/bin_dxf_r13.dxf | R13 | dxf-binary | diff | 222 | 118 → 56 | `DICTIONARY _entries[]` ×55<br>`DICTIONARY _entryNames[]` ×51<br>`ACAD_PROXY_OBJECT <missing>` ×49 |
| ezdxf/integration_tests/bin_dxf_r14.dxf | R14 | dxf-binary | diff | 217 | 120 → 58 | `DICTIONARY _entries[]` ×55<br>`DICTIONARY _entryNames[]` ×51<br>`ACAD_PROXY_OBJECT <missing>` ×49 |
| ezdxf/integration_tests/bin_dxf_r2000.dxf | R2000 | dxf-binary | diff | 70 | 45 → 37 | `DICTIONARY _entries[]` ×8<br>`DICTIONARY <missing>` ×8<br>`DICTIONARY _entryNames[]` ×5 |
| ezdxf/integration_tests/custom_blocks.dxf | R2010 | dxf-ascii | diff | 210 | 143 → 104 | `DICTIONARY _entries[]` ×29<br>`DICTIONARY _entryNames[]` ×26<br>`VISUALSTYLE <missing>` ×24 |
| ezdxf/integration_tests/duplicate_handles.dxf | R13 | dxf-ascii | diff | 62 | 181 → 181 | `DICTIONARY _entries[]` ×4<br>`DICTIONARY <added>` ×4<br>`DICTIONARY <missing>` ×4 |
| ezdxf/integration_tests/dxf_unicode.dxf | R2013 | dxf-ascii | diff | 92 | 50 → 42 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/integration_tests/groups.dxf | R2013 | dxf-ascii | diff | 214 | 131 → 99 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×29<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/integration_tests/layout_broken_links_2.dxf | R2013 | dxf-ascii | diff | 92 | 53 → 46 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/integration_tests/layout_broken_links.dxf | R2013 | dxf-ascii | diff | 92 | 53 → 46 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/integration_tests/layout_missing_block_definition.dxf | R2013 | dxf-ascii | diff | 92 | 53 → 46 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/integration_tests/layout_missing_block_record.dxf | R2013 | dxf-ascii | diff | 92 | 53 → 46 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/integration_tests/MODEL.dxf | R2013 | dxf-ascii | diff | 89 | 46 → 39 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/integration_tests/mtext_framed_columns.dxf | R2013 | dxf-ascii | diff | 233 | 131 → 94 | `DICTIONARY _entries[]` ×37<br>`DICTIONARY _entryNames[]` ×34<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/integration_tests/mtext_text_frame.dxf | R2013 | dxf-ascii | diff | 242 | 166 → 135 | `DICTIONARY _entries[]` ×31<br>`DICTIONARY _entryNames[]` ×28<br>`VISUALSTYLE <missing>` ×25 |
| ezdxf/integration_tests/no_layouts.dxf | R2007 | dxf-ascii | diff | 33 | 50 → 50 | `DICTIONARY _entries[]` ×5<br>`DICTIONARY <added>` ×5<br>`DICTIONARY <missing>` ×5 |
| ezdxf/integration_tests/r12_blocks_with_no_names.dxf | R12 | dxf-ascii | diff | 81 | 41 → 38 | `DICTIONARY <added>` ×15<br>`DICTIONARY <missing>` ×15<br>`BLOCK_RECORD <missing>` ×3 |
| ezdxf/integration_tests/R12_with_trash_beyond_EOF.dxf | R12 | dxf-ascii | diff | 47 | 32 → 23 | `DICTIONARY _entries[]` ×14<br>`DICTIONARY <missing>` ×14<br>`DICTIONARY _entryNames[]` ×9 |
| ezdxf/integration_tests/r2000_blocks_with_no_name_and_no_block_record.dxf | R2000 | dxf-ascii | diff | 67 | 49 → 42 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/integration_tests/r2000_blocks_with_no_names.dxf | R2000 | dxf-ascii | diff | 67 | 55 → 48 | `DICTIONARY _entries[]` ×7<br>`DICTIONARY <missing>` ×7<br>`DICTIONARY _entryNames[]` ×4 |
| ezdxf/integration_tests/recover02.dxf | R2018 | dxf-ascii | read-error |  |  | DxfException: Unexpected token at the beginning of a table: BLOCK_RECORD, at line 1920. |
| ezdxf/integration_tests/small_r13.dxf | R13 | dxf-ascii | diff | 61 | 53 → 52 | `DICTIONARY _entries[]` ×5<br>`DICTIONARY <missing>` ×5<br>`DICTIONARY <added>` ×4 |
| ezdxf/integration_tests/small_r14.dxf | R14 | dxf-ascii | diff | 29 | 71 → 70 | `DICTIONARY _entries[]` ×5<br>`DICTIONARY <missing>` ×5<br>`DICTIONARY <added>` ×4 |
