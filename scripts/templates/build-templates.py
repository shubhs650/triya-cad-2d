"""Writes the bundled drawing templates (M5-10, DEC-024, UI_SPEC.md §9, DEC-074):

- assets/templates/triya-iso.dxf, "Triya ISO (mm)": millimetres, ISO-25 dimension styles,
  A4-A0 landscape layouts;
- assets/templates/triya-ansi.dxf, "Triya ANSI (inch)": inches, decimal-inch dimension styles,
  ANSI A-E landscape layouts;
- assets/templates/no-template-imperial.dxf and no-template-metric.dxf, the drawings the Select
  Template dialog's "Open with no template - Imperial / Metric" opens (M5-10 part 2): layer 0,
  the Standard text style and the units' default dimension style (Standard; ISO-25 for metric),
  grid limits 12 x 9 in or 420 x 297 mm, and the layouts Layout1 and Layout2 on a letter or A4
  sheet, as AutoCAD's own defaults set a drawing up.

All are authored for Triya (DEC-047: no Autodesk template is copied or asked for). Each has the
layers, linetypes, text styles and dimension styles UI_SPEC.md §9 lists, and a layout per sheet
size holding the sheet's border, one viewport at 1:1 on the VIEWPORT layer, the title block (a
block of attribute definitions: TITLE, DWGNO, REV, SCALE, DATE, DRAWN, CHECKED, APPROVED,
PROJECT, CLIENT, SHEET) and the 4-row revision table (a block of attribute definitions REVn,
DESCn, DATEn, BYn), both inserted with their attributes in the sheet's lower-right corner.

The linetypes are read from the bundled .lin files (DEC-073), millimetre or inch.

Run from the repository root with the pinned ezdxf of scripts/dxf-audit/requirements.txt:

    python3 -I scripts/templates/build-templates.py

Output is byte-for-byte reproducible (fixed metadata, string hashing pinned); the testkit suite
packages/testkit/src/templates/templates.test.ts checks what the files hold.
"""

from __future__ import annotations

import os
import pathlib
import sys
from dataclasses import dataclass

import ezdxf

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "assets/templates"


@dataclass(frozen=True)
class Template:
    file: str
    insunits: int  # 4 millimetres, 1 inches
    measurement: int  # 1 metric, 0 imperial
    lin: str  # the bundled .lin file the linetypes come from
    # The grid unit the title block and the revision table are drawn in: 1 mm, or 0.04 in so that
    # the ANSI blocks are 7.2 in wide with 0.1 in text.
    g: float
    paper_units: str  # page_setup's units
    # Sheets: (layout name, canonical media name prefix, width, height) in paper units.
    sheets: tuple[tuple[str, str, float, float], ...]
    # The border's distance from the sheet's edge: (left, other sides), paper units.
    border: tuple[float, float]
    text_height: float  # $TEXTSIZE
    limits: tuple[float, float]  # model space limits ($LIMMAX)
    # Dimension styles: (name, DIMSCALE); the first is current.
    dimstyles: tuple[tuple[str, float], ...]
    dimvars: dict
    title_style: str  # the text style of the title block and revision table
    sheet_value: str  # the SHEET attribute's value


