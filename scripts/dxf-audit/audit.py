"""DXF validity gate (roadmap M1-105, DEC-047 item 7).

Loads every AC1032 DXF save the corpus suites wrote (TRIYA_DXF_AUDIT_DIR, see
packages/testkit/src/dxf-audit/saves.ts) with ezdxf's ``recover.readfile`` and runs
``doc.audit()``. A save passes when neither reports anything: every recover or audit error or
fix is a finding. The only findings allowed are those listed for that corpus file in
``exceptions.json``, each with its reason, and only while ezdxf reports the same code on the
source file itself. A stale exception (the source no longer reports it, or no save does) fails
too, so the list cannot rot.

Before the saves, a canary proves the gate can fail: one save is copied with the owner handle of
an object in its OBJECTS section pointed at a handle that does not exist (a dangling owner), and
the gate must report it.

ezdxf runs in CI only (``requirements.txt``); it is never shipped in the app.

Usage: python3 scripts/dxf-audit/audit.py <saves dir> [--corpus corpus] [--exceptions FILE]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

KINDS = (
    "unedited",
    "resaved",
    "edited",
    "markup",
    "mleader",
    "session",
    "paste",
    "dimension",
    "properties",
    "views",
    "hatch",
    "categories",
    "table",
    "tablestyle",
    "block",
    "wblock",
    "bedit",
    "attsync",
    "refedit",
)
# Saves of the thread-authored test drawings that are not corpus files (Rule 0), and of corpus
# files edited by a testkit suite rather than the corpus suites, as
# (fixture path, kind): each must be there and pass the audit with no exception. M5-04 part 2:
# XREF Bind of the xref set's parent, both bind types (packages/testkit/src/xref/xref-bind.test.ts).
FIXTURE_SAVES = (
    ("fixtures/xref/xref-parent.dxf", "bind"),
    ("fixtures/xref/xref-parent.dxf", "bind-insert"),
    ("fixtures/xref/xref-parent.dxf", "bind-objects"),
    # XCLIP New boundary, OFF, Delete and generate Polyline on ezdxf's xclip.dxf (M5-04 part 3).
    ("third-party/ezdxf/examples_dxf/xclip.dxf", "xclip"),
    # XCLIP Invert clip's ACAD_XREC_ROUNDTRIP records on ezdxf's xclip.dxf (M5-04 part 11).
    ("third-party/ezdxf/examples_dxf/xclip.dxf", "xclip-invert"),
    # XCLIP carried by COPY, MIRROR and ARRAY on ezdxf's xclip.dxf (M5-16).
    ("third-party/ezdxf/examples_dxf/xclip.dxf", "xclip-copy"),
    # XCLIP carried by COPYCLIP, CUTCLIP and PASTECLIP: xclip.dxf pasted into itself and into
    # traces.dxf (M5-17, packages/testkit/src/xref/xclip-paste.test.ts).
    ("third-party/ezdxf/examples_dxf/xclip.dxf", "xclip-paste"),
    ("self-authored/traces.dxf", "xclip-paste"),
    # LAYDEL and LAYMRG of every layer they can take on ACadSharp's AC1032 sample (M5-06 part 2,
    # packages/testkit/src/layers/layer-cleanup.test.ts).
    ("third-party/acadsharp/sample_AC1032_ascii.dxf", "laydel"),
    ("third-party/acadsharp/sample_AC1032_ascii.dxf", "laymrg"),
    # Layer filters added beside AutoCAD's own empty ACLYDICTIONARY, and to a drawing without one
    # (M5-07 part 4, packages/testkit/src/export/layer-filters.corpus.test.ts).
    ("third-party/acadsharp/sample_AC1032_ascii.dxf", "layerfilters"),
    ("third-party/ezdxf/examples_dxf/colors.dxf", "layerfilters"),
    # The filter menu's Convert to Group Filter and Isolate Group in a layout's viewports (M5-07
    # part 6, same test file).
    ("third-party/acadsharp/sample_AC1032_ascii.dxf", "layerfilters-menu"),
    # IMAGECLIP, IMAGEADJUST, IMAGEQUALITY and IMAGEFRAME on ezdxf's images.dxf (M5-04 part 4).
    ("third-party/ezdxf/examples_dxf/images.dxf", "images"),
    # IMAGEATTACH on a drawing without images and on one with them (M5-04 part 5,
    # packages/testkit/src/raster/image-attach.test.ts).
    ("third-party/ezdxf/examples_dxf/colors.dxf", "imageattach"),
    ("third-party/ezdxf/examples_dxf/images.dxf", "imageattach"),
    # XATTACH of the xref set's files on a drawing without xrefs (M5-04 part 6,
    # packages/testkit/src/xref/xref-attach.test.ts).
    ("third-party/ezdxf/examples_dxf/colors.dxf", "xattach"),
    # XBIND of the xref set's block and layers (M5-04 part 7,
    # packages/testkit/src/xref/xbind.test.ts).
    ("fixtures/xref/xref-parent.dxf", "xbind"),
    # XBIND of a block holding an image and a PDF underlay (M5-04 part 16, same test file).
    ("fixtures/xref/xref-parent.dxf", "xbind-pictures"),
    # -XREF Path and Pathtype of the xref set's xrefs (M5-04 part 15,
    # packages/testkit/src/xref/xref-path.test.ts).
    ("fixtures/xref/xref-parent.dxf", "xref-path"),
    # A reference scaled differently in X and Y edited in place, a line and a circle drawn into
    # its block (M5-02 part 8, packages/testkit/src/export/refedit-scaled.corpus.test.ts).
    ("third-party/ezdxf/examples_dxf/colors.dxf", "refedit-scaled"),
    # The xref set's title block as REFCLOSE writes it after REFEDIT of its attachment (M5-02
    # part 6, packages/testkit/src/xref/refedit-xref.test.ts).
    ("fixtures/xref/xref-child-tb.dxf", "refedit-xref"),
    # Its LOGO as REFCLOSE writes it after REFEDIT of the block through the attachment (M5-02
    # part 7, same test file).
    ("fixtures/xref/xref-child-tb.dxf", "refedit-xref-block"),
    # PDFATTACH on a drawing without underlays and on the underlay fixture (M5-04 part 8,
    # packages/testkit/src/underlay/pdf-attach.test.ts).
    ("third-party/ezdxf/examples_dxf/colors.dxf", "pdfattach"),
    ("fixtures/underlay/pdf-underlay.dxf", "pdfattach"),
    # PDFCLIP and PDFADJUST on the underlay fixture (M5-04 part 9,
    # packages/testkit/src/underlay/pdf-clip.test.ts).
    ("fixtures/underlay/pdf-underlay.dxf", "pdfclip"),
    # ATTDEF's definitions, a block of them and a reference (M5-03 part 1,
    # packages/testkit/src/attributes/attdef.test.ts).
    ("third-party/ezdxf/examples_dxf/colors.dxf", "attdef"),
    # ATTREDEF of the title-block test drawing's block from new objects (M5-03 part 3,
    # packages/testkit/src/attributes/attredef.test.ts).
    ("fixtures/attributes/title-block.dxf", "attredef"),
    # Fields from Insert Field in ATTDEF's dialog (a block of the definition and a reference)
    # and in EATTEDIT on the title-block test drawing (M5-03 part 4,
    # packages/testkit/src/attributes/attribute-fields.test.ts).
    ("fixtures/attributes/title-block.dxf", "attfield"),
    # LINETYPE's loads (text linetypes too), reload and delete on ezdxf's colors.dxf (M5-08
    # part 1, packages/testkit/src/layers/linetype-load.test.ts).
    ("third-party/ezdxf/examples_dxf/colors.dxf", "linetype"),
    # The bundled templates as they are, and a new drawing made from each, drawn in, its title
    # block filled in and saved (M5-10, packages/testkit/src/templates/templates.test.ts).
    ("assets/templates/triya-iso.dxf", "template"),
    ("assets/templates/triya-iso.dxf", "new"),
    ("assets/templates/triya-ansi.dxf", "template"),
    ("assets/templates/triya-ansi.dxf", "new"),
    # The drawings "Open with no template - Imperial / Metric" opens, and a new drawing made from
    # each, drawn in and saved (M5-10 part 2, same test file).
    ("assets/templates/no-template-imperial.dxf", "template"),
    ("assets/templates/no-template-imperial.dxf", "new"),
    ("assets/templates/no-template-metric.dxf", "template"),
    ("assets/templates/no-template-metric.dxf", "new"),
)
# corpus.json tags the files acad-ts cannot read "unreadable" (M2-49); the corpus suites skip
# exactly those (readableFiles in packages/testkit/src/corpus/manifest.ts), so there is no save.
UNREADABLE_TAG = "unreadable"
DANGLING_OWNER = "DEAD0"
# The canary's broken copy, written into the saves directory (never audited ahead, see main).
CANARY = "canary-dangling-owner.dxf"
# ezdxf.audit.AuditError.INVALID_OWNER_HANDLE
INVALID_OWNER_HANDLE = 202


@dataclass(frozen=True)
class Finding:
    stage: str  # "load", "recover" or "audit"
    code: int  # ezdxf AuditError code; -1 when the file does not load at all
    message: str


def audit_file(path: Path) -> list[Finding]:
    """Every problem ezdxf reports while recovering and auditing ``path``."""
    import ezdxf  # imported here so the pure logic is testable without ezdxf
    from ezdxf import recover

    findings: list[Finding] = []
    try:
        if path.read_bytes()[:18] == b"AutoCAD Binary DXF":
            # recover reads ASCII only; Triya's saves are ASCII, some corpus sources are binary.
            doc = ezdxf.readfile(str(path))
        else:
            doc, recovered = recover.readfile(str(path))
            findings += [Finding("recover", int(e.code), e.message) for e in recovered.errors]
            findings += [Finding("recover", int(e.code), e.message) for e in recovered.fixes]
    except Exception as err:  # noqa: BLE001 - any load failure is a finding
        return [Finding("load", -1, f"{type(err).__name__}: {err}")]
    audited = doc.audit()
    findings += [Finding("audit", int(e.code), e.message) for e in audited.errors]
    findings += [Finding("audit", int(e.code), e.message) for e in audited.fixes]
    return findings


def audit_all(paths: list[Path], audit=audit_file, workers: int | None = None) -> dict[Path, list[Finding]]:
    """``audit`` of every path, keyed by the resolved path, on one process per CPU (DEC-075).

    Each file is audited on its own, so the findings are the same as one at a time; only the
    wall-clock time of the gate (about 2,000 saves) shrinks. ``audit`` must be picklable.
    """
    unique = sorted({p.resolve() for p in paths})
    if not unique:
        return {}
    with ProcessPoolExecutor(max_workers=workers or os.cpu_count() or 1) as pool:
        return dict(zip(unique, pool.map(audit, unique, chunksize=8)))


def cached(results: dict[Path, list[Finding]], audit=audit_file):
    """``audit`` answered from ``results`` (by resolved path), auditing anything else directly."""

    def lookup(path: Path) -> list[Finding]:
        found = results.get(path.resolve())
        return list(found) if found is not None else audit(path)

    return lookup


def save_name(corpus_path: str, kind: str) -> str:
    """Mirror of ``auditSaveName`` in packages/testkit/src/dxf-audit/saves.ts."""
    return f"{corpus_path.replace('/', '__')}.{kind}.dxf"


def readable_files(manifest: dict) -> list[dict]:
    return [
        f for f in manifest["files"] if UNREADABLE_TAG not in f.get("tags", [])
    ]


# ezdxf's audit treats a DICTIONARY owned by a DICTIONARY that has no key for it as orphaned
# (ObjectsSection reorg, remove_orphaned_dictionaries) and silently drops it, then reports each
# XRECORD in it as having an invalid owner. An extension dictionary attached to a DICTIONARY is
# exactly that, and it is valid: AutoCAD keeps ACAD_XREC_ROUNDTRIP data there in R14–R2004 files
# (sample_AC1014.dwg), and ezdxf reports the same on a file it wrote itself (test_audit.py).
XDICT_OWNER = re.compile(r"^Deleted XRECORD\(#([0-9A-F]+)\) entity with invalid owner handle #([0-9A-F]+)\.$")
XDICT_ON_DICTIONARY = (
    "ezdxf limitation: its audit drops an extension dictionary attached to a DICTIONARY, which "
    "the save holds as read; verified in the save"
)


def ezdxf_limitation(save: Path, finding: Finding, _docs: dict = {}) -> str | None:  # noqa: B006
    """Why ``finding`` is ezdxf's limitation rather than a fault of the save, or None.

    Checked in the save itself, loaded without audit: the XRECORD must be owned, as written, by a
    DICTIONARY that is the extension dictionary of the DICTIONARY that owns it.
    """
    match = XDICT_OWNER.match(finding.message)
    if finding.code != INVALID_OWNER_HANDLE or match is None:
        return None
    import ezdxf
    from ezdxf.entities import Dictionary

    if save not in _docs:
        _docs.clear()  # one save at a time
        _docs[save] = ezdxf.readfile(str(save))
    db = _docs[save].entitydb
    xrecord, xdict = db.get(match.group(1)), db.get(match.group(2))
    if xrecord is None or xdict is None or xrecord.dxf.get("owner") != xdict.dxf.handle:
        return None
    host = db.get(xdict.dxf.get("owner")) if isinstance(xdict, Dictionary) else None
    if (
        isinstance(host, Dictionary)
        and host.has_extension_dict
        and host.get_extension_dict().dictionary is xdict
    ):
        return XDICT_ON_DICTIONARY
    return None


# AutoCAD keeps a view's View Manager category in DXF 300 of this XRECORD in the VIEW's extension
# dictionary, "<None>" for none (M2-70; sample_AC1032_ascii.dxf's view_custom).
VIEW_INFO = "ADSK_XREC_VTRVIEWINFO"
NO_CATEGORY = "<None>"


def view_categories(save: Path) -> dict[str, str | None]:
    """Each VIEW's category in ``save`` as ezdxf reads it, None for none."""
    import ezdxf
    from ezdxf.entities import XRecord

    out: dict[str, str | None] = {}
    for view in ezdxf.readfile(str(save)).views:
        category = None
        if view.has_extension_dict:
            info = view.get_extension_dict().dictionary.get(VIEW_INFO)
            if isinstance(info, XRecord):
                category = next((t.value for t in info.tags if t.code == 300), None)
        out[view.dxf.name] = None if category in (None, "", NO_CATEGORY) else category
    return out


