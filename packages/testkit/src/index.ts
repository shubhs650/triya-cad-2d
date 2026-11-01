// @triya/testkit: Corpus loader, reference-plot diff, round-trip diff, perf harness.
// Test-only package: runs in Node and may use Node APIs. Production packages must not import it.
export { sniffCadFile, type CadFormat, type SniffResult } from './corpus/sniff.ts';
export { ACAD_VERSIONS, isAcadVersion, releaseName, type AcadVersion } from './corpus/versions.ts';
export {
  ALLOWED_LICENSES,
  loadManifest,
  validateCorpus,
  validateManifestShape,
  type CorpusFile,
  type CorpusManifest,
  type CorpusReference,
  type CorpusSource,
} from './corpus/manifest.ts';
export { formatCorpusList } from './corpus/list.ts';
