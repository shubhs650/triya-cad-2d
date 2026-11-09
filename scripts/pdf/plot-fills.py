"""Writes packages/testkit/fixtures/pdf/plot-fills.dxf, the PDF writer's second test drawing
(M2-16 part 2).

A thread-authored AC1032 drawing (DEC-047) in millimetres that fills an A4 landscape sheet at
1:1 with what a plot paints besides lines and solid fills (`packages/testkit/src/pdf/sheet.ts`
plots it as pages 4 and 5 of plot-sheet.pdf):

- an XLINE with an authored dashed linetype, a second XLINE and a RAY, drawn first so the rest
  covers them;
- eight solid hatch squares in ACI 40–47, which page 5's CTB plots with the eight patterned
  fill styles, and a 2D SOLID in ACI 41;
- three gradient hatches: LINEAR at 30°, SPHERICAL and a one-colour CYLINDER;
- a raster IMAGE (64 × 32 pixels, its definition's file never read: the test makes the
  pixels) clipped to a polygon, with transparency on, over a line;
- five POINTs from the thinnest lineweight to 2.00 mm.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/pdf/plot-fills.py

Output is byte-for-byte reproducible (fixed metadata and string hashing pinned).
"""

from __future__ import annotations

import os
import pathlib
import sys

import ezdxf
from ezdxf.enums import TextEntityAlignment

OUT = pathlib.Path(__file__).resolve().parents[2] / "packages/testkit/fixtures/pdf/plot-fills.dxf"

FILL_STYLES = ["Checkerboard", "Crosshatch", "Diamonds", "Horizontal Bars", "Slant Left",
               "Slant Right", "Square Dots", "Vertical Bars"]
POINT_WEIGHTS = [0, 25, 50, 100, 200]


def label(msp, text: str, at: tuple[float, float], height: float = 2.5) -> None:
    t = msp.add_text(text, height=height, dxfattribs={"style": "ROMANS", "layer": "SHEET",
                                                      "lineweight": 18})
    t.set_placement(at, align=TextEntityAlignment.MIDDLE_CENTER)


def model(doc: ezdxf.document.Drawing) -> None:
    doc.styles.add("ROMANS", font="romans.shx")
    doc.layers.add("SHEET", color=7, lineweight=70)
    doc.layers.add("GEOMETRY", color=7, lineweight=35)
    # Ours: 4 mm dashes, 2 mm gaps and a dot.
    doc.linetypes.add("TRIYA_DASHDOT", pattern=[8.0, 4.0, -2.0, 0.0, -2.0],
                      description="Triya dash dot __ . __ .")
    msp = doc.modelspace()

    # Infinite lines first, so everything else covers them.
    msp.add_xline((20, 20), (1, 0.27), dxfattribs={"color": 3, "linetype": "TRIYA_DASHDOT",
                                                   "lineweight": 35})
    msp.add_xline((285, 100), (0, 1), dxfattribs={"color": 8, "lineweight": 25})
    msp.add_ray((150, 45), (-1, 0.35), dxfattribs={"color": 6, "lineweight": 50})

    msp.add_lwpolyline([(10, 10), (287, 10), (287, 200), (10, 200)], close=True,
                       dxfattribs={"layer": "SHEET"})
    title = msp.add_text("TRIYA PLOT FILLS", height=7,
                         dxfattribs={"style": "ROMANS", "layer": "SHEET", "lineweight": 50})
    title.set_placement((20, 185))
    sub = msp.add_text("M2-16 part 2: fill styles, gradients, raster images, points, XLINE/RAY",
                       height=3.5, dxfattribs={"style": "ROMANS", "layer": "SHEET",
                                               "lineweight": 25})
    sub.set_placement((20, 178))

    # Fill styles: page 5 plots ACI 40 + i with fill style i + 1.
    for i, name in enumerate(FILL_STYLES):
        x = 20 + 32 * i
        h = msp.add_hatch(color=40 + i, dxfattribs={"layer": "GEOMETRY"})
        h.paths.add_polyline_path([(x, 140), (x + 25, 140), (x + 25, 165), (x, 165)],
                                  is_closed=True, flags=1)
        label(msp, name, (x + 12.5, 135))
    msp.add_solid([(20, 115), (45, 115), (20, 125), (45, 125)],
                  dxfattribs={"color": 41, "layer": "GEOMETRY"})
    label(msp, "SOLID", (32.5, 110))

    # Gradients.
    linear = msp.add_hatch(dxfattribs={"layer": "GEOMETRY"})
    linear.set_gradient((200, 30, 30), (30, 60, 200), rotation=30, name="LINEAR")
    linear.paths.add_polyline_path([(55, 95), (100, 95), (100, 125), (55, 125)], is_closed=True,
                                   flags=1)
    label(msp, "LINEAR 30", (77.5, 90))
    sphere = msp.add_hatch(dxfattribs={"layer": "GEOMETRY"})
    sphere.set_gradient((20, 120, 40), (250, 250, 160), name="SPHERICAL")
    edge = sphere.paths.add_edge_path(flags=1)
    edge.add_arc((127.5, 110), 15, 0, 360)
    label(msp, "SPHERICAL", (127.5, 90))
    tint = msp.add_hatch(dxfattribs={"layer": "GEOMETRY"})
    tint.set_gradient((120, 40, 160), (0, 0, 0), name="CYLINDER", one_color=1, tint=0.8)
    tint.paths.add_polyline_path([(150, 95), (195, 95), (195, 125), (150, 125)], is_closed=True,
                                 flags=1)
    label(msp, "CYLINDER one colour", (172.5, 90))

    # A raster image over a line: transparent pixels let the line show.
    msp.add_line((205, 110), (280, 110), dxfattribs={"color": 1, "lineweight": 100})
    image_def = doc.add_image_def(filename="plot-fills-image.png", size_in_pixel=(64, 32))
    image = msp.add_image(image_def, insert=(210, 95), size_in_units=(64, 32),
                          rotation=0, dxfattribs={"layer": "GEOMETRY"})
    image.set_boundary_path([(2, 2), (62, 2), (62, 26), (32, 31), (2, 26)])
    image.dxf.flags |= ezdxf.entities.image.ImageBase.USE_TRANSPARENCY
    label(msp, "IMAGE clipped, transparent", (242, 90))

    # Points.
    for i, lw in enumerate(POINT_WEIGHTS):
        x = 30 + 15 * i
        msp.add_point((x, 70), dxfattribs={"color": i + 1, "lineweight": lw})
        label(msp, f"{lw / 100:.2f}", (x, 64), height=2)
    label(msp, "POINT (PDMODE 0)", (60, 58))
    label(msp, "XLINE dashed, XLINE, RAY", (225, 30))


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
