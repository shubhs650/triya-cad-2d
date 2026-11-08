"""Writes corpus/public/self-authored/multileaders.dxf (M1-111).

A thread-authored AC1032 drawing (DEC-047: no AutoCAD sample is asked for) holding the MULTILEADER
cases no other public corpus file has:

- block content with attribute values: a balloon block, BALLOON, of a circle and two ATTDEFs
  (NO and REV), its MULTILEADERs giving their values in the MULTILEADER's own 330/177/44/302
  records (DXF reference, MLEADER), not as ATTRIBs; one straight, one turned 15° and scaled 1.5;
- per-leader-line overrides: an MTEXT multileader with three leader lines on one branch, the
  first as the MULTILEADER states them, the second overriding colour, linetype, lineweight,
  arrowhead and arrowhead size (LEADER_LINE 93 = 62), the third overriding only its path type
  (spline) and colour (93 = 3) while also storing a lineweight, linetype and arrowhead it does not
  flag, which must not be drawn;
- the text underline attachments of horizontal attachment (DXF 173/95: 5 bottom of bottom line
  and underline it, 6 bottom of top line and underline it, 8 bottom of top line and underline all)
  from the left and from the right;
- the overline and underline of vertical attachment (DXF 273/272 = 10, "overline and center" and
  "underline and center") from above and from below.

ezdxf 1.4.5 writes no LEADER_LINE overrides (its LeaderLine stores only vertices, breaks, 91 and
92), so `leader_line_overrides` writes them by hand after the line's 91, in the order AutoCAD
files them for R2010+ (DXF reference, MLEADER, and the ODA DWG specification's LEADER_LINE):
170 path type, 92 colour, 340 linetype, 171 lineweight, 40 arrowhead size, 341 arrowhead and 93
the override flags (1 path type, 2 colour, 4 linetype, 8 lineweight, 16 arrowhead size, 32
arrowhead).

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/corpus/multileaders.py

Output is byte-for-byte reproducible (fixed metadata, fixed handles, string hashing pinned), so the
committed file's sha256 in corpus/corpus.json only changes when this script does.
"""

from __future__ import annotations

import io
import os
import pathlib
import re
import sys

import ezdxf
from ezdxf import colors
from ezdxf.math import Vec2
from ezdxf.render import mleader
from ezdxf.render.arrows import ARROWS

OUT = pathlib.Path(__file__).resolve().parents[2] / "corpus/public/self-authored/multileaders.dxf"

VIEW_CENTER = (70.0, 45.0)
VIEW_HEIGHT = 100.0
H = 2.5  # text height
Left, Right, Top, Bottom = (
    mleader.ConnectionSide.left,
    mleader.ConnectionSide.right,
    mleader.ConnectionSide.top,
    mleader.ConnectionSide.bottom,
)
HC = mleader.HorizontalConnection
VC = mleader.VerticalConnection