# ISO 5457: a 20 mm filing margin on the left, 10 mm on the other sides.
ISO = Template(
    file="triya-iso.dxf",
    insunits=4,
    measurement=1,
    lin="assets/linetypes/triya-drafting-iso.lin",
    g=1.0,
    paper_units="mm",
    sheets=(
        ("A4", "ISO_full_bleed_A4", 297.0, 210.0),
        ("A3", "ISO_full_bleed_A3", 420.0, 297.0),
        ("A2", "ISO_full_bleed_A2", 594.0, 420.0),
        ("A1", "ISO_full_bleed_A1", 841.0, 594.0),
        ("A0", "ISO_full_bleed_A0", 1189.0, 841.0),
    ),
    border=(20.0, 10.0),
    text_height=2.5,
    limits=(420.0, 297.0),
    dimstyles=(
        ("ISO-25", 1.0),
        ("ISO-25-5", 5.0),
        ("ISO-25-10", 10.0),
        ("ISO-25-20", 20.0),
        ("ISO-25-50", 50.0),
    ),
    # AutoCAD's documented metric initial values of these variables (AutoCAD 2024 Help, each
    # DIM* system variable's "Initial value ... (metric)").
    dimvars=dict(
        dimasz=2.5,
        dimcen=2.5,
        dimdli=3.75,
        dimexe=1.25,
        dimexo=0.625,
        dimgap=0.625,
        dimtxt=2.5,
        dimtad=1,
        dimtih=0,
        dimtoh=0,
        dimdec=2,
        dimtdec=2,
        dimzin=8,
        dimtzin=8,
        dimtofl=1,
        dimatfit=3,
        dimlunit=2,
        dimdsep=ord(","),
        dimaltf=0.03937007874,
        dimaltd=3,
    ),
    title_style="ISOCP",
    sheet_value="1/1",
)

# ASME Y14.1 sheets A-E, a 0.5 in border all round; decimal-inch dimensions as ASME Y14.5 draws
# them: 0.125 in text and arrows, text horizontal (unidirectional), three places, no leading zero.
ANSI = Template(
    file="triya-ansi.dxf",
    insunits=1,
    measurement=0,
    lin="assets/linetypes/triya-drafting.lin",
    g=0.04,
    paper_units="inch",
    sheets=(
        ("A", "ANSI_full_bleed_A", 11.0, 8.5),
        ("B", "ANSI_full_bleed_B", 17.0, 11.0),
        ("C", "ANSI_full_bleed_C", 22.0, 17.0),
        ("D", "ANSI_full_bleed_D", 34.0, 22.0),
        ("E", "ANSI_full_bleed_E", 44.0, 34.0),
    ),
    border=(0.5, 0.5),
    text_height=0.125,
    limits=(12.0, 9.0),
    dimstyles=(
        ("ANSI-DEC", 1.0),
        ("ANSI-DEC-2", 2.0),
        ("ANSI-DEC-4", 4.0),
        ("ANSI-DEC-8", 8.0),
        ("ANSI-DEC-16", 16.0),
    ),
    dimvars=dict(
        dimasz=0.125,
        dimcen=0.0625,
        dimdli=0.375,
        dimexe=0.125,
        dimexo=0.0625,
        dimgap=0.0625,
        dimtxt=0.125,
        dimtad=0,
        dimtih=1,
        dimtoh=1,
        dimdec=3,
        dimtdec=3,
        dimzin=4,
        dimtzin=4,
        dimtofl=1,
        dimatfit=3,
        dimlunit=2,
        dimdsep=ord("."),
        dimaltf=25.4,
        dimaltd=2,
    ),
    title_style="ROMANS",
    sheet_value="1 OF 1",
)

# UI_SPEC.md §9's layers: (name, ACI colour, linetype, lineweight in 1/100 mm or -3 default,
# plotted).
LAYERS = (
    ("Defpoints", 7, "Continuous", -3, False),
    ("CENTER", 1, "CENTER2", -3, True),
    ("HIDDEN", 2, "HIDDEN2", -3, True),
    ("DIMENSIONS", 3, "Continuous", -3, True),
    ("TEXT", 7, "Continuous", -3, True),
    ("HATCH", 8, "Continuous", -3, True),
    ("TITLE", 7, "Continuous", 50, True),
    ("VIEWPORT", 7, "Continuous", -3, False),
    ("NOTES", 7, "Continuous", -3, True),
    ("REVISION", 6, "Continuous", -3, True),
)

