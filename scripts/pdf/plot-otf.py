"""Writes packages/testkit/fixtures/pdf/plot-otf.dxf, the PDF writer's fourth test drawing
(M2-16 part 4).

A thread-authored AC1032 drawing (DEC-047) in millimetres that fills an A4 landscape sheet at
1:1 with text in CFF-flavoured OpenType fonts and a TrueType collection
(`packages/testkit/src/pdf/sheet.ts` plots it as page 7 of plot-sheet.pdf, where the text is
embedded as CFF subsets and the collection's faces one by one). Its styles name fonts the test
writes itself (`packages/testkit/src/fonts/`, no font file is committed):

- triya-pixel-cff.otf: the pixel test font as plain CFF ("Triya Pixel CFF", solid squares);
- triya-pixel-cid.otf: as a CID-keyed CFF ("Triya Pixel CID", dots), CIDs unlike glyph numbers;
- triya-pair.ttc: a collection whose first face is TrueType "Triya Pair" (dots) and second CFF
  "Triya Pair Sans" (solid), the second reached by family through an MTEXT font code;
- triya-locked-cff.otf: a CFF font whose licence forbids embedding, plotted as outlines.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/pdf/plot-otf.py

Output is byte-for-byte reproducible (fixed metadata and string hashing pinned).
"""

from __future__ import annotations

import os
import pathlib
import sys

import ezdxf

OUT = pathlib.Path(__file__).resolve().parents[2] / "packages/testkit/fixtures/pdf/plot-otf.dxf"


def label(msp, text: str, at: tuple[float, float], height: float = 2.5) -> None:
    t = msp.add_text(text, height=height, dxfattribs={"style": "ROMANS", "layer": "SHEET",
                                                      "lineweight": 18})
    t.set_placement(at)


def model(doc: ezdxf.document.Drawing) -> None:
    doc.styles.add("ROMANS", font="romans.shx")
    doc.styles.add("CFF", font="triya-pixel-cff.otf")
    wide = doc.styles.add("CFF WIDE", font="triya-pixel-cff.otf")
    wide.dxf.width = 1.5
    wide.dxf.oblique = 15
    doc.styles.add("CID", font="triya-pixel-cid.otf")
    doc.styles.add("PAIR", font="triya-pair.ttc")
    doc.styles.add("LOCKED CFF", font="triya-locked-cff.otf")
    doc.layers.add("SHEET", color=7, lineweight=70)
    doc.layers.add("TEXT", color=7)
    msp = doc.modelspace()

    msp.add_lwpolyline([(10, 10), (287, 10), (287, 200), (10, 200)], close=True,
                       dxfattribs={"layer": "SHEET"})
    title = msp.add_text("TRIYA PLOT OPENTYPE", height=7,
                         dxfattribs={"style": "ROMANS", "layer": "SHEET", "lineweight": 50})
    title.set_placement((20, 185))
    sub = msp.add_text("M2-16 part 4: CFF OpenType and TrueType collection text, embedded",
                       height=3.5, dxfattribs={"style": "ROMANS", "layer": "SHEET",
                                               "lineweight": 25})
    sub.set_placement((20, 178))

    def text(value: str, at, height: float, style: str, **attribs):
        t = msp.add_text(value, height=height, dxfattribs={"style": style, "layer": "TEXT",
                                                           **attribs})
        t.set_placement(at)
        return t

    text("CFF OPENTYPE 1:50", (20, 155), 10, "CFF")
    label(msp, "plain CFF, TEXT 10 mm", (20, 150))
    text("CID-KEYED CFF", (180, 155), 7, "CID", color=5)
    label(msp, "CID-keyed CFF (dots), ACI 5", (180, 150))

    text("ROTATED 20°", (25, 112), 6, "CFF", rotation=20, color=1)
    label(msp, "rotation 20", (25, 107))
    text("WIDE ÅÄ", (110, 125), 6, "CFF WIDE", color=3)
    label(msp, "width 1.5, oblique 15, composites", (110, 120))
    text("CID: (1+2)/3 = 1", (195, 125), 5, "CID", color=6)
    label(msp, "CID-keyed, punctuation", (195, 120))

    text("TTC FACE 1", (110, 100), 6, "PAIR", color=30)
    label(msp, "triya-pair.ttc: first face (TrueType, dots)", (110, 95))
    mtext = msp.add_mtext(
        "FIRST FACE\\P{\\fTriya Pair Sans|b0|i0;FACE 2 BY FAMILY}\\P{\\fTriya Pixel CID|b0|i0;CID} AND "
        "{\\Fromans.shx;romans}",
        dxfattribs={"style": "PAIR", "layer": "TEXT", "char_height": 5, "width": 150,
                    "insert": (20, 85), "attachment_point": 1})
    mtext.dxf.line_spacing_factor = 1.2
    label(msp, "MTEXT: collection faces by family, CFF and SHX runs", (20, 52))

    text("LOCKED CFF: OUTLINES", (20, 30), 6, "LOCKED CFF", color=8)
    label(msp, "CFF with fsType restricted: plotted as outlines, not text", (20, 25))


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
