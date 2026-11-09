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
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

KINDS = ("unedited", "edited", "markup", "mleader", "session")
# corpus.json marks files acad-ts cannot read with a known issue mentioning "read"; the corpus
# suites skip them (packages/testkit/src/export/export.corpus.test.ts), so there is no save.
UNREADABLE = re.compile("read", re.IGNORECASE)
DANGLING_OWNER = "DEAD0"
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


def save_name(corpus_path: str, kind: str) -> str:
    """Mirror of ``auditSaveName`` in packages/testkit/src/dxf-audit/saves.ts."""
    return f"{corpus_path.replace('/', '__')}.{kind}.dxf"


def readable_files(manifest: dict) -> list[dict]:
    return [
        f for f in manifest["files"] if not any(UNREADABLE.search(k) for k in f.get("knownIssues", []))
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
) -> Report:
    """Audit the saves of ``files``; ``audit`` and ``limitation`` are injectable for the tests."""
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
        for code in sorted(set(allowed) - seen):
            report.failures.append(f"{path}: exception {code} is stale, no save reports it")
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
    broken = saves_dir / "canary-dangling-owner.dxf"
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

    broken = canary(args.saves)
    report = judge(files, args.saves, args.corpus, exceptions)
    if broken:
        report.failures.insert(0, broken)
    for line in report.allowed:
        print(f"allowed  {line}")
    for line in report.failures:
        print(f"FAIL     {line}")
    print(
        f"dxf-audit: {report.checked} saves of {len(files)} corpus files checked, "
        f"{len(report.failures)} failures, {len(report.allowed)} allowed findings, "
        f"canary {'passed the audit (bad)' if broken else 'caught'}"
    )
    return 1 if report.failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
