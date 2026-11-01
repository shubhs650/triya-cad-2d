import { Entity } from './Entity.js';
import { DxfClass } from '../Classes/DxfClass.js';
import { DxfFileToken } from '../DxfFileToken.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { ObjectType } from '../Types/ObjectType.js';
import { ACadVersion } from '../ACadVersion.js';
import type { BoundingBox } from '../Math/BoundingBox.js';
import { DwgStreamReaderBase } from '../IO/DWG/DwgStreamReaders/DwgStreamReaderBase.js';
import '../IO/DWG/DwgStreamReaders/DwgStreamReaderFactory.js';
import { DwgStreamWriterBase } from '../IO/DWG/DwgStreamWriters/DwgStreamWriterBase.js';
import '../IO/DWG/DwgStreamWriters/DwgStreamWriterFactory.js';

export class ProxyEntity extends Entity {
	get classId(): number {
		return this.dxfClass?.classNumber ?? 0;
	}

	get drawingFormat(): number {
		return (this.version as number) | (this.maintenanceVersion << 16);
	}

	dxfClass: DxfClass | null = null;

	maintenanceVersion: number = 0;
	data: Uint8Array | null = null;
	binaryData: Uint8Array | null = null;
	stringData: Uint8Array | null = null;
	referencedObjectHandles: number[] = [];

	override get objectName(): string {
		return DxfFileToken.entityProxyEntity;
	}

	override get objectType(): ObjectType {
		return ObjectType.ACAD_PROXY_ENTITY;
	}

	originalDataFormatDxf: boolean = false;

	proxyClassId: number = 498;

	override get subclassMarker(): string {
		return DxfSubclassMarker.proxyEntity;
	}

	version: ACadVersion = ACadVersion.Unknown;

	getStringDataText(): string {
		if (this.stringData === null) return '';
		return DwgStreamReaderBase.getStreamHandler(this.version, this.stringData).readVariableText();
	}

	addStringDataText(text: string, encoding: string = 'utf-8'): void {
		const buffer = new Uint8Array(text.length * 4 + 16);
		const writer = DwgStreamWriterBase.getStreamWriter(this.version, buffer, encoding);
		writer.writeVariableText(text);
		const bytes = buffer.slice(0, Math.ceil(writer.positionInBits / 8));
		const combined = new Uint8Array((this.stringData?.length ?? 0) + bytes.length);
		if (this.stringData) combined.set(this.stringData);
		combined.set(bytes, this.stringData?.length ?? 0);
		this.stringData = combined;
	}

	override applyTransform(transform: unknown): void {
		// No-op
	}

	override getBoundingBox(): BoundingBox | null {
		return null;
	}
}
