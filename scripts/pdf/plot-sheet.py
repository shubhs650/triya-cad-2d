"""Writes packages/testkit/fixtures/pdf/plot-sheet.dxf, the PDF writer's test drawing (M2-16).

A thread-authored AC1032 drawing (DEC-047) in millimetres that fills an A4 landscape sheet at
1:1, so its plot exercises what the vector PDF writer must get right
(`packages/testkit/src/pdf/sheet.ts` plots it, `tests/e2e/fidelity/pdf.spec.ts` checks the
PDF against its golden images):

- a 0.70 mm border and a title in ROMANS (a stroke font: its glyphs plot as paths);
- nine lines in ACI 1–9, each at another lineweight from 0 (thinnest) to 2.00 mm;
- a circle, an arc, a rotated ellipse, a spline and a polyline with a bulge and widths;
- a solid hatch with a hole (odd parity) in ACI 150, and a 50 % transparent solid hatch over
  three lines;
- 30 lines in ACI 10–39 that the sheet's third page plots with plot style linetypes 1–30.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/pdf/plot-sheet.py

Output is byte-for-byte reproducible (fixed metadata and string hashing pinned).
"""

from __future__ import annotations

import os
import pathlib
import sys

import ezdxf
from ezdxf.enums import TextEntityAlignment

OUT = pathlib.Path(__file__).resolve().parents[2] / "packages/testkit/fixtures/pdf/plot-sheet.dxf"

LINEWEIGHTS = [0, 13, 25, 35, 50, 70, 100, 140, 200]


def model(doc: ezdxf.document.Drawing) -> None:
    doc.styles.add("ROMANS", font="romans.shx")
    doc.layers.add("SHEET", color=7, lineweight=70)
    doc.layers.add("GEOMETRY", color=7, lineweight=35)
    msp = doc.modelspace()

    # The border, on its layer's 0.70 mm.
    msp.add_lwpolyline([(10, 10), (287, 10), (287, 200), (10, 200)], close=True,
                       dxfattribs={"layer": "SHEET"})
    title = msp.add_text("TRIYA PLOT SHEET", height=7,
                         dxfattribs={"style": "ROMANS", "layer": "SHEET", "lineweight": 50})
    title.set_placement((20, 185))
    sub = msp.add_text("M2-16 vector PDF: lineweights, colours, curves, fills, linetypes",
                       height=3.5, dxfattribs={"style": "ROMANS", "layer": "SHEET",
                                               "lineweight": 25})
    sub.set_placement((20, 178))

    # Colours and lineweights.
    for i, lw in enumerate(LINEWEIGHTS):
        y = 165 - 7 * i
        msp.add_line((20, y), (80, y), dxfattribs={"color": i + 1, "lineweight": lw})
        label = msp.add_text(f"ACI {i + 1}  {lw / 100:.2f} mm", height=2.5,
                             dxfattribs={"style": "ROMANS", "layer": "SHEET", "lineweight": 18})
        label.set_placement((84, y - 1.25))

    # Curves.
    attribs = {"layer": "GEOMETRY"}
    msp.add_circle((130, 150), 15, dxfattribs={**attribs, "color": 5})
    msp.add_arc((170, 150), 12, 0, 200, dxfattribs={**attribs, "color": 6, "lineweight": 50})
    msp.add_ellipse((150, 118), major_axis=(22, 8), ratio=0.4,
                    dxfattribs={**attribs, "color": 4})
    msp.add_spline_control_frame([(115, 95), (125, 110), (140, 90), (155, 105), (170, 92)],
                                 degree=3, dxfattribs={**attribs, "color": 3})
    pl = msp.add_lwpolyline([(115, 75, 0.5, 0.5, 0), (140, 75, 2, 0.2, 0.6), (165, 80, 0, 0, 0)],
                            format="xyseb", dxfattribs={**attribs, "color": 1})
    pl.dxf.const_width = 0

    # A solid hatch with a hole: odd parity leaves the circle empty.
    hatch = msp.add_hatch(color=150, dxfattribs={"layer": "GEOMETRY"})
    hatch.paths.add_polyline_path([(20, 20), (70, 20), (70, 60), (20, 60)], is_closed=True,
                                  flags=1)
    edge = hatch.paths.add_edge_path(flags=16)
    edge.add_arc((45, 40), 12, 0, 360)

    # A half-transparent fill over three lines.
    for k in range(3):
        msp.add_line((80, 25 + 12 * k), (180, 25 + 12 * k),
                     dxfattribs={"color": 2 + k, "lineweight": 100})
    veil = msp.add_hatch(color=5, dxfattribs={"layer": "GEOMETRY"})
    veil.paths.add_polyline_path([(100, 20), (160, 20), (160, 55), (100, 55)], is_closed=True,
                                 flags=1)
    veil.transparency = 0.5

    # The linetype ladder: ACI 9 + k plots with plot style linetype k on page 3.
    for k in range(1, 31):
        y = 160 - 4.8 * (k - 1)
        msp.add_line((200, y), (280, y), dxfattribs={"color": 9 + k, "lineweight": 35})
        t = msp.add_text(str(k), height=2, dxfattribs={"style": "ROMANS", "layer": "SHEET",
                                                       "lineweight": 18})
        t.set_placement((197, y), align=TextEntityAlignment.MIDDLE_RIGHT)


def pin_hash_seed() -> None:
    """ezdxf orders some OBJECTS by set iteration, so the bytes depend on string hashing. Run
    again with PYTHONHASHSEED=0, which `-I` would ignore."""
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
    doc.set_modelspace_vport(height=210, center=(148.5, 105))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(OUT)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
