"""Writes packages/testkit/fixtures/pdf/plot-text.dxf, the PDF writer's third test drawing
(M2-16 part 3).

A thread-authored AC1032 drawing (DEC-047) in millimetres that fills an A4 landscape sheet at
1:1 with TrueType text (`packages/testkit/src/pdf/sheet.ts` plots it as page 6 of
plot-sheet.pdf, where the text is embedded as subset fonts). Its styles name two fonts the
test writes itself (`packages/testkit/src/fonts/truetype.ts`, no font file is committed):
triya-pixel.ttf, embeddable, and triya-locked.ttf, the same glyphs with a restricted-licence
fsType, which a plot must draw as outlines. The text covers:

- TEXT at several heights, rotated, with a width factor and obliquing, Fit between two points,
  backward and upside down;
- composite glyphs (Å, Ä) and a character the font lacks (drawn as .notdef);
- MTEXT over three lines with tracking, a colour override and a ROMANS run among TrueType ones;
- text in a font that may not be embedded.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/pdf/plot-text.py

Output is byte-for-byte reproducible (fixed metadata and string hashing pinned).
"""

from __future__ import annotations

import os
import pathlib
import sys

import ezdxf
from ezdxf.enums import TextEntityAlignment

OUT = pathlib.Path(__file__).resolve().parents[2] / "packages/testkit/fixtures/pdf/plot-text.dxf"


def label(msp, text: str, at: tuple[float, float], height: float = 2.5) -> None:
    t = msp.add_text(text, height=height, dxfattribs={"style": "ROMANS", "layer": "SHEET",
                                                      "lineweight": 18})
    t.set_placement(at)


def model(doc: ezdxf.document.Drawing) -> None:
    doc.styles.add("ROMANS", font="romans.shx")
    doc.styles.add("PIXEL", font="triya-pixel.ttf")
    wide = doc.styles.add("PIXEL WIDE", font="triya-pixel.ttf")
    wide.dxf.width = 1.5
    wide.dxf.oblique = 15
    doc.styles.add("LOCKED", font="triya-locked.ttf")
    doc.layers.add("SHEET", color=7, lineweight=70)
    doc.layers.add("TEXT", color=7)
    msp = doc.modelspace()

    msp.add_lwpolyline([(10, 10), (287, 10), (287, 200), (10, 200)], close=True,
                       dxfattribs={"layer": "SHEET"})
    title = msp.add_text("TRIYA PLOT TEXT", height=7,
                         dxfattribs={"style": "ROMANS", "layer": "SHEET", "lineweight": 50})
    title.set_placement((20, 185))
    sub = msp.add_text("M2-16 part 3: TrueType text embedded as subset fonts, searchable",
                       height=3.5, dxfattribs={"style": "ROMANS", "layer": "SHEET",
                                               "lineweight": 25})
    sub.set_placement((20, 178))

    def text(value: str, at, height: float, style: str = "PIXEL", **attribs):
        t = msp.add_text(value, height=height, dxfattribs={"style": style, "layer": "TEXT",
                                                           **attribs})
        t.set_placement(at)
        return t

    text("TRUETYPE TEXT 1:100", (20, 155), 10)
    label(msp, "TEXT 10 mm", (20, 150))
    text("HEIGHT 5 = 2.5 X 2", (200, 155), 5, color=3)
    label(msp, "TEXT 5 mm, ACI 3", (200, 150))

    text("ROTATED 30°", (25, 105), 6, rotation=30, color=1)
    label(msp, "rotation 30", (25, 100))
    text("WIDTH 1.5 OBLIQUE 15", (110, 130), 6, style="PIXEL WIDE", color=5)
    label(msp, "style width factor 1.5, oblique 15", (110, 125))

    fit = msp.add_text("FIT TEXT", height=6, dxfattribs={"style": "PIXEL", "layer": "TEXT",
                                                     "color": 6})
    fit.set_placement((110, 108), (175, 108), align=TextEntityAlignment.FIT)
    label(msp, "Fit between two points", (110, 103))
    back = text("BACKWARD", (240, 120), 5, color=30)
    back.dxf.text_generation_flag = 2
    label(msp, "backward", (215, 115))
    upside = text("UPSIDE DOWN", (195, 100), 5, color=30)
    upside.dxf.text_generation_flag = 4
    label(msp, "upside down", (195, 103))

    text("ÅÄ COMPOSITE GLYPHS", (110, 85), 6)
    label(msp, "composite glyphs (A + ring, A + dieresis)", (110, 80))
    text("MISSING: q", (20, 70), 6)
    label(msp, "a character the font lacks draws .notdef", (20, 65))

    mtext = msp.add_mtext(
        "MTEXT LINE ONE\\P\\T1.5;TRACKED 1.5\\P\\T1;{\\C1;RED} AND {\\Fromans.shx;romans}",
        dxfattribs={"style": "PIXEL", "layer": "TEXT", "char_height": 5, "width": 120,
                    "insert": (110, 70), "attachment_point": 1})
    mtext.dxf.line_spacing_factor = 1.2
    label(msp, "MTEXT: tracking, colour, an SHX run", (110, 38))

    text("LOCKED FONT: OUTLINES", (20, 30), 6, style="LOCKED", color=8)
    label(msp, "fsType restricted: plotted as outlines, not text", (20, 25))


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
