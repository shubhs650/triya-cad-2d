export class AcdsRecordColumn {
	dataType: number = 0;
	name: string = '';
	handle: number = 0;
	data: Uint8Array | null = null;

	toString(): string {
		return `${this.name} : ${this.dataType}`;
	}
}
