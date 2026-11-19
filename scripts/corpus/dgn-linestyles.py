"""Writes corpus/public/self-authored/dgn-linestyles.dxf (M5-09 part 5).

A thread-authored AC1032 drawing (DEC-047: no AutoCAD sample is asked for) holding the DGN
linestyle data AutoCAD keeps for linetypes imported from MicroStation, which PURGE's "Orphaned
data" takes when no linetype uses it (AutoCAD Help, "Purge Dialog Box": "Orphaned data ... purge
DGN linestyle data from the drawing that's not used by any linetypes"). No public corpus file has
any.

How AutoCAD files it is what its own DGN purge tool reads (Kean Walmsley, "Purging unwanted DGN
linestyle data from an AutoCAD drawing using .NET", keanw.com, 2012-12, and its 2013/2014
updates, the code of AutoCAD's DGN hotfix; Open Design Alliance, "Using .dgn Line Styles in a
.dwg File"):

- each linetype made from a DGN line style has a `DGNLSDEF` entry in its extension dictionary,
  the line style definition (`AcDbLSDefinition`), which refers to the component drawing it;
- the components are entries of the named-object dictionary's `ACAD_DGNLINESTYLECOMP`
  dictionary: stroke patterns (`AcDbLSStrokePatternComponent`), internal (hardware) line codes
  (`AcDbLSInternalComponent`), compounds of other components (`AcDbLSCompoundComponent`), point
  components placing symbols along a stroke pattern (`AcDbLSPointComponent`) and symbols
  (`AcDbLSSymbolComponent`), each drawn by an anonymous block;
- every one of those links is a hard pointer (DXF 340), which is all the tool follows.

What a component holds beyond its links (stroke lengths, widths, symbol offsets) is not public;
these objects hold their links only, and their DXF names (the CLASSES entries' DXF 1) are made up
for this file: Triya keys on the dictionary names and the links, as the tool does, never on them.

The drawing:

- DGN_DASH, used by a line: its definition draws the stroke pattern DGN_DASH_STROKE;
- DGN_RAIL, used by a line: a compound of DGN_RAIL_STROKE and the point component
  DGN_RAIL_POINTS, which places the symbol DGN_RAIL_TIE (anonymous block *U1, a short line);
- DGN_UNUSED, a linetype nothing uses (PURGE's Linetypes offer it): its definition draws
  DGN_UNUSED_STROKE and DGN_DASH_STROKE, so purging it leaves DGN_UNUSED_STROKE orphaned and
  DGN_DASH_STROKE in use;
- orphaned data, which no linetype uses: the compound DGN_OLD_COMPOUND of DGN_OLD_STROKE and the
  symbol DGN_OLD_SYMBOL (anonymous block *U2, a circle), and the internal component
  DGN_OLD_INTERNAL (line code 2, "Dash").

Each linetype keeps the dashes AutoCAD gives it as its own pattern.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/corpus/dgn-linestyles.py

Output is byte-for-byte reproducible (fixed metadata, fixed handles, string hashing pinned), so the
committed file's sha256 in corpus/corpus.json only changes when this script does.
"""

from __future__ import annotations

import io
import os
import pathlib
import sys

import ezdxf

OUT = pathlib.Path(__file__).resolve().parents[2] / "corpus/public/self-authored/dgn-linestyles.dxf"

VIEW_CENTER = (50.0, 20.0)
VIEW_HEIGHT = 60.0

# C++ class → the made-up DXF name its CLASSES entry gives (see the docstring).
CLASSES = {
    "AcDbLSDefinition": "LSDEFINITION",
    "AcDbLSStrokePatternComponent": "LSSTROKEPATTERNCOMPONENT",
    "AcDbLSInternalComponent": "LSINTERNALCOMPONENT",
    "AcDbLSCompoundComponent": "LSCOMPOUNDCOMPONENT",
    "AcDbLSPointComponent": "LSPOINTCOMPONENT",
    "AcDbLSSymbolComponent": "LSSYMBOLCOMPONENT",
}

STROKE = "AcDbLSStrokePatternComponent"
INTERNAL = "AcDbLSInternalComponent"
COMPOUND = "AcDbLSCompoundComponent"
POINT = "AcDbLSPointComponent"
SYMBOL = "AcDbLSSymbolComponent"
DEFINITION = "AcDbLSDefinition"


