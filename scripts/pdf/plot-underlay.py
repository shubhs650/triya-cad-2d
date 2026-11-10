"""Writes packages/testkit/fixtures/pdf/plot-underlay.dxf, the PDF writer's fifth test drawing
(M2-16 part 5).

A thread-authored AC1032 drawing (DEC-047) in millimetres that fills an A4 landscape sheet at
1:1 with PDF underlays of `plot-underlay.pdf`, a two-page PDF the test kit writes itself
(`packages/testkit/src/pdf/sheet.ts` `sheetUnderlayPdf`: the TrueType text page and the fills
page of plot-sheet.pdf, so no PDF is committed for it). `sheet.ts` plots this drawing as page 8
of plot-sheet.pdf, where each underlay's page is copied in as vectors and text, framed
(PDFFRAME 1) in the underlay's colour, ACI 8:

- page 1 as it is (contrast 100, fade 0), unclipped;
- page 2 faded 50 %;
- page 1 monochrome at contrast 50;
- page 2 turned 12 degrees and clipped to a polygon.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/pdf/plot-underlay.py

Output is byte-for-byte reproducible (fixed metadata and string hashing pinned).
"""

from __future__ import annotations

import os
import pathlib
import sys

import ezdxf

OUT = pathlib.Path(__file__).resolve().parents[2] / "packages/testkit/fixtures/pdf/plot-underlay.dxf"

# The source pages are A4 landscape: 297 × 210 mm, 11.69 × 8.27 inches.
PAGE_W = 297 / 25.4
PAGE_H = 210 / 25.4
# 0.36 of full size: millimetres per underlay unit (inch).
SCALE = 25.4 * 0.36


def label(msp, text: str, at: tuple[float, float], height: float = 2.5) -> None:
    t = msp.add_text(text, height=height, dxfattribs={"style": "ROMANS", "layer": "SHEET",
                                                      "lineweight": 18})
    t.set_placement(at)


def model(doc: ezdxf.document.Drawing) -> None:
    doc.styles.add("ROMANS", font="romans.shx")
    doc.layers.add("SHEET", color=7, lineweight=70)
    doc.layers.add("UNDERLAYS", color=8)
    msp = doc.modelspace()

    msp.add_lwpolyline([(10, 10), (287, 10), (287, 200), (10, 200)], close=True,
                       dxfattribs={"layer": "SHEET"})
    title = msp.add_text("TRIYA PLOT PDF UNDERLAYS", height=7,
                         dxfattribs={"style": "ROMANS", "layer": "SHEET", "lineweight": 50})
    title.set_placement((20, 188))
    sub = msp.add_text("M2-16 part 5: underlay pages copied into the plot as vectors and text",
                       height=3.5, dxfattribs={"style": "ROMANS", "layer": "SHEET",
                                               "lineweight": 25})
    sub.set_placement((20, 181))

    page1 = doc.add_underlay_def("plot-underlay.pdf", fmt="pdf", name="1")
    page2 = doc.add_underlay_def("plot-underlay.pdf", fmt="pdf", name="2")

    def underlay(page, at, **settings):
        u = msp.add_underlay(page, insert=(at[0], at[1], 0), scale=(SCALE, SCALE, SCALE),
                             rotation=settings.get("rotation", 0))
        u.dxf.layer = "UNDERLAYS"
        u.on = True
        if "contrast" in settings:
            u.dxf.contrast = settings["contrast"]
        if "fade" in settings:
            u.dxf.fade = settings["fade"]
        u.monochrome = settings.get("monochrome", False)
        if "clip" in settings:
            u.boundary_path = settings["clip"]
            u.clipping = True
        return u

    underlay(page1, (22, 100), contrast=100, fade=0)
    label(msp, "page 1: as drawn", (22, 95))

    underlay(page2, (160, 100), contrast=100, fade=50)
    label(msp, "page 2: fade 50", (160, 95))

    underlay(page1, (22, 15), contrast=50, fade=0, monochrome=True)
    label(msp, "page 1: monochrome, contrast 50", (22, 11.5))

    underlay(page2, (168, 15), contrast=100, fade=0, rotation=12,
             clip=[(0.6, 0.6), (PAGE_W - 0.6, 0.9), (PAGE_W - 1.6, PAGE_H - 0.6), (0.9, PAGE_H - 1.4)])
    label(msp, "page 2: rotated 12, clipped", (168, 11.5))


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
