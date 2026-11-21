"""Writes packages/testkit/fixtures/plot-styles/named-plot-styles.dxf (M6-07).

A thread-authored AC1032 drawing (DEC-047: no AutoCAD sample is asked for) that plots by named
plot styles ($PSTYLEMODE 0), for the Layer Properties Manager's Plot Style and VP Plot Style
columns and VPLAYER PStyle:

- ACAD_PLOTSTYLENAME holds Normal (the default), Heavy and Light;
- layers WALLS (red, plot style Heavy), PIPING (blue, no plot style of its own: Normal) and
  VIEWPORTS (green);
- Layout1 (A3 landscape) with two viewports side by side on the same plan;
- PIPING's plot style overridden to Light in the right viewport, filed as Triya files it
  (DEC-078): the layer's ADSK_XREC_LAYER_PLOTSTYLE_OVR XRECORD, a `102 {ADSK_LYR_PLOTSTYLE_OVERRIDE`
  group holding the viewport (335) and the plot style (390).

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/fixtures/named-plot-styles.py

Output is byte-for-byte reproducible (fixed metadata, string hashing pinned).
"""

from __future__ import annotations

import os
import pathlib
import sys

import ezdxf

OUT = (
    pathlib.Path(__file__).resolve().parents[2]
    / "packages/testkit/fixtures/plot-styles/named-plot-styles.dxf"
)

VIEW_CENTER = (100.0, 60.0)
VIEW_HEIGHT = 140.0
FRAME_W, FRAME_H = 180.0, 160.0
CENTERS = {"left": (110.0, 150.0), "right": (310.0, 150.0)}


def plot_styles(doc: ezdxf.document.Drawing) -> dict[str, str]:
    """Heavy and Light beside Normal in ACAD_PLOTSTYLENAME; their placeholders' handles by name."""
    names = doc.rootdict.get("ACAD_PLOTSTYLENAME")
    out = {"Normal": names["Normal"].dxf.handle}
    for name in ("Heavy", "Light"):
        ph = doc.objects.add_placeholder(owner=names.dxf.handle)
        names[name] = ph
        out[name] = ph.dxf.handle
    return out


def model(doc: ezdxf.document.Drawing, styles: dict[str, str]) -> None:
    walls = doc.layers.add("WALLS", color=1)  # red
    walls.dxf.lineweight = 35
    walls.dxf.plotstyle_handle = styles["Heavy"]
    piping = doc.layers.add("PIPING", color=5)  # blue
    piping.dxf.lineweight = 25
    doc.layers.add("VIEWPORTS", color=3)

    msp = doc.modelspace()
    msp.add_lwpolyline(
        [(0, 0), (200, 0), (200, 120), (0, 120)], close=True, dxfattribs={"layer": "WALLS"}
    )
    msp.add_line((80, 0), (80, 70), dxfattribs={"layer": "WALLS"})
    msp.add_lwpolyline(
        [(10, 100), (170, 100), (170, 20), (190, 20)], dxfattribs={"layer": "PIPING"}
    )
    msp.add_circle((60, 100), 6, dxfattribs={"layer": "PIPING"})
    # Model space opens on the plan (ezdxf's *Active view would show nothing of it).
    doc.set_modelspace_vport(height=VIEW_HEIGHT, center=VIEW_CENTER)


def layout(doc: ezdxf.document.Drawing, styles: dict[str, str]) -> None:
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
    piping = doc.layers.get("PIPING")
    xdict = piping.new_extension_dict()
    record = xdict.add_xrecord("ADSK_XREC_LAYER_PLOTSTYLE_OVR")
    record.reset(
        [
            (102, "{ADSK_LYR_PLOTSTYLE_OVERRIDE"),
            (335, vps["right"].dxf.handle),
            (390, styles["Light"]),
            (102, "}"),
        ]
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
    doc = ezdxf.new("R2018", units=4)  # millimetres
    doc.header["$LWDISPLAY"] = 1
    doc.header["$PSTYLEMODE"] = 0  # named plot styles
    styles = plot_styles(doc)
    model(doc, styles)
    layout(doc, styles)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(OUT)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
