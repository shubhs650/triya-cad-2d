export abstract class CadReaderConfiguration {
	ignoreProxyGraphics: boolean = true;
	failsafe: boolean = true;
	/**
	 * Keep entities the reader cannot map as `UnknownEntity` with their raw payload (DXF group
	 * codes, DWG object data), so that the writers can write them back unchanged.
	 */
	keepUnknownEntities: boolean = false;
	/** Same as `keepUnknownEntities`, for non-graphical objects (`UnknownNonGraphicalObject`). */
	keepUnknownNonGraphicalObjects: boolean = false;
	/**
	 * Keep the DXF group codes of objects the DXF writer cannot write from their fields
	 * (`MATERIAL`, `VISUALSTYLE`), so that a DXF save writes them back as read instead of dropping them.
	 */
	keepRawDxfPassthroughObjects: boolean = false;
	/**
	 * Read every object in a DWG object map, not only those a reference reaches, and keep the ones
	 * nothing reaches (an owner that is not in the file) raw in `CadDocument.unreachableObjects`,
	 * so that a save of the same version writes them back as read.
	 */
	keepUnreachableObjects: boolean = false;
}
