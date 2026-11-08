"""Writes corpus/public/self-authored/transparency.dxf (M1-108).

A thread-authored AC1032 drawing (DEC-047: no AutoCAD sample is asked for) that shows every way an
object gets its transparency (DXF 440), each one laid over an opaque red band so the band shows
through:

- four blue solid hatches at 0, 30, 60 and 90 % of their own;
- a hatch and a wide line ByLayer on GLASS, a layer that is 50 % transparent (its AcCmTransparency
  xdata, as AutoCAD files a layer's transparency);
- a block, PANE, holding a ByBlock hatch, a circle on layer 0 and an opaque line of its own value,
  inserted on GLASS at 70 % and on layer CLEAR opaque;
- on Layout1, two viewports on the same view: the right one overrides BACK to 60 % and GLASS to
  opaque (VPLAYER-style `ADSK_XREC_LAYER_ALPHA_OVR`, written by ezdxf's `Layer.get_vp_overrides()`).

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/corpus/transparency.py

Output is byte-for-byte reproducible (fixed metadata, fixed handles, string hashing pinned), so the committed file's
sha256 in corpus/corpus.json only changes when this script does.
"""

from __future__ import annotations

import os
import pathlib
import sys

import ezdxf
from ezdxf.colors import TRANSPARENCY_BYBLOCK

OUT = pathlib.Path(__file__).resolve().parents[2] / "corpus/public/self-authored/transparency.dxf"

# The viewports' shared view: the model's extents with a margin, in model units (mm).
VIEW_CENTER = (100.0, 60.0)
VIEW_HEIGHT = 140.0
FRAME_W, FRAME_H = 190.0, 150.0
# Paper-space coordinates start at the printable area's lower-left corner (400 × 277 mm).
CENTERS = {"plain": (100.0, 138.5), "overrides": (300.0, 138.5)}


def square(x: float, y: float, size: float) -> list[tuple[float, float]]:
    return [(x, y), (x + size, y), (x + size, y + size), (x, y + size)]


def solid_hatch(layout, points, color: int, **dxfattribs):
    # add_hatch sets DXF 62 from its own `color` argument, over any in dxfattribs.
    hatch = layout.add_hatch(color=color, dxfattribs=dxfattribs)
    hatch.paths.add_polyline_path(points, is_closed=True)
    return hatch


def model(doc: ezdxf.document.Drawing) -> None:
    doc.layers.add("BACK", color=1)  # red, opaque
    glass = doc.layers.add("GLASS", color=3)  # green
    glass.transparency = 0.5
    glass.dxf.lineweight = 100
    doc.layers.add("CLEAR", color=4)  # cyan, opaque
    doc.layers.add("VIEWPORTS", color=8)

    msp = doc.modelspace()
    # The opaque band everything is laid over.
    solid_hatch(msp, [(0, 45), (200, 45), (200, 75), (0, 75)], layer="BACK", color=256)

    # Row 1 (top): blue squares with transparency values of their own.
    for i, t in enumerate([0.0, 0.3, 0.6, 0.9]):
        h = solid_hatch(msp, square(10 + 50 * i, 65, 30), layer="CLEAR", color=5)
        h.transparency = t

    # Row 2 (middle): ByLayer on GLASS, a hatch and a wide line.
    solid_hatch(msp, square(10, 25, 30), layer="GLASS", color=256)
    msp.add_line((50, 20), (90, 100), dxfattribs={"layer": "GLASS", "color": 256})

    # Row 3 (bottom): PANE references. ByBlock hatch (magenta), layer-0 circle, opaque line.
    pane = doc.blocks.new("PANE")
    hatch = solid_hatch(pane, square(0, 0, 30), layer="0", color=6)
    hatch.dxf.transparency = TRANSPARENCY_BYBLOCK
    pane.add_circle((15, 15), 18, dxfattribs={"layer": "0", "color": 256, "lineweight": 70})
    line = pane.add_line((0, 15), (30, 15), dxfattribs={"layer": "0", "color": 7})
    line.transparency = 0.0
    line.dxf.lineweight = 50
    shaded = msp.add_blockref("PANE", (110, 50), dxfattribs={"layer": "GLASS"})
    shaded.transparency = 0.7
    msp.add_blockref("PANE", (160, 50), dxfattribs={"layer": "CLEAR"})


def layout(doc: ezdxf.document.Drawing) -> None:
    paper = doc.layouts.get("Layout1")
    paper.page_setup(size=(420, 297), margins=(10, 10, 10, 10), units="mm")
    vps = {}
    for name, center in CENTERS.items():
        vps[name] = paper.add_viewport(
            center=center,
            size=(FRAME_W, FRAME_H),
            view_center_point=VIEW_CENTER,
            view_height=VIEW_HEIGHT,
            dxfattribs={"layer": "VIEWPORTS"},
        )
    vp = vps["overrides"].dxf.handle
    back = doc.layers.get("BACK").get_vp_overrides()
    back.set_transparency(vp, 0.6)
    back.commit()
    glass = doc.layers.get("GLASS").get_vp_overrides()
    glass.set_transparency(vp, 0.0)
    glass.commit()


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
    doc.header["$LWDISPLAY"] = 1
    model(doc)
    layout(doc)
    # The Model tab opens on the drawing, not on ezdxf's default view.
    doc.set_modelspace_vport(height=VIEW_HEIGHT, center=VIEW_CENTER)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(OUT)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
