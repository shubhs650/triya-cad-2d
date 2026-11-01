export class CadWriterConfiguration {
	closeStream: boolean = true;
	resetDxfClasses: boolean = false;
	updateDimensionsInBlocks: boolean = false;
	updateDimensionsInModel: boolean = false;
	writeXData: boolean = true;
	/** Write the R2013+ DXF ACDSDATA section. Inline SAT and DWG output are unchanged. */
	writeACISData: boolean = true;
	writeXRecords: boolean = true;
	writeShapes: boolean = true;
	writeDynamicBlockData: boolean = false;
}