# What ezdxf must read back from a save, where its corpus suite wrote `<save>.<what>.json` beside it.
READ_BACK = {"categories": view_categories}


def read_back_failures(name: str, save: Path, read_back: dict) -> list[str]:
    """Where ezdxf reads ``save`` differently from what its corpus suite says it saved."""
    out: list[str] = []
    for what, read in read_back.items():
        expected_path = save.parent / f"{name}.{what}.json"
        if not expected_path.exists():
            continue
        expected = json.loads(expected_path.read_text())
        got = read(save)
        for key, want in expected.items():
            have = got.get(key, "missing")
            if have != want:
                shown = have if have == "missing" else repr(have)
                out.append(f"{name}: ezdxf reads {what} {key} as {shown}, the save meant {want!r}")
    return out


@dataclass
class Report:
    failures: list[str] = field(default_factory=list)
    allowed: list[str] = field(default_factory=list)
    checked: int = 0


def judge(
    files: list[dict],
    saves_dir: Path,
    corpus_dir: Path,
    exceptions: dict[str, list[dict]],
    audit=audit_file,
    limitation=ezdxf_limitation,
    read_back=READ_BACK,
    fixtures: tuple[tuple[str, str], ...] = (),
) -> Report:
    """Audit the saves of ``files`` and the ``fixtures`` saves; ``audit``, ``limitation`` and
    ``read_back`` are injectable for the tests."""
    report = Report()
    known = {f["path"] for f in files}
    for path in sorted(set(exceptions) - known):
        report.failures.append(f"{path}: exceptions.json lists a file the gate does not save")
    for f in files:
        path = f["path"]
        allowed = {int(e["code"]): e["reason"] for e in exceptions.get(path, [])}
        source_codes: set[int] | None = None
        if allowed:
            if f.get("format") == "dwg":
                report.failures.append(f"{path}: ezdxf cannot read a DWG source, so it has no exceptions")
                allowed = {}
            else:
                source_codes = {x.code for x in audit(corpus_dir / path)}
                for code in sorted(set(allowed) - source_codes):
                    report.failures.append(
                        f"{path}: exception {code} is stale, ezdxf no longer reports it on the source"
                    )
                    del allowed[code]
        seen: set[int] = set()
        for kind in KINDS:
            name = save_name(path, kind)
            save = saves_dir / name
            error = saves_dir / f"{name}.error.txt"
            if error.exists():
                report.failures.append(f"{name}: the save threw: {error.read_text().strip()}")
                continue
            if not save.exists():
                report.failures.append(f"{name}: missing (did the corpus suites run with TRIYA_DXF_AUDIT_DIR?)")
                continue
            report.checked += 1
            for x in audit(save):
                if x.code in allowed:
                    seen.add(x.code)
                    report.allowed.append(f"{name}: {x.stage} {x.code} {x.message} ({allowed[x.code]})")
                elif (why := limitation(save, x)) is not None:
                    report.allowed.append(f"{name}: {x.stage} {x.code} {x.message} ({why})")
                else:
                    report.failures.append(f"{name}: {x.stage} {x.code} {x.message}")
            report.failures.extend(read_back_failures(name, save, read_back))
        for code in sorted(set(allowed) - seen):
            report.failures.append(f"{path}: exception {code} is stale, no save reports it")
    for path, kind in fixtures:
        name = save_name(path, kind)
        save = saves_dir / name
        error = saves_dir / f"{name}.error.txt"
        if error.exists():
            report.failures.append(f"{name}: the save threw: {error.read_text().strip()}")
        elif not save.exists():
            report.failures.append(f"{name}: missing (did the testkit suites run with TRIYA_DXF_AUDIT_DIR?)")
        else:
            report.checked += 1
            report.failures.extend(f"{name}: {x.stage} {x.code} {x.message}" for x in audit(save))
    return report


