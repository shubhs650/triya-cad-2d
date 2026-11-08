"""Writes corpus/public/self-authored/traces.dxf (M1-75 close-out).

A thread-authored AC1032 drawing (DEC-047: no AutoCAD sample is asked for) holding TRACE
entities, the one type Triya writes that no other public corpus file has, so the corpus edit gate
(`packages/testkit/src/export/export.corpus.test.ts`) moves a TRACE of a real file:

- a three-segment wide line 4 units wide, as the TRACE command draws it: each segment one TRACE
  whose end corners are the mitred joint it shares with the next (DXF 10/11 at the start, 12/13
  at the end, so a segment's outline runs 10-11-13-12);
- a TRACE with an elevation (its corners' Z, DXF 30–33, as an R2018 DXF files it) and a
  thickness (DXF 39);
- a TRACE whose extrusion is −Z (DXF 210), its corners in that plane's OCS, as a TRACE drawn in
  a mirrored UCS is filed;
- a triangle (DXF 13 repeats 12), on its own layer with a colour of its own;
- a block, TICK, of a TRACE and a LINE on layer 0, inserted turned 30° and scaled twice.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/corpus/traces.py

Output is byte-for-byte reproducible (fixed metadata, fixed handles, string hashing pinned), so the
committed file's sha256 in corpus/corpus.json only changes when this script does.
"""

from __future__ import annotations

import math
import os
import pathlib
import sys

import ezdxf

OUT = pathlib.Path(__file__).resolve().parents[2] / "corpus/public/self-authored/traces.dxf"

VIEW_CENTER = (60.0, 30.0)
VIEW_HEIGHT = 80.0
HALF_WIDTH = 2.0  # the TRACE command's TRACEWID of 4


def sides(a, b):
    """The two sides of segment a→b, HALF_WIDTH to its left and to its right."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy)
    ox, oy = -dy / n * HALF_WIDTH, dx / n * HALF_WIDTH
    return ((a[0] + ox, a[1] + oy), (b[0] + ox, b[1] + oy)), (
        (a[0] - ox, a[1] - oy),
        (b[0] - ox, b[1] - oy),
    )


def meet(p, q):
    """Where lines p and q (each two points) cross: the mitre corner of a joint."""
    (x1, y1), (x2, y2) = p
    (x3, y3), (x4, y4) = q
    d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d
    return (round(x1 + t * (x2 - x1), 6), round(y1 + t * (y2 - y1), 6))


def wide_line(layout, path, layer: str) -> None:
    """One TRACE per segment of `path`, mitred at each joint as the TRACE command draws them."""
    edges = [sides(a, b) for a, b in zip(path, path[1:])]
    left = [edges[0][0][0]] + [meet(edges[i][0], edges[i + 1][0]) for i in range(len(edges) - 1)]
    right = [edges[0][1][0]] + [meet(edges[i][1], edges[i + 1][1]) for i in range(len(edges) - 1)]
    left.append(edges[-1][0][1])
    right.append(edges[-1][1][1])
    for i in range(len(edges)):
        layout.add_trace(
            [left[i], right[i], left[i + 1], right[i + 1]], dxfattribs={"layer": layer}
        )


def model(doc: ezdxf.document.Drawing) -> None:
    doc.layers.add("TRACES", color=5)  # blue
    doc.layers.add("MARKS", color=1)  # red

    msp = doc.modelspace()
    wide_line(msp, [(10, 10), (40, 10), (55, 35), (85, 35)], "TRACES")

    # Elevation and thickness; in plan only its outline at the elevation shows.
    msp.add_trace(
        [(10, 45, 3), (30, 45, 3), (10, 50, 3), (30, 50, 3)],
        dxfattribs={"layer": "TRACES", "thickness": 2.0},
    )

    # On a −Z plane: OCS x runs along WCS −x, so these corners land at WCS x 100..110.
    msp.add_trace(
        [(-100, 45), (-110, 45), (-100, 50), (-110, 50)],
        dxfattribs={"layer": "TRACES", "extrusion": (0, 0, -1)},
    )

    # A triangle, the fourth corner repeating the third.
    msp.add_trace(
        [(40, 45), (50, 45), (45, 55)], dxfattribs={"layer": "MARKS", "color": 3}
    )

    tick = doc.blocks.new("TICK")
    tick.add_trace([(0, -0.5), (0, 0.5), (6, -0.5), (6, 0.5)], dxfattribs={"layer": "0"})
    tick.add_line((0, 0), (0, 4), dxfattribs={"layer": "0"})
    msp.add_blockref(
        "TICK", (95, 10), dxfattribs={"layer": "MARKS", "rotation": 30, "xscale": 2, "yscale": 2}
    )
    msp.add_blockref("TICK", (95, 25), dxfattribs={"layer": "TRACES"})


def pin_hash_seed() -> None:
    """ezdxf orders some OBJECTS (the layouts' placeholders) by set iteration, so the bytes depend
    on string hashing. Run again with PYTHONHASHSEED=0, which `-I` would ignore."""
    if os.environ.get("TRIYA_HASH_SEED") == "0":
        return
    env = {"PATH": os.environ.get("PATH", ""), "PYTHONHASHSEED": "0", "TRIYA_HASH_SEED": "0"}
    os.execve(sys.executable, [sys.executable, "-P", "-s", __file__], env)


def main() -> int:
    pin_hash_seed()
    if ezdxf.__version__ != "1.4.5":
        print(f"expected ezdxf 1.4.5 (scripts/dxf-audit/requirements.txt), got {ezdxf.__version__}")
        return 1
    ezdxf.options.write_fixed_meta_data_for_testing = True
    doc = ezdxf.new("R2018", units=4)  # millimetres
    model(doc)
    # The Model tab opens on the drawing, not on ezdxf's default view.
    doc.set_modelspace_vport(height=VIEW_HEIGHT, center=VIEW_CENTER)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(OUT)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
