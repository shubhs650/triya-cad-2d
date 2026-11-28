"""Unit tests for the ezdxf audit sweep (M10-02). Run: python3 -m unittest discover scripts/dxf-audit

They use a fake ``audit``, so they need no ezdxf.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import audit as gate
import sweep


def header(fingerprint: str | None) -> str:
    pairs = ["  0", "SECTION", "  2", "HEADER", "  9", "$ACADVER", "  1", "AC1032"]
    if fingerprint is not None:
        pairs += ["  9", "$FINGERPRINTGUID", "  2", fingerprint]
    pairs += ["  0", "ENDSEC", "  0", "EOF", ""]
    return "\n".join(pairs)


def fake_audit(results: dict[str, list[gate.Finding]]):
    def audit(path: Path) -> list[gate.Finding]:
        return results.get(path.name, [])

    return audit


def no_limitation(_save: Path, _finding: gate.Finding) -> str | None:
    return None


class SweepTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.saves = self.root / "sweep"
        self.corpus = self.root / "corpus"
        self.saves.mkdir()
        (self.corpus / "public").mkdir(parents=True)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def save(self, name: str, fingerprint: str | None, tests: list[str]) -> None:
        (self.saves / f"{name}.dxf").write_text(header(fingerprint))
        (self.saves / f"{name}.tests.txt").write_text("".join(f"{t}\n" for t in tests))

    def test_fingerprint_is_read_from_the_header(self) -> None:
        self.save("a", "{ABC}", [])
        self.assertEqual(sweep.fingerprint(self.saves / "a.dxf"), "{ABC}")
        self.save("b", None, [])
        self.assertIsNone(sweep.fingerprint(self.saves / "b.dxf"))
        (self.saves / "c.dxf").write_text(header("{CR}").replace("\n", "\r\n"))
        self.assertEqual(sweep.fingerprint(self.saves / "c.dxf"), "{CR}")

    def test_tests_are_read_from_beside_the_save(self) -> None:
        self.save("a", None, ["packages/x.test.ts\tx > one", "packages/y.test.ts\ty > two"])
        self.assertEqual(
            sweep.tests_of(self.saves / "a.dxf"),
            [("packages/x.test.ts", "x > one"), ("packages/y.test.ts", "y > two")],
        )

    def test_a_finding_the_source_has_is_allowed_by_its_fingerprint(self) -> None:
        (self.corpus / "public/src.dxf").write_text(header("{SRC}"))
        exceptions = {"public/src.dxf": [{"code": 205, "reason": "bad lineweight in the source"}]}
        allowed = sweep.source_exceptions(self.corpus, exceptions)
        self.assertEqual(allowed, {"{SRC}": {205: ("public/src.dxf", "bad lineweight in the source")}})

        self.save("same", "{SRC}", ["t.test.ts\tsame source"])
        self.save("other", "{OTHER}", ["t.test.ts\tother source"])
        finding = gate.Finding("audit", 205, "Invalid lineweight")
        result = sweep.sweep(
            sorted(self.saves.glob("*.dxf")),
            allowed,
            audit=fake_audit({"same.dxf": [finding], "other.dxf": [finding]}),
            limitation=no_limitation,
        )
        verdicts = {r.save.name: r.verdict for r in result.findings}
        self.assertEqual(verdicts, {"same.dxf": "source", "other.dxf": "new"})
        self.assertEqual(result.checked, 2)
        self.assertEqual(len(result.new()), 1)

    def test_an_ezdxf_limitation_is_allowed_with_its_reason(self) -> None:
        self.save("a", None, ["t.test.ts\ta"])
        finding = gate.Finding("audit", 202, "Deleted XRECORD(#1) entity with invalid owner handle #2.")
        result = sweep.sweep(
            [self.saves / "a.dxf"],
            {},
            audit=fake_audit({"a.dxf": [finding]}),
            limitation=lambda _s, _f: "ezdxf limitation",
        )
        self.assertEqual([(r.verdict, r.why) for r in result.findings], [("ezdxf", "ezdxf limitation")])
        self.assertEqual(result.new(), [])

    def test_the_markdown_lists_new_findings_with_their_tests(self) -> None:
        self.save("a", None, ["packages/x.test.ts\tx > one", "packages/x.test.ts\tx > two"])
        self.save("b", None, ["packages/y.test.ts\ty > one"])
        finding = gate.Finding("audit", 103, "Missing BLOCK")
        result = sweep.sweep(
            sorted(self.saves.glob("*.dxf")),
            {},
            audit=fake_audit({"a.dxf": [finding]}),
            limitation=no_limitation,
        )
        text = sweep.markdown(result)
        self.assertIn("2 distinct saves from 3 saves in 2 test files", text)
        self.assertIn("1 new", text)
        self.assertIn("| audit 103 | Missing BLOCK | 1 | packages/x.test.ts: x > one; x > two |", text)
        self.assertIn("| packages/x.test.ts | 2 | 1 | 1 |", text)
        self.assertIn("| packages/y.test.ts | 1 | 1 | 0 |", text)

    def test_a_clean_sweep_says_so(self) -> None:
        self.save("a", None, ["packages/x.test.ts\tx"])
        result = sweep.sweep(
            [self.saves / "a.dxf"], {}, audit=fake_audit({}), limitation=no_limitation
        )
        self.assertIn("No save has a finding of its own.", sweep.markdown(result))


if __name__ == "__main__":
    unittest.main()
