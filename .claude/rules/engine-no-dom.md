---
description: Rules for the headless packages
globs: ["packages/engine/**", "packages/text/**", "packages/hatch/**", "packages/dims/**", "packages/constraints/**", "packages/library/**", "packages/compare/**", "packages/pdf/**"]
---
- No `window`, `document`, `navigator`, `localStorage`, `fetch` to the network, or any DOM/browser API. These packages run in Node for tests. Use injected abstractions (`FontSource`, `Clock`, `Storage`) when a capability is needed.
- Geometry tolerance comes from the document's extents-derived epsilon, never a hard-coded constant.
- Every command is a generator on the `PromptBus`; it receives `PromptAnswer`s and emits a `ChangeSet`. It never touches the renderer or UI state directly.
- Encode AutoCAD behaviour in tests. When AutoCAD's documented behaviour is ambiguous, choose the common drafter expectation, cite the ambiguity in a comment, and mention it in the PR.
- Text widths are exact (opentype.js / stroke-font metrics), never estimated.
