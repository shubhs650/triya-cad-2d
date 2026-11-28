"""ezdxf audit sweep (roadmap M10-02, DEC-047 item 7).

The gate (audit.py) audits the saves the corpus suites name (``writeAuditSave``). The sweep
audits every AC1032 DXF save the suites make through ``saveAc1032Dxf``: with
``TRIYA_DXF_SWEEP_DIR`` set, each is kept there once by its content's SHA-1, with
``<hash>.tests.txt`` naming the tests that made it (packages/testkit/src/dxf-audit/saves.ts).

Each save is loaded with ezdxf's ``recover`` and audited exactly as the gate does. A finding is
allowed when the save's source reports the same code itself (``exceptions.json``, matched by the
save's ``$FINGERPRINTGUID``, which a save keeps from its source) or when it is the ezdxf
limitation the gate verifies in the save; any other finding is new and fails the sweep.

Usage: python3 scripts/dxf-audit/sweep.py <sweep dir> [--corpus corpus] [--exceptions FILE]
                                         [--markdown FILE]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import audit as gate

# Findings are grouped by message with handles left out, so one fault met in many saves reads as one.
HANDLE = re.compile(r"#[0-9A-Fa-f]+")
# How many tests the markdown names for a group of findings.
TESTS_SHOWN = 4


def fingerprint(path: Path) -> str | None:
    """The DXF's ``$FINGERPRINTGUID`` (ASCII DXF), or None."""
    with path.open("r", encoding="utf-8", errors="surrogateescape") as f:
        lines = (line.strip() for line in f)
        for code in lines:
            value = next(lines, None)
            if value is None or (code == "0" and value == "ENDSEC"):
                return None
            if code == "9" and value == "$FINGERPRINTGUID":
                next(lines, None)  # group code 2
                return next(lines, None)
    return None


def tests_of(save: Path) -> list[tuple[str, str]]:
    """The tests that made ``save``, as (test file, test name)."""
    listed = save.with_suffix(".tests.txt")
    if not listed.exists():
        return []
    out: list[tuple[str, str]] = []
    for line in listed.read_text(encoding="utf-8").splitlines():
        file, _, name = line.partition("\t")
        out.append((file, name))
    return out


def source_exceptions(corpus_dir: Path, exceptions: dict[str, list[dict]]) -> dict[str, dict[int, tuple[str, str]]]:
    """exceptions.json by its sources' fingerprints: code -> (source, reason)."""
    out: dict[str, dict[int, tuple[str, str]]] = {}
    for path, entries in exceptions.items():
        source = corpus_dir / path
        if source.read_bytes()[:18] == b"AutoCAD Binary DXF":
            import ezdxf

            fp = ezdxf.readfile(str(source)).header.get("$FINGERPRINTGUID")
        else:
            fp = fingerprint(source)
        if fp is None:
            continue
        out.setdefault(fp, {}).update({int(e["code"]): (path, e["reason"]) for e in entries})
    return out


@dataclass(frozen=True)
class Verdict:
    save: Path
    finding: gate.Finding
    verdict: str  # "source", "ezdxf" or "new"
    why: str = ""


@dataclass
class Result:
    checked: int = 0
    tests: dict[Path, list[tuple[str, str]]] = field(default_factory=dict)
    findings: list[Verdict] = field(default_factory=list)

    def new(self) -> list[Verdict]:
        return [v for v in self.findings if v.verdict == "new"]


