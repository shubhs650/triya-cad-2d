# acad-ts — vendored copy and local patches

| | |
|---|---|
| Upstream | https://github.com/node-projects/acad-ts (MIT) |
| Pinned commit | `315f3d8db7c9c6f2d5f6755165ec1feef6d47c06` (2026, "Audit ACadSharp through 25b5348") |
| Upstream version | `@node-projects/acad-ts` 3.5.0 |
| ACadSharp parity | audited through DomCR/ACadSharp `25b534813c1e5beb19ce78dd8f671781fd4d052f` |
| Vendored paths | `src/`, `LICENSE`, `README.md`, `package.json`, `tsconfig.json` |
| Not vendored | `reference/` (Autodesk DXF reference PDF, ODA spec), `samples/` (`.shx`/`.shp`/`.pat` files and sample drawings), `tests/`, `docs/`, `tools/`, `.github/`, lockfile |
| Re-sync | `third_party/sync-acad-ts.sh <sha>` then update this table |

Upstream test suite at the pinned commit, run in the upstream checkout: 717 passed, 16 skipped (61 files). With all patches below applied: same.

## Rules

- This directory is a filtered snapshot, not a git subtree (DEC-033). Never hand-edit a file here without a patch in `third_party/acad-ts-patches/` that `sync-acad-ts.sh` re-applies.
- Each patch is minimal, has a unit test in `packages/io` that fails on the unpatched code, and carries the upstream PR text below.
- Line endings are kept exactly as upstream ships them (mixed CRLF/LF); `.gitattributes` marks this tree `-text` and formatters ignore it.

## Patches

### 0001 — `createExtendedDictionary()` calls `require` inside an ES module

- **File:** `third_party/acad-ts-patches/0001-esm-safe-create-extended-dictionary.patch`
- **Touches:** `src/CadObject.ts`, `src/Objects/CadDictionary.ts`
- **Symptom:** `CadObject.createExtendedDictionary()` throws `ReferenceError: require is not defined` in every ESM runtime (Node ESM, browsers, Web Workers). The package is `"type": "module"`, so `require` never exists. Any caller that adds an extension dictionary (including `Mesh` subdivision data) fails. Under Vitest a `require` shim exists and loads a second copy of the module, so the call "works" but returns a dictionary that fails `instanceof CadDictionary`; the test asserts `instanceof` to catch both failure modes.
- **Fix:** `CadDictionary.ts` registers a factory on `CadObject` when it is evaluated, the same pattern `DwgFileHeader.registerFactory` already uses to break an import cycle.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0001 createExtendedDictionary works under ESM".
- **Upstream status:** PR text drafted below, not yet submitted (threads have no write access to upstream; owner submits).

<details><summary>Upstream PR text</summary>

**Title:** Fix `createExtendedDictionary` throwing `require is not defined` under ESM

`CadObject.createExtendedDictionary()` lazily loads `CadDictionary` with `require('./Objects/CadDictionary')` to avoid the `CadObject` ⇄ `CadDictionary` import cycle. The package is published as `"type": "module"`, so `require` is undefined in Node ESM, browsers and workers, and the call always throws `ReferenceError: require is not defined`. Under Vitest a `require` shim loads a second copy of `CadDictionary`, so the call appears to work but returns an object that fails `instanceof CadDictionary`.

This change replaces the `require` with a constructor factory that `CadDictionary.ts` registers on `CadObject` at module evaluation, mirroring the existing `DwgFileHeader.registerFactory` pattern. No public API changes beyond the internal `CadObject.registerDictionaryFactory`. Repro:

```js
import { Line } from '@node-projects/acad-ts';
new Line().createExtendedDictionary(); // ReferenceError before, CadDictionary after
```

The full test suite passes unchanged (717 passed, 16 skipped).

</details>
