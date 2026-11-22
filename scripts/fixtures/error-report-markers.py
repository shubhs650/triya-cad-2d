"""Writes packages/testkit/fixtures/error-report/MARKER-FILE-error-report.dxf (M7-08).

A thread-authored AC1032 drawing (DEC-047) for the error report's privacy test (PRD §8 G6,
TESTING.md §6): every kind of drawing content a report must never carry holds a marker string
that starts with MARKER, so the test can look for the word anywhere in the payload:

- text: TEXT, MTEXT, an attribute's value and tag, a dimension's text override;
- names: a layer, a block, a text style, a linetype, a dimension style, a layout, a
  registered application (APPID), a named view, a group, a UCS;
- xdata: a string on a LINE under that application;
- the file's own name.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/fixtures/error-report-markers.py

Output is byte-for-byte reproducible (fixed metadata, string hashing pinned).
"""

from __future__ import annotations

import os
import pathlib
import sys

import ezdxf

OUT = (
    pathlib.Path(__file__).resolve().parents[2]
    / "packages/testkit/fixtures/error-report/MARKER-FILE-error-report.dxf"
)


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
    doc = ezdxf.new("R2018", units=4, setup=True)  # millimetres
    doc.layers.add("MARKER_LAYER_WALLS", color=1)
    doc.styles.add("MARKER_STYLE_NOTES", font="romans.shx")
    doc.linetypes.add(
        "MARKER_LTYPE_FENCE", pattern=[0.75, 0.5, -0.25], description="MARKER_LTYPE_DESC ----"
    )
    doc.dimstyles.add("MARKER_DIMSTYLE_PLAN")
    doc.appids.add("MARKER_APPID_TAGS")
    doc.views.add("MARKER_VIEW_NORTH", dxfattribs={"height": 100, "width": 150, "center": (50, 50)})
    doc.ucs.add("MARKER_UCS_SITE", dxfattribs={"origin": (10, 10, 0)})

    block = doc.blocks.new("MARKER_BLOCK_DOOR")
    block.add_line((0, 0), (10, 0))
    block.add_attdef("MARKER_ATTRIB_TAG", (0, 2), dxfattribs={"height": 2.5})

    msp = doc.modelspace()
    attrs = {"layer": "MARKER_LAYER_WALLS"}
    line = msp.add_line((0, 0), (100, 0), dxfattribs=attrs)
    line.set_xdata("MARKER_APPID_TAGS", [(1000, "MARKER_XDATA_STRING"), (1040, 3.5)])
    msp.add_line((100, 0), (100, 60), dxfattribs=attrs)
    msp.add_text(
        "MARKER_TEXT_ROOM", height=5, dxfattribs={"style": "MARKER_STYLE_NOTES", "insert": (10, 20)}
    )
    msp.add_mtext("MARKER_MTEXT_NOTE\\Psecond line", dxfattribs={"char_height": 3, "insert": (10, 40)})
    ref = msp.add_blockref("MARKER_BLOCK_DOOR", (50, 10))
    ref.add_auto_attribs({"MARKER_ATTRIB_TAG": "MARKER_ATTRIB_VALUE"})
    dim = msp.add_linear_dim(
        base=(0, -10), p1=(0, 0), p2=(100, 0), text="MARKER_DIMTEXT_<>", dimstyle="MARKER_DIMSTYLE_PLAN"
    )
    dim.render()
    group = doc.groups.new("MARKER_GROUP_WALLS")
    group.extend([line])

    layout = doc.layouts.new("MARKER_LAYOUT_SHEET")
    layout.add_text("MARKER_PAPER_TEXT", height=3, dxfattribs={"insert": (20, 20)})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(OUT)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
