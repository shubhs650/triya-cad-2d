"""Writes packages/testkit/fixtures/plotstyles/ezdxf.ctb and ezdxf.stb (M2-15).

An independent writer for the plot style table test: ezdxf's `acadctb` add-on (MIT) lays out the
text of a CTB and an STB, and `packages/testkit/src/plot/plot-styles.test.ts` checks that Triya's
reader reads back what this script set. DEC-047: the tables are authored here, never taken from an
AutoCAD install.

The container is packed here rather than by `acadctb.save`, whose `struct.pack("LLL", ...)` takes
eight bytes per size on 64-bit Linux; AutoCAD's layout (and ezdxf's own reader, which skips 60
bytes) has three little-endian 32-bit words: an Adler-32 of the compressed stream, the text size
and the compressed size.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/plotstyles/ezdxf-tables.py

Output is byte-for-byte reproducible (zlib level 9, no time stamps).
"""

from __future__ import annotations

import io
import pathlib
import struct
import zlib

from ezdxf.addons import acadctb

OUT = pathlib.Path(__file__).resolve().parents[2] / "packages/testkit/fixtures/plotstyles"


def pack(table: acadctb.PlotStyleTable, marker: bytes) -> bytes:
    text = io.StringIO()
    table.write_content(text)
    text.write("\0")
    body = text.getvalue().encode()
    packed = zlib.compress(body, 9)
    head = b"PIAFILEVERSION_2.0," + marker + b",compress\r\npmzlibcodec"
    return head + struct.pack("<III", zlib.adler32(packed), len(body), len(packed)) + packed


def ctb() -> bytes:
    t = acadctb.new_ctb()
    t.description = "Triya test pens"
    t.scale_factor = 2.0
    t.apply_factor = True
    for style in t:
        # ezdxf's default lineweight index 0 is a 0.00 mm pen in AutoCAD; 255 is "use object".
        style.lineweight = 255
    red = t[1]
    red.color = (0, 0, 0)  # plots black
    red.lineweight = 13  # 0.50 mm
    blue = t[5]
    blue.color = (0x12, 0x34, 0x56)
    blue.grayscale = True
    blue.dithering = False
    blue.screen = 40
    seven = t[7]
    seven.lineweight = 8  # 0.25 mm
    seven.linetype = 2
    seven.adaptive_linetype = False
    seven.linepattern_size = 0.75
    seven.end_style = acadctb.END_STYLE_BUTT
    seven.join_style = acadctb.JOIN_STYLE_BEVEL
    seven.fill_style = acadctb.FILL_STYLE_CROSSHATCH
    t[200].physical_pen_number = 3
    t[200].virtual_pen_number = 12
    return pack(t, b"CTBVER1")


def stb() -> bytes:
    t = acadctb.new_stb()
    t.description = "Triya named styles"
    # new_stb() already holds "Normal".
    for style in t.values():
        style.lineweight = 255
    thick = t.new_style("Thick", data={"description": "0.70 mm"})
    thick.lineweight = 17  # 0.70 mm
    screened = t.new_style("Screened")
    screened.screen = 30
    screened.lineweight = 255
    red = t.new_style("Red")
    red.color = (255, 0, 0)
    red.lineweight = 255
    return pack(t, b"STBVER1")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ezdxf.ctb").write_bytes(ctb())
    (OUT / "ezdxf.stb").write_bytes(stb())


if __name__ == "__main__":
    main()
