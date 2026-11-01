import { BlockRecord } from './BlockRecord.js';
import { ObjectType } from '../Types/ObjectType.js';
import { TableEntry } from './TableEntry.js';

export class ViewportEntityHeader extends TableEntry {
	// Legacy VP_ENT_HDR records can be unnamed, unlike symbol table entries.
	public override get name(): string { return this._name; }
	public override set name(value: string) {
		if (value === '') this._name = value;
		else super.name = value;
	}

	blockRecord: BlockRecord | null = null;

	public override get objectType(): ObjectType {
		return ObjectType.VP_ENT_HDR;
	}
}
