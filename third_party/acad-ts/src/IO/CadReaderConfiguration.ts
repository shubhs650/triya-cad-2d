export abstract class CadReaderConfiguration {
	ignoreProxyGraphics: boolean = true;
	failsafe: boolean = true;
	/** @deprecated Unknown entity payloads are not a substitute for typed entity support. */
	keepUnknownEntities: boolean = false;
	/** @deprecated Unknown object payloads are not written by the writers. */
	keepUnknownNonGraphicalObjects: boolean = false;
}
