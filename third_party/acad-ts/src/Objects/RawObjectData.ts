import type { ACadVersion } from '../ACadVersion.js';
import type { CadDocument } from '../CadDocument.js';
import type { CadObject } from '../CadObject.js';

/**
 * One DXF group code of an object the reader could not map, as read: strings are the raw
 * line (still `^J`-escaped), handles are numbers, binary chunks are bytes.
 */
export interface DxfRawCode {
	code: number;
	value: unknown;
}

/** The object record of an unknown object as stored in a DWG object section. */
export interface DwgRawObjectData {
	/** The file version: the bits are only valid in a file of the same version. */
	version: ACadVersion;
	/** Object type code as stored (a class number for custom objects). */
	typeCode: number;
	/** The handle encoded in the record. */
	handle: number;
	/** The record after its size (MS) and, for R2010+, handle-stream size (MC); without the CRC. */
	data: Uint8Array;
	/** R2010+: size of the handle stream in bits (the MC value). 0 for older versions. */
	handleStreamBits: number;
}

/**
 * What the readers keep of an object they cannot map, so that the writers can emit it unchanged
 * under its handle instead of dropping it.
 */
export interface IRawCadObject {
	/** DXF type name as read. Used when the drawing has no CLASSES entry for the type. */
	rawDxfName: string | null;
	/** DXF group codes after the type name (handle, groups, owner, body, xdata), in file order. */
	rawDxfCodes: DxfRawCode[] | null;
	/** The DWG object record, for a DWG writer of the same version. */
	rawDwgData: DwgRawObjectData | null;
	/** Objects this one owns that only its raw payload refers to, e.g. an XRECORD under an AEC object. */
	readonly rawOwnedObjects: CadObject[];
}

/** Attach `child` to the raw object `owner`, registering it in the owner's document if it has one. */
export function addRawOwnedObject(owner: IRawCadObject & CadObject, child: CadObject): void {
	if (owner.rawOwnedObjects.includes(child)) {
		return;
	}
	owner.rawOwnedObjects.push(child);
	child.owner ??= owner;
	if (owner.document != null && child.document == null) {
		owner.document.registerCollection(child);
	}
}

/** Called from the raw objects' `assignDocument`: their owned objects join the document with them. */
export function registerRawOwnedObjects(owner: IRawCadObject, doc: CadDocument): void {
	for (const child of owner.rawOwnedObjects) {
		if (child.document == null) {
			doc.registerCollection(child);
		}
	}
}
