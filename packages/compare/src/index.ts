// @triya/compare: Drawing diff (M8-05, FR-Z3).
// Runs in Node and in a Web Worker: no DOM or browser globals (enforced by tsconfig `lib` and ESLint).
export {
  compareDrawings,
  type CompareChange,
  type CompareItem,
  type ComparePair,
  type CompareResult,
  type CompareSettings,
  type CompareStatus,
} from './compare';
export { PROPERTY_KEYS, type PropertyKey } from './same';