# Text styles: (name, font file). The SHX names are the ones Triya draws with its bundled
# Hershey fonts (oet-simplex for all three, packages/text catalog), as AutoCAD names them;
# Arial is the device's TrueType font.
TEXT_STYLES = (
    ("Standard", "simplex.shx"),
    ("ROMANS", "romans.shx"),
    ("ISOCP", "isocp.shx"),
    ("Arial", "arial.ttf"),
)

TITLE_BLOCK = "TRIYA-TITLE-BLOCK"
REVISION_TABLE = "TRIYA-REVISION-TABLE"

# The title block, 180 x 56 grid units, its insertion point its lower-right corner. Cells:
# (tag, label, prompt, x0, x1, y0, y1, value height); the label sits in the cell's upper left.
TITLE_CELLS = (
    ("PROJECT", "PROJECT", "Project", 0, 90, 44, 56, 3.5),
    ("CLIENT", "CLIENT", "Client", 90, 180, 44, 56, 3.5),
    ("TITLE", "TITLE", "Drawing title", 0, 180, 28, 44, 5.0),
    ("DRAWN", "DRAWN", "Drawn by", 0, 45, 14, 28, 2.5),
    ("CHECKED", "CHECKED", "Checked by", 45, 90, 14, 28, 2.5),
    ("APPROVED", "APPROVED", "Approved by", 90, 135, 14, 28, 2.5),
    ("DATE", "DATE", "Date", 135, 180, 14, 28, 2.5),
    ("DWGNO", "DRAWING NO.", "Drawing number", 0, 90, 0, 14, 3.5),
    ("REV", "REV", "Revision", 90, 112.5, 0, 14, 3.5),
    ("SCALE", "SCALE", "Scale", 112.5, 145, 0, 14, 2.5),
    ("SHEET", "SHEET", "Sheet", 145, 180, 0, 14, 2.5),
)
TITLE_W, TITLE_H = 180.0, 56.0

# The revision table, 180 x 30 grid units above the title block, its insertion point its
# lower-right corner: a heading row, then rows 1-4 upwards. Columns: (tag prefix, heading,
# prompt, x0, x1).
REVISION_COLUMNS = (
    ("REV", "REV", "Revision", 0, 15),
    ("DESC", "DESCRIPTION", "Description", 15, 120),
    ("DATE", "DATE", "Date", 120, 150),
    ("BY", "BY", "By", 150, 180),
)
REVISION_ROWS = 4
ROW_H = 6.0
LABEL_H = 1.8
REV_TEXT_H = 2.5


def read_lin(path: pathlib.Path) -> dict[str, tuple[str, list[float]]]:
    """The simple linetypes of a .lin file: name -> (description, pattern)."""
    out: dict[str, tuple[str, list[float]]] = {}
    lines = [ln.strip() for ln in path.read_text().splitlines()]
    for i, ln in enumerate(lines):
        if not ln.startswith("*"):
            continue
        name, _, desc = ln[1:].partition(",")
        spec = lines[i + 1].split(",")
        assert spec[0] == "A", ln
        out[name] = (desc, [float(v) for v in spec[1:]])
    return out


def tables(doc, t: Template) -> None:
    lin = read_lin(ROOT / t.lin)
    for name in ("CENTER2", "HIDDEN2"):
        desc, dashes = lin[name]
        # ezdxf takes the total length first, then the dashes and gaps.
        doc.linetypes.add(name, pattern=[sum(abs(d) for d in dashes), *dashes], description=desc)
    for name, color, linetype, lineweight, plot in LAYERS:
        # ezdxf makes Defpoints itself, named as AutoCAD names it.
        if doc.layers.has_entry(name):
            layer = doc.layers.get(name)
            layer.dxf.color, layer.dxf.linetype, layer.dxf.lineweight = color, linetype, lineweight
        else:
            layer = doc.layers.add(name, color=color, linetype=linetype, lineweight=lineweight)
        layer.dxf.plot = 1 if plot else 0
    for name, font in TEXT_STYLES:
        style = doc.styles.get(name) if name == "Standard" else doc.styles.add(name, font=font)
        style.dxf.font = font
        style.dxf.height = 0.0
        style.dxf.width = 1.0
    for name, scale in t.dimstyles:
        doc.dimstyles.new(name, dxfattribs={**t.dimvars, "dimscale": scale, "dimtxsty": "Standard"})
    # The Standard dimension style too, so that a drawing with no style chosen dimensions in the
    # template's units.
    standard = doc.dimstyles.get("Standard")
    for key, value in t.dimvars.items():
        standard.dxf.set(key, value)


