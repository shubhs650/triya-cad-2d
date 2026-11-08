# Public fidelity corpus

Drawings and AutoCAD reference plots used by the round-trip and fidelity harnesses (see `docs/TESTING.md`).

Rules:
- Every file has an entry in `corpus/corpus.json` with source and license. `pnpm corpus:validate` (also run by `pnpm test`) fails on an unlisted drawing, a hash mismatch, or a version/format that disagrees with the file's own header.
- Only redistributable files: self-authored (MIT), ezdxf test files (MIT), ACadSharp samples (MIT).
- Never commit a confidential or vendor drawing. Those belong in `corpus/private/` (gitignored).
- References are plotted from AutoCAD by the owner; threads do not fabricate references.
- Never commit `.shx`, `.pat`, `.lin`, `.ctb` or anything else copied from an Autodesk install.

## Layout

| Folder | What | License |
|---|---|---|
| `third-party/acadsharp/` | ACadSharp `samples/` at commit `25b5348`: the same sample drawing saved as DWG and ASCII/binary DXF for every version R12 (AC1009) to R2018 (AC1032), ten dynamic-block parameter drawings, geolocation, AEC objects, and the empty/base templates. | MIT, `LICENSES/ACadSharp-MIT.txt` |
| `third-party/ezdxf/examples_dxf/` | ezdxf `examples_dxf/` at commit `5265e6e`: text, MTEXT columns and inline codes, hatches, tables, dimensions in blocks, viewports, wipeouts, XCLIP, lineweights, colours. | MIT, `LICENSES/ezdxf-MIT.txt` |
| `third-party/ezdxf/integration_tests/` | A selection of ezdxf `integration_tests/data/`: binary DXF R12–R2000, small R13/R14 files, and intentionally malformed files (tagged `malformed`) for reader robustness. | MIT, `LICENSES/ezdxf-MIT.txt` |
| `self-authored/` | Thread-authored drawings (DEC-047), each written by a committed script under `scripts/corpus/` with the pinned ezdxf of `scripts/dxf-audit/requirements.txt`, byte-for-byte reproducible: `viewport-overrides.dxf` (M1-62; viewport layer overrides, viewports clipped by a polyline and a circle), `transparency.dxf` (M1-108; object transparency) and `traces.dxf` (M1-75; TRACE entities). | MIT, `../LICENSE` |
| `refs/` | AutoCAD reference PDFs/PNGs (owner-provided; empty until the self-authored set lands). | MIT |

Left out on purpose, because their provenance is not documented upstream: ezdxf's raster images (`images.dxf` and `viewports.dxf` therefore have missing image references, which is itself a useful case), vendor exports and customer drawings in ezdxf's integration data, and ACadSharp's `.shx`/`.pat` files.

The self-authored set listed in `docs/TESTING.md` §2.1 (vessel GA, nozzle orientation, bench files, …) and every AutoCAD reference plot are owner-provided; until they land, third-party files have `references: []` and the fidelity harness has nothing to compare them against.

## Commands

```
pnpm corpus:list        # table of every drawing with release, version, format, source, tags
pnpm corpus:validate    # schema, licenses, hashes, header versions, unlisted files
pnpm corpus:list --private / pnpm corpus:validate --private   # corpus/private/corpus.json, local only
```

To add a file: copy it under `public/`, add an entry to `corpus.json` (the `sha256` is `sha256sum <file>`), and run `pnpm corpus:validate`.