def sweep(
    saves: list[Path],
    allowed: dict[str, dict[int, tuple[str, str]]],
    audit=gate.audit_file,
    limitation=gate.ezdxf_limitation,
) -> Result:
    """Audit ``saves`` and judge each finding; ``audit`` and ``limitation`` are injectable."""
    result = Result()
    for save in saves:
        result.checked += 1
        result.tests[save] = tests_of(save)
        findings = audit(save)
        source = allowed.get(fingerprint(save) or "", {}) if findings else {}
        for x in findings:
            if x.code in source:
                path, reason = source[x.code]
                result.findings.append(Verdict(save, x, "source", f"{path}: {reason}"))
            elif (why := limitation(save, x)) is not None:
                result.findings.append(Verdict(save, x, "ezdxf", why))
            else:
                result.findings.append(Verdict(save, x, "new"))
    return result


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def _tests_cell(tests: list[tuple[str, str]]) -> str:
    by_file: dict[str, list[str]] = defaultdict(list)
    for file, name in tests:
        if name not in by_file[file]:
            by_file[file].append(name)
    parts = []
    shown = 0
    for file, names in by_file.items():
        if shown >= TESTS_SHOWN:
            break
        names = names[: TESTS_SHOWN - shown]
        shown += len(names)
        parts.append(f"{file}: {'; '.join(names)}")
    more = sum(len(n) for n in by_file.values()) - shown
    return _cell(", ".join(parts) + (f" and {more} more" if more > 0 else ""))


def markdown(result: Result) -> str:
    """The sweep's numbers and findings as Markdown, for docs/reports."""
    lines_made = sum(len(t) for t in result.tests.values())
    files = sorted({f for t in result.tests.values() for f, _ in t})
    verdicts = defaultdict(int)
    for v in result.findings:
        verdicts[v.verdict] += 1
    out = [
        f"{result.checked} distinct saves from {lines_made} saves in {len(files)} test files; "
        f"findings: {verdicts['new']} new, {verdicts['source']} the source's own (exceptions.json), "
        f"{verdicts['ezdxf']} ezdxf limitations.",
        "",
    ]
    new = result.new()
    if not new:
        out.append("No save has a finding of its own.")
    else:
        groups: dict[tuple[str, str], list[Verdict]] = defaultdict(list)
        for v in new:
            groups[(f"{v.finding.stage} {v.finding.code}", HANDLE.sub("#…", v.finding.message))].append(v)
        out += ["| Finding | Message | Saves | Tests |", "| --- | --- | ---: | --- |"]
        for (what, message), vs in sorted(groups.items(), key=lambda g: (-len(g[1]), g[0])):
            saves = sorted({v.save for v in vs})
            tests = [t for s in saves for t in result.tests.get(s, [])]
            out.append(f"| {what} | {_cell(message)} | {len(saves)} | {_tests_cell(tests)} |")
    out += ["", "| Test file | Saves | Distinct | With new findings |", "| --- | ---: | ---: | ---: |"]
    failing = {v.save for v in new}
    for file in files:
        made = [(s, t) for s, ts in result.tests.items() for t in ts if t[0] == file]
        distinct = {s for s, _ in made}
        out.append(f"| {file} | {len(made)} | {len(distinct)} | {len(distinct & failing)} |")
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("saves", type=Path)
    parser.add_argument("--corpus", type=Path, default=here.parent.parent / "corpus")
    parser.add_argument("--exceptions", type=Path, default=here / "exceptions.json")
    parser.add_argument("--markdown", type=Path)
    args = parser.parse_args(argv)

    allowed = source_exceptions(args.corpus, json.loads(args.exceptions.read_text())["files"])
    saves = sorted(args.saves.glob("*.dxf"))
    audit = gate.cached(gate.audit_all(saves))
    result = sweep(saves, allowed, audit=audit)
    for v in result.findings:
        label = "FAIL    " if v.verdict == "new" else "allowed "
        tests = "; ".join(f"{f} > {n}" for f, n in result.tests[v.save][:2])
        why = f" ({v.why})" if v.why else ""
        print(f"{label} {v.save.name}: {v.finding.stage} {v.finding.code} {v.finding.message}{why} [{tests}]")
    text = markdown(result)
    if args.markdown:
        args.markdown.write_text(text)
    print(f"dxf-sweep: {text.splitlines()[0]}")
    return 1 if result.new() else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