def header(doc, t: Template) -> None:
    h = doc.header
    h["$INSUNITS"] = t.insunits
    h["$MEASUREMENT"] = t.measurement
    h["$LUNITS"] = 2
    h["$LTSCALE"] = 1.0
    h["$PSLTSCALE"] = 1
    h["$CELTSCALE"] = 1.0
    h["$LIMMIN"] = (0.0, 0.0)
    h["$LIMMAX"] = t.limits
    h["$TEXTSTYLE"] = "Standard"
    h["$TEXTSIZE"] = t.text_height
    h["$CLAYER"] = "0"
    h["$DIMASSOC"] = 2
    current = t.dimstyles[0][0]
    h["$DIMSTYLE"] = current
    # The header keeps the current dimension style's values (AutoCAD writes them so).
    for key, value in {**t.dimvars, "dimscale": 1.0}.items():
        h["$" + key.upper()] = value


def label(block, text: str, x: float, y: float, g: float, style: str) -> None:
    block.add_text(text, height=LABEL_H * g, dxfattribs={"style": style, "insert": (x * g, y * g)})


def attdef(block, tag, prompt, x, y, h, g, style, default="") -> None:
    block.add_attdef(
        tag,
        insert=(x * g, y * g),
        text=default,
        dxfattribs={"prompt": prompt, "height": h * g, "style": style},
    )


def title_block(doc, t: Template) -> None:
    g = t.g
    b = doc.blocks.new(TITLE_BLOCK, base_point=(TITLE_W * g, 0))
    thin = {"lineweight": 25}
    # The cells' lines: thin inside, the outline at the layer's weight.
    for tag, text, prompt, x0, x1, y0, y1, h in TITLE_CELLS:
        b.add_lwpolyline(
            [(x0 * g, y0 * g), (x1 * g, y0 * g), (x1 * g, y1 * g), (x0 * g, y1 * g)],
            close=True,
            dxfattribs=thin,
        )
        label(b, text, x0 + 1.5, y1 - 1.5 - LABEL_H, g, t.title_style)
        attdef(b, tag, prompt, x0 + 1.5, y0 + 2.5, h, g, t.title_style)
    b.add_lwpolyline(
        [(0, 0), (TITLE_W * g, 0), (TITLE_W * g, TITLE_H * g), (0, TITLE_H * g)],
        close=True,
    )

    r = doc.blocks.new(REVISION_TABLE, base_point=(TITLE_W * g, 0))
    # Row by row, upwards from the heading, so that a reference lists REV1, DESC1, DATE1, BY1,
    # REV2, ...
    for row in range(REVISION_ROWS + 1):
        y0, y1 = row * ROW_H, (row + 1) * ROW_H
        for prefix, heading, prompt, x0, x1 in REVISION_COLUMNS:
            r.add_lwpolyline(
                [(x0 * g, y0 * g), (x1 * g, y0 * g), (x1 * g, y1 * g), (x0 * g, y1 * g)],
                close=True,
                dxfattribs=thin,
            )
            if row == 0:
                label(r, heading, x0 + 1.5, 2.0, g, t.title_style)
            else:
                attdef(
                    r,
                    f"{prefix}{row}",
                    f"{prompt} (revision row {row})",
                    x0 + 1.5,
                    y0 + 1.75,
                    REV_TEXT_H,
                    g,
                    t.title_style,
                )
    height = (REVISION_ROWS + 1) * ROW_H
    r.add_lwpolyline(
        [(0, 0), (TITLE_W * g, 0), (TITLE_W * g, height * g), (0, height * g)], close=True
    )


