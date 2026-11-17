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

    def run_judge(
        self, results, exceptions=None, limitation=lambda _save, _x: None, read_back=None
    ) -> gate.Report:
        return gate.judge(
            FILES,
            self.saves,
            Path("/corpus"),
            exceptions or {},
            fake_audit(results),
            limitation,
            read_back or {},
        )

    def test_what_ezdxf_reads_back_must_be_what_the_suite_saved(self) -> None:
        # M2-70: the corpus suite writes <save>.categories.json beside its save.
        name = gate.save_name(DXF, "categories")
        (self.saves / f"{name}.categories.json").write_text('{"Front": "Elevations", "Top": null}')
        read = {"categories": lambda _save: {"Front": "Elevations", "Top": None, "Other": "x"}}
        self.assertEqual(self.run_judge({}, read_back=read).failures, [])
        wrong = {"categories": lambda _save: {"Front": "<None>"}}
        self.assertEqual(
            self.run_judge({}, read_back=wrong).failures,
            [
                f"{name}: ezdxf reads categories Front as '<None>', the save meant 'Elevations'",
                f"{name}: ezdxf reads categories Top as missing, the save meant None",
            ],
        )

    def test_clean_saves_pass(self) -> None:
        report = self.run_judge({})
        self.assertEqual(report.failures, [])
        # Two files, each saved unedited, that save saved again (M2-40), edited, after a markup
        # session (M2-08), after MLEADER (M2-09), by the app's Save after a session (M2-13),
        # after a paste from another drawing (M2-14), after the dimension commands (M2-11) and
        # after the Properties palette's General rows and Material (M2-35 part 6), with every
        # layout's view in its paper-space viewport (M2-47 part 1) and after the palette's hatch
        # gradient, origin and associative rows (M2-35 part 13), and with view categories set
        # (M2-70), after -TABLE with a nozzle schedule typed in (M4-05), and after the Table Style
        # dialog's styles with border linetypes and double lines (M4-16 part 8), and after -BLOCK
        # and -INSERT (M5-01 part 1).
        self.assertEqual(report.checked, 30)

    def test_fixture_saves_are_checked_with_no_exceptions(self) -> None:
        # M5-04 part 2: the xref bind saves, which are no corpus file's.
        fixtures = (("fixtures/x.dxf", "bind"), ("fixtures/x.dxf", "gone"))
        name = gate.save_name("fixtures/x.dxf", "bind")
        (self.saves / name).write_text("")
        report = gate.judge(
            FILES,
            self.saves,
            Path("/corpus"),
            {},
            fake_audit({name: [gate.Finding("audit", 202, "Deleted IMAGEDEF")]}),
            lambda _save, _x: None,
            {},
            fixtures,
        )
        self.assertEqual(report.checked, 31)
        self.assertEqual(
            report.failures,
            [
                f"{name}: audit 202 Deleted IMAGEDEF",
                f"{gate.save_name('fixtures/x.dxf', 'gone')}: missing (did the testkit suites run "
                "with TRIYA_DXF_AUDIT_DIR?)",
            ],
        )

    def test_any_recover_or_audit_finding_fails(self) -> None:
        name = gate.save_name(DXF, "edited")
        report = self.run_judge({name: [gate.Finding("audit", 202, "Deleted FIELD")]})
        self.assertEqual(report.failures, [f"{name}: audit 202 Deleted FIELD"])

    def test_a_verified_ezdxf_limitation_is_allowed(self) -> None:
        name = gate.save_name(DWG, "unedited")
        x = gate.Finding("recover", 202, "Deleted XRECORD(#11AF) entity with invalid owner handle #11AE.")
        report = self.run_judge({name: [x]}, limitation=lambda _save, _x: "ezdxf limitation")
        self.assertEqual(report.failures, [])
        self.assertEqual(len(report.allowed), 1)

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
        # M2-49: the unreadable tag decides, not known-issue wording ("a reader may repair it").
        manifest = {
            "files": [
                {"path": DXF, "tags": ["malformed"], "knownIssues": ["a reader may repair it"]},
                {"path": DWG, "tags": ["unreadable"], "knownIssues": ["acad-ts cannot read it: x"]},
            ]
        }
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


@unittest.skipUnless(importlib.util.find_spec("ezdxf"), "ezdxf not installed")
class EzdxfLimitationTest(unittest.TestCase):
    def save(self, tmp: str, dangle: bool) -> Path:
        import ezdxf

        doc = ezdxf.new("R2018")
        host = doc.rootdict.add_new_dict("TRIYA_TEST")
        xrecord = host.new_extension_dict().add_xrecord("ACAD_XREC_ROUNDTRIP")
        xrecord.reset([(1, "kept")])
        if dangle:
            xrecord.dxf.owner = "DEAD0"
        path = Path(tmp) / f"save-{dangle}.dxf"
        doc.saveas(path)
        return path

    def test_an_extension_dictionary_on_a_dictionary_is_ezdxfs_limitation(self) -> None:
        # ezdxf reports this on a file it wrote itself: the save is valid.
        with tempfile.TemporaryDirectory() as tmp:
            path = self.save(tmp, dangle=False)
            findings = gate.audit_file(path)
            self.assertEqual([x.code for x in findings], [gate.INVALID_OWNER_HANDLE])
            self.assertEqual(gate.ezdxf_limitation(path, findings[0]), gate.XDICT_ON_DICTIONARY)

    def test_a_really_dangling_xrecord_owner_is_not(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.save(tmp, dangle=True)
            findings = gate.audit_file(path)
            self.assertIn(gate.INVALID_OWNER_HANDLE, [x.code for x in findings])
            self.assertTrue(all(gate.ezdxf_limitation(path, x) is None for x in findings))


@unittest.skipUnless(importlib.util.find_spec("ezdxf"), "ezdxf not installed")
class ViewCategoriesTest(unittest.TestCase):
    def test_reads_a_views_category_from_its_xrecord(self) -> None:
        import ezdxf

        with tempfile.TemporaryDirectory() as tmp:
            doc = ezdxf.new("R2018")
            for name, category in (("Front", "Elevations"), ("Top", "<None>")):
                view = doc.views.new(name)
                info = view.new_extension_dict().add_xrecord(gate.VIEW_INFO)
                info.reset([(300, category), (302, "")])
            doc.views.new("Plain")
            path = Path(tmp) / "views.dxf"
            doc.saveas(path)
            self.assertEqual(
                gate.view_categories(path), {"Front": "Elevations", "Top": None, "Plain": None}
            )


if __name__ == "__main__":
    unittest.main()
