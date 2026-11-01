import { CadObject } from '../CadObject.js';
import type { CadDocument } from '../CadDocument.js';

export interface IExtendedDataHandleReference {
	value: number;
	resolveReference(document: CadDocument): CadObject;
}
