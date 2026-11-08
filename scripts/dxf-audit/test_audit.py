"""Unit tests for the DXF validity gate's rules (M1-105). Run: python3 -m unittest discover scripts/dxf-audit

They use a fake ``audit`` so they need no ezdxf, except the last, which runs ezdxf on a broken save
when it is installed (CI installs it before running these).
"""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import audit as gate

DXF = "public/a.dxf"
DWG = "public/b.dwg"
FILES = [{"path": DXF, "format": "dxf-ascii"}, {"path": DWG, "format": "dwg"}]

# A minimal AC1032-shaped DXF: a LAYOUT whose owner sits after a reactor group.
LAYOUT_DXF = "\n".join(
    [
        "  0", "SECTION", "  2", "OBJECTS",
        "  0", "DICTIONARY", "  5", "C", "330", "0",
        "  0", "LAYOUT", "  5", "1E", "102", "{ACAD_REACTORS", "330", "1A", "102", "}",
        "330", "1A", "100", "AcDbPlotSettings",
        "  0", "ENDSEC", "  0", "EOF", "",
    ]
)


def fake_audit(results: dict[str, list[gate.Finding]]):
    def audit(path: Path) -> list[gate.Finding]:
        return results.get(path.name, [])

    return audit


class JudgeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.saves = Path(self.tmp.name)
        for f in FILES:
            for kind in gate.KINDS:
                (self.saves / gate.save_name(f["path"], kind)).write_text("")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_judge(self, results, exceptions=None) -> gate.Report:
        return gate.judge(FILES, self.saves, Path("/corpus"), exceptions or {}, fake_audit(results))

    def test_clean_saves_pass(self) -> None:
        report = self.run_judge({})
        self.assertEqual(report.failures, [])
        self.assertEqual(report.checked, 4)

    def test_any_recover_or_audit_finding_fails(self) -> None:
        name = gate.save_name(DXF, "edited")
        report = self.run_judge({name: [gate.Finding("audit", 202, "Deleted FIELD")]})
        self.assertEqual(report.failures, [f"{name}: audit 202 Deleted FIELD"])

    def test_a_missing_or_failed_save_fails(self) -> None:
        (self.saves / gate.save_name(DWG, "edited")).unlink()
        failed = gate.save_name(DXF, "unedited")
        (self.saves / failed).unlink()
        (self.saves / f"{failed}.error.txt").write_text("Error: boom\n")
        report = self.run_judge({})
        self.assertEqual(len(report.failures), 2)
        self.assertIn("the save threw: Error: boom", report.failures[0])
        self.assertIn("missing", report.failures[1])

    def test_an_exception_allows_what_the_source_also_reports(self) -> None:
        save = gate.save_name(DXF, "unedited")
        results = {
            "a.dxf": [gate.Finding("recover", 205, "Fixed invalid lineweight")],
            save: [gate.Finding("recover", 205, "Fixed invalid lineweight")],
        }
        exceptions = {DXF: [{"code": 205, "reason": "the source has lineweight 7"}]}
        report = self.run_judge(results, exceptions)
        self.assertEqual(report.failures, [])
        self.assertEqual(len(report.allowed), 1)

    def test_an_exception_the_source_does_not_report_is_stale(self) -> None:
        save = gate.save_name(DXF, "unedited")
        results = {save: [gate.Finding("recover", 205, "Fixed invalid lineweight")]}
        exceptions = {DXF: [{"code": 205, "reason": "listed without the source reporting it"}]}
        report = self.run_judge(results, exceptions)
        self.assertIn(f"{DXF}: exception 205 is stale, ezdxf no longer reports it on the source", report.failures)
        self.assertIn(f"{save}: recover 205 Fixed invalid lineweight", report.failures)

    def test_an_exception_no_save_needs_is_stale(self) -> None:
        results = {"a.dxf": [gate.Finding("recover", 205, "Fixed invalid lineweight")]}
        exceptions = {DXF: [{"code": 205, "reason": "the source has lineweight 7"}]}
        report = self.run_judge(results, exceptions)
        self.assertEqual(report.failures, [f"{DXF}: exception 205 is stale, no save reports it"])

    def test_dwg_sources_and_unknown_files_take_no_exceptions(self) -> None:
        exceptions = {DWG: [{"code": 12, "reason": "x"}], "public/gone.dxf": [{"code": 1, "reason": "x"}]}
        report = self.run_judge({}, exceptions)
        self.assertEqual(len(report.failures), 2)

    def test_unreadable_corpus_files_are_not_expected(self) -> None:
        manifest = {"files": [{"path": DXF}, {"path": DWG, "knownIssues": ["acad-ts read error: x"]}]}
        self.assertEqual([f["path"] for f in gate.readable_files(manifest)], [DXF])


class CanaryTest(unittest.TestCase):
    def test_break_owner_dangles_the_layout_owner_not_its_reactor(self) -> None:
        broken = gate.break_owner(LAYOUT_DXF).split("\n")
        self.assertEqual(broken.count(gate.DANGLING_OWNER), 1)
        self.assertEqual(broken[broken.index(gate.DANGLING_OWNER) - 1], "330")
        self.assertIn("{ACAD_REACTORS", broken[broken.index(gate.DANGLING_OWNER) - 6])

    def test_the_gate_fails_when_a_broken_save_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            saves = Path(tmp)
            (saves / gate.save_name(DXF, "unedited")).write_text(LAYOUT_DXF)
            self.assertIsNotNone(gate.canary(saves, fake_audit({})))
            caught = fake_audit({"canary-dangling-owner.dxf": [gate.Finding("audit", 202, "owner")]})
            self.assertIsNone(gate.canary(saves, caught))

    @unittest.skipUnless(importlib.util.find_spec("ezdxf"), "ezdxf not installed")
    def test_ezdxf_reports_a_dangling_owner_in_a_real_save(self) -> None:
        import ezdxf

        with tempfile.TemporaryDirectory() as tmp:
            saves = Path(tmp)
            doc = ezdxf.new("R2018")
            doc.modelspace().add_line((0, 0), (1, 1))
            doc.saveas(saves / gate.save_name(DXF, "unedited"))
            self.assertIsNone(gate.canary(saves))


if __name__ == "__main__":
    unittest.main()