def layouts(doc, t: Template) -> None:
    g = t.g
    left, other = t.border
    names = [s[0] for s in t.sheets]
    doc.layouts.rename("Layout1", names[0])
    for name in names[1:]:
        doc.layouts.new(name)
    for name, media, w, h in t.sheets:
        sheet = doc.layouts.get(name)
        sheet.page_setup(size=(w, h), units=t.paper_units, name=media, device="DWG To PDF.pc3")
        sheet.dxf_layout.dxf.current_style_sheet = "monochrome.ctb"
        # The sheet's own viewport (AutoCAD's number 1), which page_setup puts on a layer of
        # ezdxf's, goes on the template's VIEWPORT layer.
        sheet.main_viewport().dxf.layer = "VIEWPORT"
        x0, y0, x1, y1 = left, other, w - other, h - other
        sheet.add_lwpolyline(
            [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True, dxfattribs={"layer": "TITLE"}
        )
        # One viewport filling the border at 1:1, model space's origin at its lower-left corner.
        fw, fh = x1 - x0, y1 - y0
        sheet.add_viewport(
            center=((x0 + x1) / 2, (y0 + y1) / 2),
            size=(fw, fh),
            view_center_point=(fw / 2, fh / 2),
            view_height=fh,
            dxfattribs={"layer": "VIEWPORT"},
        )
        values = {"SCALE": "1:1", "SHEET": t.sheet_value, "REV": "-"}
        title = sheet.add_blockref(TITLE_BLOCK, (x1, y0), dxfattribs={"layer": "TITLE"})
        title.add_auto_attribs(values)
        rev = sheet.add_blockref(
            REVISION_TABLE, (x1, y0 + TITLE_H * g), dxfattribs={"layer": "TITLE"}
        )
        rev.add_auto_attribs({})
    doc.layouts.set_active_layout(names[1] if len(names) > 1 else names[0])
    if doc.layers.has_entry("VIEWPORTS"):
        doc.layers.remove("VIEWPORTS")


def build(t: Template) -> None:
    doc = ezdxf.new("R2018", units=t.insunits, setup=False)
    header(doc, t)
    tables(doc, t)
    title_block(doc, t)
    layouts(doc, t)
    # Model space shows its limits.
    doc.set_modelspace_vport(height=t.limits[1], center=(t.limits[0] / 2, t.limits[1] / 2))
    model_limits(doc, t.limits)
    save(doc, t.file)


@dataclass(frozen=True)
class Blank:
    """A drawing with no template (AutoCAD 2024 Help, "Select Template Dialog Box": Open with no
    template - Imperial / Metric creates a drawing from the internal defaults of that system)."""

    file: str
    insunits: int
    measurement: int
    paper_units: str
    media: str  # the layouts' canonical media name
    paper: tuple[float, float]  # landscape, paper units
    limits: tuple[float, float]
    text_height: float
    # The units' dimension variables: the Standard style's and the header's.
    dimvars: dict
    # The current dimension style when it is not Standard (metric's ISO-25, with dimvars).
    dimstyle: str | None


# AutoCAD's documented imperial initial values (AutoCAD 2024 Help, each DIM* system variable's
# "Initial value ... (imperial)"); ezdxf starts a drawing with the metric ones.
IMPERIAL_DIMVARS = dict(
    dimasz=0.18,
    dimcen=0.09,
    dimdli=0.38,
    dimexe=0.18,
    dimexo=0.0625,
    dimgap=0.09,
    dimtxt=0.18,
    dimtad=0,
    dimtih=1,
    dimtoh=1,
    dimdec=4,
    dimtdec=4,
    dimzin=0,
    dimtzin=0,
    dimtofl=0,
    dimatfit=3,
    dimlunit=2,
    dimdsep=ord("."),
    dimaltf=25.4,
    dimaltd=2,
)


BLANK_IMPERIAL = Blank(
    file="no-template-imperial.dxf",
    insunits=1,
    measurement=0,
    paper_units="inch",
    media="ANSI_full_bleed_A_(11.00_x_8.50_Inches)",
    paper=(11.0, 8.5),
    limits=(12.0, 9.0),
    text_height=0.2,
    dimvars=IMPERIAL_DIMVARS,
    dimstyle=None,
)

BLANK_METRIC = Blank(
    file="no-template-metric.dxf",
    insunits=4,
    measurement=1,
    paper_units="mm",
    media="ISO_full_bleed_A4_(297.00_x_210.00_MM)",
    paper=(297.0, 210.0),
    # AutoCAD's metric LIMMAX initial value, an A3 sheet.
    limits=(420.0, 297.0),
    text_height=2.5,
    dimvars=ISO.dimvars,
    dimstyle="ISO-25",
)


def build_blank(b: Blank) -> None:
    doc = ezdxf.new("R2018", units=b.insunits, setup=False)
    h = doc.header
    h["$INSUNITS"] = b.insunits
    h["$MEASUREMENT"] = b.measurement
    h["$LUNITS"] = 2
    h["$LTSCALE"] = 1.0
    h["$LIMMIN"] = (0.0, 0.0)
    h["$LIMMAX"] = b.limits
    h["$TEXTSTYLE"] = "Standard"
    h["$TEXTSIZE"] = b.text_height
    h["$CLAYER"] = "0"
    h["$DIMASSOC"] = 2
    h["$FILLETRAD"] = 0.0
    standard = doc.dimstyles.get("Standard")
    for key, value in b.dimvars.items():
        standard.dxf.set(key, value)
    if b.dimstyle:
        doc.dimstyles.new(b.dimstyle, dxfattribs={**b.dimvars, "dimtxsty": "Standard"})
    h["$DIMSTYLE"] = b.dimstyle or "Standard"
    # The header keeps the current dimension style's values.
    for key, value in {**b.dimvars, "dimscale": 1.0}.items():
        h["$" + key.upper()] = value
    # Layout1 as ezdxf makes it, and Layout2, both on the units' default sheet.
    doc.layouts.new("Layout2")
    for name in ("Layout1", "Layout2"):
        sheet = doc.layouts.get(name)
        sheet.page_setup(size=b.paper, units=b.paper_units, name=b.media, device="DWG To PDF.pc3")
        sheet.main_viewport().dxf.layer = "0"
    if doc.layers.has_entry("VIEWPORTS"):
        doc.layers.remove("VIEWPORTS")
    doc.set_modelspace_vport(height=b.limits[1], center=(b.limits[0] / 2, b.limits[1] / 2))
    model_limits(doc, b.limits)
    save(doc, b.file)


def model_limits(doc, limits: tuple[float, float]) -> None:
    """$LIMMIN/$LIMMAX: ezdxf writes them from model space's layout record when it saves."""
    msp = doc.modelspace()
    msp.dxf_layout.dxf.limmin = (0.0, 0.0)
    msp.dxf_layout.dxf.limmax = limits


def save(doc, file: str) -> None:
    auditor = doc.audit()
    if auditor.has_errors or auditor.has_fixes:
        auditor.print_error_report()
        auditor.print_fixed_errors()
        raise SystemExit(f"{file}: ezdxf's audit reported findings")
    OUT.mkdir(parents=True, exist_ok=True)
    doc.saveas(OUT / file)
    print(f"wrote {OUT / file}")


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
    for t in (ISO, ANSI):
        build(t)
    for b in (BLANK_IMPERIAL, BLANK_METRIC):
        build_blank(b)
    return 0


if __name__ == "__main__":
    sys.exit(main())
