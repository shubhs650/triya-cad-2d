---
description: Rules for apps/web and packages/ui
globs: ["apps/web/**", "packages/ui/**"]
---
- React owns chrome only. The canvas is a leaf with a ref handed to `RendererHost`; no React state on the pan/zoom/draw path.
- The ribbon is data-driven from `ribbon.config.ts`; responsive behaviour is the layout algorithm in `UI_SPEC.md` §3, not ad-hoc CSS. Home Draw/Modify/Annotation items carry `protected: true` and must never overflow at 1366 px (T9 test).
- Dialogs mirror AutoCAD's structure and labels (`UI_SPEC.md` §7) and are fully keyboard-operable.
- Use Fluent UI System Icons; custom CAD glyphs follow the same grid and stroke weight.
- Respect `prefers-reduced-motion`; transitions ≤ 160 ms.
- No network calls at runtime except the service worker and the user-confirmed error report; the offline test enforces it.
- Every new dialog or palette ships with a Playwright smoke test.
