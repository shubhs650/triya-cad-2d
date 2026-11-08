"""Writes corpus/public/self-authored/viewport-overrides.dxf (M1-62).

A thread-authored AC1032 drawing (DEC-047: no AutoCAD sample is asked for) with four viewports
on one view of the same model:

- top left: plain, rectangular;
- top right: rectangular, with viewport layer overrides on two layers (VPLAYER-style colour,
  linetype, lineweight and transparency), written by ezdxf's `Layer.get_vp_overrides()` as the
  `ADSK_XREC_LAYER_*_OVR` XRECORDs AutoCAD keeps in each layer's extension dictionary;
- bottom left: clipped by a closed LWPOLYLINE (DXF 340, flag 0x10000);
- bottom right: clipped by a CIRCLE.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/corpus/viewport-overrides.py

Output is byte-for-byte reproducible (fixed metadata, fixed handles), so the committed file's
sha256 in corpus/corpus.json only changes when this script does.
"""

from __future__ import annotations

import pathlib
import sys

import ezdxf
from ezdxf.lldxf import const

OUT = pathlib.Path(__file__).resolve().parents[2] / "corpus/public/self-authored/viewport-overrides.dxf"

# The viewports' shared view: the model's extents with a margin, in model units (mm).
VIEW_CENTER = (100.0, 60.0)
VIEW_HEIGHT = 140.0
# Each viewport's frame on the A3 landscape sheet, paper mm.
FRAME_W, FRAME_H = 180.0, 120.0
CENTERS = {
    "plain": (105.0, 212.0),
    "overrides": (305.0, 212.0),
    "polyline": (105.0, 80.0),
    "circle": (305.0, 80.0),
}


def model(doc: ezdxf.document.Drawing) -> None:
    doc.linetypes.add(
        "TRIYA_DASHED",
        pattern=[7.5, 5.0, -2.5],
        description="Dashed __ __ __ (Triya test linetype)",
    )
    walls = doc.layers.add("WALLS", color=1)  # red
    walls.dxf.lineweight = 35
    piping = doc.layers.add("PIPING", color=5)  # blue
    piping.dxf.lineweight = 25
    doc.layers.add("GRID", color=8)
    doc.layers.add("VIEWPORTS", color=3)

    msp = doc.modelspace()
    # A plan: an outer wall, two inner walls, a pipe run with two valves, a grid.
    msp.add_lwpolyline(
        [(0, 0), (200, 0), (200, 120), (0, 120)], close=True, dxfattribs={"layer": "WALLS"}
    )
    msp.add_line((80, 0), (80, 70), dxfattribs={"layer": "WALLS"})
    msp.add_line((80, 70), (140, 70), dxfattribs={"layer": "WALLS"})
    msp.add_lwpolyline(
        [(10, 100), (170, 100), (170, 20), (190, 20)], dxfattribs={"layer": "PIPING"}
    )
    for x, y in [(60, 100), (170, 60)]:
        msp.add_circle((x, y), 6, dxfattribs={"layer": "PIPING"})
    for x in range(20, 200, 40):
        msp.add_line((x, 5), (x, 115), dxfattribs={"layer": "GRID"})
    for y in range(20, 120, 40):
        msp.add_line((5, y), (195, y), dxfattribs={"layer": "GRID"})


def layout(doc: ezdxf.document.Drawing) -> None:
    paper = doc.layouts.get("Layout1")
    paper.page_setup(size=(420, 297), margins=(10, 10, 10, 10), units="mm")
    vps = {}
    for name, center in CENTERS.items():
        vp = paper.add_viewport(
            center=center,
            size=(FRAME_W, FRAME_H),
            view_center_point=VIEW_CENTER,
            view_height=VIEW_HEIGHT,
            dxfattribs={"layer": "VIEWPORTS"},
        )
        vps[name] = vp

    # Overrides in the top-right viewport only: WALLS turns green, 0.70 mm and 50 %
    # transparent; PIPING turns orange (true colour) and dashed.
    vp = vps["overrides"].dxf.handle
    walls = doc.layers.get("WALLS").get_vp_overrides()
    walls.set_color(vp, 3)
    walls.set_lineweight(vp, 70)
    walls.set_transparency(vp, 0.5)
    walls.commit()
    piping = doc.layers.get("PIPING").get_vp_overrides()
    piping.set_rgb(vp, (255, 128, 0))
    piping.set_linetype(vp, "TRIYA_DASHED")
    piping.commit()

    # Non-rectangular clips: the clip entity is a paper-space entity the viewport names in
    # DXF 340 (and which names the viewport in its reactors); its extents are the frame.
    cx, cy = CENTERS["polyline"]
    hw, hh = FRAME_W / 2, FRAME_H / 2
    pline = paper.add_lwpolyline(
        [
            (cx - hw, cy - hh),
            (cx + hw, cy - hh),
            (cx + hw, cy),
            (cx, cy + hh),
            (cx - hw, cy + hh),
        ],
        close=True,
        dxfattribs={"layer": "VIEWPORTS"},
    )
    clip(vps["polyline"], pline)
    cx, cy = CENTERS["circle"]
    r = FRAME_H / 2
    circle = paper.add_circle((cx, cy), r, dxfattribs={"layer": "VIEWPORTS"})
    clip(vps["circle"], circle, size=(2 * r, 2 * r))


def clip(vp, entity, size=None) -> None:
    vp.dxf.flags = vp.dxf.flags | const.VSF_NON_RECTANGULAR_CLIPPING
    vp.dxf.clipping_boundary_handle = entity.dxf.handle
    if size is not None:
        vp.dxf.width, vp.dxf.height = size
    entity.set_reactors([vp.dxf.handle])


def main() -> int:
    if ezdxf.__version__ != "1.4.5":
        print(f"expected ezdxf 1.4.5 (scripts/dxf-audit/requirements.txt), got {ezdxf.__version__}")
        return 1
    ezdxf.options.write_fixed_meta_data_for_testing = True
    doc = ezdxf.new("R2018", units=4)  # millimetres
    doc.header["$LWDISPLAY"] = 1
    model(doc)
    layout(doc)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(OUT)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