def break_owner(text: str) -> str:
    """The save with its first LAYOUT's owner handle (330 outside a 102 group) left dangling."""
    lines = text.split("\n")
    in_layout = in_group = False
    for i in range(0, len(lines) - 1, 2):
        code, value = lines[i].strip(), lines[i + 1].strip()
        if code == "0":
            in_layout, in_group = value == "LAYOUT", False
        elif code == "102":
            in_group = value.startswith("{")
        elif code == "330" and in_layout and not in_group:
            lines[i + 1] = DANGLING_OWNER
            return "\n".join(lines)
    raise ValueError("no LAYOUT object with an owner handle")


def canary(saves_dir: Path, audit=audit_file) -> str | None:
    """A failure message unless a clean save with a dangling owner handle fails the audit."""
    clean = next((p for p in sorted(saves_dir.glob("*.unedited.dxf")) if not audit(p)), None)
    if clean is None:
        return "canary: no clean save to break"
    broken = saves_dir / CANARY
    text = clean.read_text(encoding="utf-8", errors="surrogateescape")
    broken.write_text(break_owner(text), encoding="utf-8", errors="surrogateescape")
    if not any(x.code == INVALID_OWNER_HANDLE for x in audit(broken)):
        return f"canary: {clean.name} with a dangling owner handle passed the audit"
    return None


