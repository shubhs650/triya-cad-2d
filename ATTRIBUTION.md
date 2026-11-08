# Attribution and third-party licenses

Every runtime or asset dependency is listed here. Adding a dependency without a line here fails review (see `CLAUDE.md`). Allowed licenses: MIT, BSD, Apache-2.0, ISC, and LGPL only as a separately loaded module. GPL/AGPL are not allowed.

| Component | Use | License | Source |
|---|---|---|---|
| acad-ts | DWG/DXF read/write (vendored filtered snapshot of upstream `315f3d8` with patches, DEC-033; `third_party/acad-ts/LICENSE`) | MIT | https://github.com/node-projects/acad-ts |
| ACadSharp | origin of acad-ts | MIT | https://github.com/DomCR/ACadSharp |
| ezdxf example and test drawings | public fidelity corpus (`corpus/public/third-party/ezdxf`, license text in `corpus/public/LICENSES`) | MIT | https://github.com/mozman/ezdxf |
| ACadSharp sample drawings | public fidelity corpus (`corpus/public/third-party/acadsharp`, license text in `corpus/public/LICENSES`) | MIT | https://github.com/DomCR/ACadSharp |
| PlaneGCS (FreeCAD) | 2D constraint solver, built to WASM as a separate module | LGPL-2.1+ | https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/Sketcher/App/planegcs |
| Hershey fonts | bundled stroke fonts `assets/fonts/oet-*.json`, converted from the original occidental data in `assets/fonts/hershey/hershey.jhf` (M1-09, DEC-044). The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821. | Hershey font distribution terms: free for any use, with these acknowledgements, in any format except NTIS's (`assets/fonts/hershey/README.md`) | https://paulbourke.net/dataformats/hershey/ |
| Microsoft Fluent UI System Icons | UI icons | MIT | https://github.com/microsoft/fluentui-system-icons |
| pdf.js | PDF underlay rendering | Apache-2.0 | https://github.com/mozilla/pdf.js |
| opentype.js 2.0 | TrueType/OpenType parsing, glyph outlines and advance widths (`packages/text`, M1-10); no dependencies of its own | MIT | https://github.com/opentypejs/opentype.js |
| UTIF.js (`utif` 3.1.0) | TIFF decoding for raster images (`packages/render`, M1-19 part 2); its embedded JPEG decoder is Mozilla pdf.js code (Apache-2.0) | MIT | https://github.com/photopea/UTIF.js |
| fflate 0.8.2 | zlib inflate for Deflate TIFF strips, behind the `pako` stand-in `third_party/pako-inflate` (MIT, ours) that replaces pako, whose Zlib license is not on the allowed list (M1-19 part 2) | MIT | https://github.com/101arrowz/fflate |
| React, Vite, Zustand, Radix, flatbush, Playwright, Vitest | app/tooling | MIT | npm |
| pixelmatch 7 | golden-image pixel comparison in `@triya/testkit` (fidelity harness, M1-24); dev only, not shipped | ISC | https://github.com/mapbox/pixelmatch |
| pngjs 7 (and `@types/pngjs`, MIT) | PNG decode/encode for the golden-image comparison (`@triya/testkit`, M1-24); dev only, not shipped | MIT | https://github.com/pngjs/pngjs |
| React 19.2 and React DOM (`apps/web`, M1-22); `@vitejs/plugin-react` 5 and `@types/react`, `@types/react-dom` (build and types only, not shipped) | app shell UI | MIT | https://github.com/facebook/react, https://github.com/vitejs/vite-plugin-react |
| Comlink 4.4.2 | `@triya/io` worker RPC (M1-06) | Apache-2.0 | https://github.com/GoogleChromeLabs/comlink |
| ESLint, @eslint/js, typescript-eslint, eslint-plugin-boundaries, globals, Prettier, Turborepo, Husky | dev tooling (lint, module boundaries, format, task runner, git hooks); not shipped | MIT | npm |
| eslint-import-resolver-typescript | dev tooling (resolves `@triya/*` for the boundary rule); not shipped | ISC | npm |
| yaml | dev tooling (parses workflows in `tests/ci`); not shipped | ISC | npm |
| TypeScript, Playwright (`@playwright/test`) | compiler; browser test runner; not shipped | Apache-2.0 | npm |
| fast-check | property-based tests (dev only); not shipped | MIT | https://github.com/dubzzz/fast-check |
| @vitest/coverage-v8 (and its MIT/ISC dependencies: @vitest/istanbul-lib-*, ast-v8-to-istanbul, @bcoe/v8-coverage, magicast, semver) | coverage gates in `pnpm test` (dev only); not shipped | MIT | npm |
| ezdxf 1.4.5 (Python; with its dependencies numpy (BSD-3-Clause), fontTools (MIT), pyparsing (MIT) and typing_extensions (PSF-2.0, permissive, OSI-approved), pinned in `scripts/dxf-audit/requirements.txt`) | DXF validity gate in CI (M1-105, DEC-047 item 7): `recover` + `audit` of every Triya-saved corpus DXF; CI only, not shipped | MIT | https://github.com/mozman/ezdxf |
| minimatch 10 (transitive, via ESLint) | dev tooling only; not shipped | BlueOak-1.0.0 (permissive, OSI-approved) | npm |

Hatch patterns (`assets/patterns`), linetypes (`assets/linetypes`), plot-style tables (`assets/plotstyles`) and templates (`assets/templates`) are **re-authored** for this project from the published file-format descriptions and are MIT. No file copied from an Autodesk installation is included.
