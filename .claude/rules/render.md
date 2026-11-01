---
description: Rules for packages/render
globs: ["packages/render/**"]
---
- Canvas2D API calls live only here, behind the `Renderer` interface. Nothing outside this package may import Canvas2D types.
- Entities are tessellated into `RenderPrimitive`s once per `ChangeSet`, never per frame.
- Every frame is culled by the R-tree and subject to LOD rules in `ARCHITECTURE.md` §7.2.
- Changes that touch the frame loop, scene cache or culling must run `pnpm test:perf` and report T2/T3 numbers before→after in the PR.
- ACI 7 and ACI 0 follow the background-dependent rules; test both light and dark canvases.