def main(argv: list[str]) -> int:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("saves", type=Path)
    parser.add_argument("--corpus", type=Path, default=here.parent.parent / "corpus")
    parser.add_argument("--exceptions", type=Path, default=here / "exceptions.json")
    args = parser.parse_args(argv)

    manifest = json.loads((args.corpus / "corpus.json").read_text())
    exceptions = json.loads(args.exceptions.read_text())["files"]
    files = readable_files(manifest)

    # Every save, and every source an exception names, audited in parallel up front; the checks
    # below then read the findings in the same order as before.
    sources = [args.corpus / path for path in exceptions]
    saves = [p for p in sorted(args.saves.glob("*.dxf")) if p.name != CANARY]
    audit = cached(audit_all(saves + sources))
    broken = canary(args.saves, audit=audit)
    report = judge(files, args.saves, args.corpus, exceptions, audit=audit, fixtures=FIXTURE_SAVES)
    if broken:
        report.failures.insert(0, broken)
    for line in report.allowed:
        print(f"allowed  {line}")
    for line in report.failures:
        print(f"FAIL     {line}")
    print(
        f"dxf-audit: {report.checked} saves of {len(files)} corpus files and "
        f"{len(FIXTURE_SAVES)} fixture saves checked, "
        f"{len(report.failures)} failures, {len(report.allowed)} allowed findings, "
        f"canary {'passed the audit (bad)' if broken else 'caught'}"
    )
    return 1 if report.failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
