# Public fidelity corpus

Drawings and AutoCAD reference plots used by the round-trip and fidelity harnesses (see `docs/TESTING.md`).

Rules:
- Every file has an entry in `corpus.json` with source and license.
- Only redistributable files: self-authored (MIT), ezdxf test files (MIT), ACadSharp samples (MIT).
- Never commit a confidential or vendor drawing. Those belong in `corpus/private/` (gitignored).
- References are plotted from AutoCAD by the owner; threads do not fabricate references.
