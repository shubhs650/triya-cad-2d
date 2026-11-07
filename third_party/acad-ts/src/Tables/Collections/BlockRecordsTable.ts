import { ObjectType } from '../../Types/ObjectType.js';
import { DxfFileToken } from '../../DxfFileToken.js';
import { BlockRecord } from '../BlockRecord.js';
import { Table } from './Table.js';

export class BlockRecordsTable extends Table<BlockRecord> {
	public override getDefaultEntry(): BlockRecord | null { return null; }
	public override get objectType(): ObjectType {
		return ObjectType.BLOCK_CONTROL_OBJ;
	}

	public override get objectName(): string {
		return DxfFileToken.tableBlockRecord;
	}

	protected override get defaultEntries(): string[] {
		return [BlockRecord.modelSpaceName, BlockRecord.paperSpaceName];
	}

	public constructor() {
		super();
	}

	public override createDefaultEntries(): void {
		if (!this.contains(BlockRecord.modelSpaceName)) {
			this.add(BlockRecord.modelSpace);
		}
		if (!this.contains(BlockRecord.paperSpaceName)) {
			this.add(BlockRecord.paperSpace);
		}
	}

	/**
	 * Makes `record` the current layout's block, as AutoCAD does when another layout is made
	 * current: `record` takes the name *Paper_Space and the block that had it takes `record`'s
	 * name. Both keep their handles, entities and layouts.
	 */
	public setPaperSpace(record: BlockRecord): void {
		const current = this.tryGetValue(BlockRecord.paperSpaceName);
		if (current === record) return;
		if (!current) {
			throw new Error(`The table has no ${BlockRecord.paperSpaceName} block.`);
		}
		if (!record.layout?.isPaperSpace) {
			throw new Error(`${record.name} is not a paper layout's block.`);
		}
		this.swapEntryNames(current, record);
	}

	public override add(item: BlockRecord): void {
		if (item.isAnonymous && this.contains(item.name)) {
			const existing = this.tryGetValue(item.name);
			if (existing && existing === item) {
				throw new Error(`The BlockRecord with name ${item.name} has already been added.`);
			}
			item.name = this.createName(BlockRecord.anonymousPrefix);
		}

		super.add(item);
	}
}
