import { DxfCode } from '../DxfCode.js';
import { ExtendedDataRecordT } from './ExtendedDataRecordBase.js';
import { IExtendedDataHandleReference } from './IExtendedDataHandleReference.js';
import { CadObject } from '../CadObject.js';
import type { CadDocument } from '../CadDocument.js';

export abstract class ExtendedDataReference<T extends CadObject> extends ExtendedDataRecordT<number> implements IExtendedDataHandleReference {
	protected constructor(code: DxfCode, handle: number) {
		super(code, handle);
	}

	public resolveReference(document: CadDocument): T {
		return document.getCadObject(this.value) as T;
	}
}
