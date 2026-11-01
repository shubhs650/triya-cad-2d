import { ACadVersion } from '../../../ACadVersion.js';
import { DwgPreview } from '../../../DwgPreview.js';
import { DwgSectionIO } from '../DwgSectionIO.js';
import { DwgSectionDefinition } from '../FileHeaders/DwgSectionDefinition.js';
import { IDwgStreamReader } from './IDwgStreamReader.js';

export class DwgPreviewReader extends DwgSectionIO {
	override get sectionName(): string { return DwgSectionDefinition.preview; }

	constructor(version: ACadVersion, private readonly _reader: IDwgStreamReader, private readonly _previewAddress: number) {
		super(version);
	}

	read(): DwgPreview {
		this.checkSentinel(this._reader, DwgSectionDefinition.startSentinels.get(this.sectionName)!);
		this._reader.readRawLong();
		const count = this._reader.readRawChar() & 0xFF;
		const entries: { code: number; size: number }[] = [];
		for (let i = 0; i < count; i++) {
			const code = this._reader.readRawChar() & 0xFF;
			this._reader.readRawLong();
			entries.push({ code, size: this._reader.readRawLong() });
		}

		let header: Uint8Array = new Uint8Array(0);
		let body: Uint8Array = new Uint8Array(0);
		let code = DwgPreview.PreviewType.Unknown;
		for (const entry of entries) {
			if (entry.size < 0 || entry.size > this._reader.stream.length - this._reader.position) {
				throw new Error('Invalid DWG preview data size');
			}
			const data = this._reader.readBytes(entry.size);
			if (entry.code === 1) header = data;
			else if (code === DwgPreview.PreviewType.Unknown) {
				code = entry.code as DwgPreview.PreviewType;
				body = data;
			}
		}
		this.checkSentinel(this._reader, DwgSectionDefinition.endSentinels.get(this.sectionName)!);
		return new DwgPreview(code, header, body);
	}
}
