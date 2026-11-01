import { CadObject } from '../../CadObject.js';
import { XRecord, XRecordEntry } from '../../Objects/XRecrod.js';
import { NotificationType } from '../NotificationEventHandler.js';
import { CadDocumentBuilder } from '../CadDocumentBuilder.js';
import { CadTemplate } from './CadTemplate.js';

export class CadXRecordTemplate extends CadTemplate<XRecord> {
	private readonly _entries: XRecordEntry[] = [];

	constructor(cadObject?: XRecord) {
		super(cadObject ?? new XRecord());
	}

	addHandleReference(code: number, handle: number): void {
		this._entries.push((this.cadObject as XRecord).createEntry(code, handle));
	}

	protected override _build(builder: CadDocumentBuilder): void {
		super._build(builder);

		for (const entry of this._entries) {
			const obj = builder.tryGetCadObject<CadObject>(entry.value as number);
			if (obj) {
				entry.value = obj;
			} else {
				builder.notify(`XRecord reference not found ${entry.code}|${entry.value}`, NotificationType.Warning);
			}
		}
	}
}