def balloon(doc: ezdxf.document.Drawing) -> None:
    """A circle with the item number in it and a revision letter under it."""
    blk = doc.blocks.new("BALLOON")
    blk.add_circle((0, 0), 4, dxfattribs={"layer": "0"})
    blk.add_attdef(
        "NO", (0, 0), "1", dxfattribs={"layer": "0", "height": 3.5, "prompt": "Item"}
    ).set_placement((0, 0), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
    blk.add_attdef(
        "REV", (0, -6), "-", dxfattribs={"layer": "0", "height": 2.0, "color": 1}
    ).set_placement((0, -6), align=ezdxf.enums.TextEntityAlignment.TOP_CENTER)


def mtext_leader(msp, text, insert, lines, *, left=HC.by_style, right=HC.by_style,
                 top=VC.by_style, bottom=VC.by_style, alignment=mleader.TextAlignment.left):
    ml = msp.add_multileader_mtext("Standard")
    ml.set_content(text, char_height=H, alignment=alignment)
    ml.set_connection_types(left=left, right=right, top=top, bottom=bottom)
    for side, vertices in lines:
        ml.add_leader_line(side, [Vec2(v) for v in vertices])
    ml.build(insert=Vec2(insert))
    return ml.multileader


def model(doc: ezdxf.document.Drawing) -> dict[str, list[str]]:
    doc.layers.add("LEADERS", color=5)  # blue
    doc.linetypes.add("DASHED", pattern=[1.5, 1.0, -0.5], description="Dashed __ __ __")
    balloon(doc)
    dot = ARROWS.create_block(doc.blocks, ARROWS.dot)
    msp = doc.modelspace()
    attribs = {"layer": "LEADERS"}

    # Block content with attribute values, straight and turned 15° at 1.5 times its size.
    for insert, rotation, scale, no, rev, tip in (
        ((25, 72), 0.0, 1.0, "12", "B", (8, 60)),
        ((115, 40), 15.0, 1.5, "7", "C", (96, 30)),
    ):
        ml = msp.add_multileader_block("Standard")
        ml.set_content(name="BALLOON", scale=scale, color=colors.BYBLOCK)
        ml.set_attribute("NO", no)
        ml.set_attribute("REV", rev)
        ml.add_leader_line(Left, [Vec2(tip)])
        ml.build(insert=Vec2(insert), rotation=rotation)
        ml.multileader.dxf.layer = "LEADERS"

    # Per-line overrides: three lines on one branch.
    over = mtext_leader(
        msp, "OVERRIDES", (75, 72),
        [(Left, [(52, 62)]), (Left, [(50, 80)]), (Left, [(44, 88), (55, 84)])],
    )
    over.dxf.layer = "LEADERS"
    handles = {"overrides": [over.dxf.handle, dot]}

    # Underline attachments of horizontal attachment.
    for text, insert, side, tip, kw, align in (
        ("BOTTOM LINE\\PUNDERLINED", (25, 42), Left, (8, 32), {"left": HC.bottom_of_bottom_line_underline}, mleader.TextAlignment.left),
        ("TOP LINE\\PUNDERLINED", (88, 42), Right, (100, 56), {"right": HC.bottom_of_top_line_underline}, mleader.TextAlignment.right),
        ("ALL LINES\\PUNDERLINED", (25, 14), Left, (8, 4), {"left": HC.bottom_of_top_line_underline_all}, mleader.TextAlignment.left),
    ):
        mtext_leader(msp, text, insert, [(side, [tip])], alignment=align, **kw).dxf.layer = "LEADERS"

    # Overline and underline of vertical attachment.
    mtext_leader(
        msp, "OVERLINE", (70, 12), [(Top, [(76, 28)])], top=VC.center_overline,
        alignment=mleader.TextAlignment.center,
    ).dxf.layer = "LEADERS"
    mtext_leader(
        msp, "UNDERLINE", (110, 14), [(Bottom, [(116, 2)])], bottom=VC.center_overline,
        alignment=mleader.TextAlignment.center,
    ).dxf.layer = "LEADERS"
    return handles


def leader_line_overrides(dxf: str, handle: str, arrow_block: str, doc) -> str:
    """Writes the R2010+ LEADER_LINE groups of the overrides multileader by hand."""
    dashed = doc.linetypes.get("DASHED").dxf.handle
    continuous = doc.linetypes.get("Continuous").dxf.handle
    arrow = doc.blocks.get(arrow_block).block_record_handle
    red = colors.encode_raw_color(1)
    green = colors.encode_raw_color(3)
    by_block = colors.BY_BLOCK_RAW_VALUE
    # Per line: 170, 92, 340, 171, 40, 341, 93.
    groups = [
        # As the MULTILEADER states it: nothing flagged, the values AutoCAD stores by default.
        (1, by_block, continuous, -2, 4.0, None, 0),
        # Colour, linetype, lineweight, arrowhead size and arrowhead.
        (1, red, dashed, 50, 2.0, arrow, 2 | 4 | 8 | 16 | 32),
        # Path type and colour only; the lineweight, linetype and arrowhead stored are not flagged.
        (2, green, dashed, 100, 6.0, arrow, 1 | 2),
    ]
    start = dxf.index(f"\n  5\n{handle}\n")
    end = dxf.index("\n  0\n", start)
    entity = dxf[start:end]
    parts = entity.split("\n305\n}\n")
    assert len(parts) >= 4, "expected three LEADER_LINEs"
    out = []
    for i, part in enumerate(parts[:-1]):
        if i < 3 and "LEADER_LINE{" in part:
            path, color, lt, lw, size, arrow_h, flags = groups[i]
            # ezdxf ends the line with its own 92 (ByBlock); AutoCAD files 92 after 170.
            part = re.sub(r"\n 92\n-?\d+$", "", part)
            tags = [(170, path), (92, color), (340, lt), (171, lw), (40, size)]
            if arrow_h is not None:
                tags.append((341, arrow_h))
            tags.append((93, flags))
            part += "".join(f"\n{code:>3}\n{value}" for code, value in tags)
        out.append(part)
    out.append(parts[-1])
    return dxf[:start] + "\n305\n}\n".join(out) + dxf[end:]


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
    handles = model(doc)
    # The Model tab opens on the drawing, not on ezdxf's default view.
    doc.set_modelspace_vport(height=VIEW_HEIGHT, center=VIEW_CENTER)
    stream = io.StringIO()
    doc.write(stream)
    handle, arrow = handles["overrides"]
    dxf = leader_line_overrides(stream.getvalue(), handle, arrow, doc)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(dxf, encoding="utf-8", newline="\n")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