def model(doc: ezdxf.document.Drawing) -> dict[str, str]:
    """Draws the drawing and files its line style data as XRECORDs; returns handle → C++ class
    of each, which `retype` makes them."""
    doc.layers.add("DGN", color=3)
    for name, pattern in (
        ("DGN_DASH", [8.0, 5.0, -3.0]),
        ("DGN_RAIL", [10.0, 8.0, -2.0]),
        ("DGN_UNUSED", [6.0, 4.0, -2.0]),
    ):
        doc.linetypes.add(name, pattern, description=f"{name} (DGN line style)")

    msp = doc.modelspace()
    msp.add_line((10, 30), (90, 30), dxfattribs={"layer": "DGN", "linetype": "DGN_DASH"})
    msp.add_line((10, 10), (90, 10), dxfattribs={"layer": "DGN", "linetype": "DGN_RAIL"})

    tie = doc.blocks.new_anonymous_block("U")  # *U1
    tie.add_line((0, -1), (0, 1))
    ring = doc.blocks.new_anonymous_block("U")  # *U2
    ring.add_circle((0, 0), 0.5)

    classes: dict[str, str] = {}
    comps = doc.rootdict.add_new_dict("ACAD_DGNLINESTYLECOMP", hard_owned=True)

    def component(name: str, cls: str):
        x = comps.add_xrecord(name)
        classes[x.dxf.handle] = cls
        return x

    dash_stroke = component("DGN_DASH_STROKE", STROKE)
    rail_stroke = component("DGN_RAIL_STROKE", STROKE)
    rail_tie = component("DGN_RAIL_TIE", SYMBOL)
    rail_points = component("DGN_RAIL_POINTS", POINT)
    rail = component("DGN_RAIL_COMPOUND", COMPOUND)
    unused_stroke = component("DGN_UNUSED_STROKE", STROKE)
    old_stroke = component("DGN_OLD_STROKE", STROKE)
    old_symbol = component("DGN_OLD_SYMBOL", SYMBOL)
    old = component("DGN_OLD_COMPOUND", COMPOUND)
    old_internal = component("DGN_OLD_INTERNAL", INTERNAL)

    def links(x, *targets: str) -> None:
        x.reset([(340, t) for t in targets])

    links(dash_stroke)
    links(rail_stroke)
    links(rail_tie, tie.block_record_handle)
    links(rail_points, rail_stroke.dxf.handle, rail_tie.dxf.handle)
    links(rail, rail_stroke.dxf.handle, rail_points.dxf.handle)
    links(unused_stroke)
    links(old_stroke)
    links(old_symbol, ring.block_record_handle)
    links(old, old_stroke.dxf.handle, old_symbol.dxf.handle)
    old_internal.reset([(90, 2)])

    for name, uses in (
        ("DGN_DASH", [dash_stroke]),
        ("DGN_RAIL", [rail]),
        ("DGN_UNUSED", [unused_stroke, dash_stroke]),
    ):
        lt = doc.linetypes.get(name)
        definition = lt.new_extension_dict().add_xrecord("DGNLSDEF")
        classes[definition.dxf.handle] = DEFINITION
        links(definition, *(u.dxf.handle for u in uses))
    return classes


def retype(text: str, classes: dict[str, str]) -> str:
    """Makes the placeholder XRECORDs the line style objects they stand for, and lists their
    classes: each takes its class's DXF name and subclass marker, without the XRECORD's cloning
    flag (DXF 280)."""
    lines = text.split("\n")
    pairs = [(lines[i], lines[i + 1]) for i in range(0, len(lines) - 1, 2)]
    out: list[tuple[str, str]] = []
    counts = {cls: 0 for cls in CLASSES}
    i = 0
    while i < len(pairs):
        code, value = pairs[i]
        if code.strip() == "0" and value == "XRECORD":
            body = []
            j = i + 1
            while pairs[j][0].strip() != "0":
                body.append(pairs[j])
                j += 1
            handle = next(v for c, v in body if c.strip() == "5")
            cls = classes.get(handle)
            if cls:
                counts[cls] += 1
                out.append((code, CLASSES[cls]))
                for c, v in body:
                    if c.strip() == "100" and v == "AcDbXrecord":
                        out.append((c, cls))
                    elif c.strip() == "280":
                        continue
                    else:
                        out.append((c, v))
                i = j
                continue
        out.append(pairs[i])
        i += 1
    # The CLASSES entries, before the section's end.
    end = next(k for k, (_, v) in enumerate(out) if v == "CLASSES")
    while out[end][1] != "ENDSEC":
        end += 1
    entries: list[tuple[str, str]] = []
    for cls, dxf_name in CLASSES.items():
        entries += [
            ("  0", "CLASS"),
            ("  1", dxf_name),
            ("  2", cls),
            ("  3", "AcDgnLS"),
            (" 90", "1153"),
            (" 91", str(counts[cls])),
            ("280", "0"),
            ("281", "0"),
        ]
    out[end:end] = entries
    return "\n".join(f"{c}\n{v}" for c, v in out) + "\n"


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
    classes = model(doc)
    # The Model tab opens on the drawing, not on ezdxf's default view.
    doc.set_modelspace_vport(height=VIEW_HEIGHT, center=VIEW_CENTER)
    stream = io.StringIO()
    doc.write(stream)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(retype(stream.getvalue(), classes), encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
