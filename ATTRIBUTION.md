# Attribution and third-party licenses

Every runtime or asset dependency is listed here. Adding a dependency without a line here fails review (see `CLAUDE.md`). Allowed licenses: MIT, BSD, Apache-2.0, ISC, and LGPL only as a separately loaded module. GPL/AGPL are not allowed.

| Component | Use | License | Source |
|---|---|---|---|
| acad-ts | DWG/DXF read/write (vendored subtree with patches) | MIT | https://github.com/node-projects/acad-ts |
| ACadSharp | origin of acad-ts | MIT | https://github.com/DomCR/ACadSharp |
| ezdxf example and test drawings | public fidelity corpus (`corpus/public/third-party/ezdxf`, license text in `corpus/public/LICENSES`) | MIT | https://github.com/mozman/ezdxf |
| ACadSharp sample drawings | public fidelity corpus (`corpus/public/third-party/acadsharp`, license text in `corpus/public/LICENSES`) | MIT | https://github.com/DomCR/ACadSharp |
| PlaneGCS (FreeCAD) | 2D constraint solver, built to WASM as a separate module | LGPL-2.1+ | https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/Sketcher/App/planegcs |
| Hershey fonts | bundled stroke fonts (converted) | Public domain (Hershey/NIST terms) | https://www.ghostscript.com/doc/current/Fonts.htm#Hershey |
| LibreCAD .lff fonts | bundled stroke fonts (converted) | LGPL (font files; attribution) | https://github.com/LibreCAD/LibreCAD/tree/master/librecad/support/fonts |
| Microsoft Fluent UI System Icons | UI icons | MIT | https://github.com/microsoft/fluentui-system-icons |
| pdf.js | PDF underlay rendering | Apache-2.0 | https://github.com/mozilla/pdf.js |
| opentype.js | TTF parsing/shaping | MIT | https://github.com/opentypejs/opentype.js |
| React, Vite, Zustand, Radix, Comlink, flatbush, pixelmatch, Playwright, Vitest | app/tooling | MIT | npm |
| ESLint, @eslint/js, typescript-eslint, eslint-plugin-boundaries, globals, Prettier, Turborepo, Husky | dev tooling (lint, module boundaries, format, task runner, git hooks); not shipped | MIT | npm |
| eslint-import-resolver-typescript | dev tooling (resolves `@triya/*` for the boundary rule); not shipped | ISC | npm |
| yaml | dev tooling (parses workflows in `tests/ci`); not shipped | ISC | npm |
| TypeScript, Playwright (`@playwright/test`) | compiler; browser test runner; not shipped | Apache-2.0 | npm |
| minimatch 10 (transitive, via ESLint) | dev tooling only; not shipped | BlueOak-1.0.0 (permissive, OSI-approved) | npm |

Hatch patterns (`assets/patterns`), linetypes (`assets/linetypes`), plot-style tables (`assets/plotstyles`) and templates (`assets/templates`) are **re-authored** for this project from the published file-format descriptions and are MIT. No file copied from an Autodesk installation is included.
