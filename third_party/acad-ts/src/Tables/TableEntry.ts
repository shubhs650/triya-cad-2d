import { CadObject } from '../CadObject.js';
import { INamedCadObject } from '../INamedCadObject.js';
import { DxfSubclassMarker } from '../DxfSubclassMarker.js';
import { StandardFlags } from './StandardFlags.js';
import { OnNameChangedArgs } from '../OnNameChangedArgs.js';
import { ACadVersion } from '../ACadVersion.js';
import { CadFileFormat } from '../IO/CadFileFormat.js';
import { INamedCadObjectExtensions } from '../Extensions/INamedCadObjectExtensions.js';

export abstract class TableEntry extends CadObject implements INamedCadObject {
	public onNameChanged: ((sender: unknown, args: OnNameChangedArgs) => void) | null = null;

	public flags: StandardFlags = StandardFlags.None;

	public get name(): string {
		return this._name;
	}
	public set name(value: string) {
		if (!value || !value.trim()) {
			throw new Error(`Table entry [${this.constructor.name}] must have a name`);
		}
		if (this.onNameChanged) {
			this.onNameChanged(this, new OnNameChangedArgs(this._name, value));
		}
		this._name = value;
	}

	public override get subclassMarker(): string {
		return DxfSubclassMarker.tableRecord;
	}

	protected _name: string = '';

	public constructor(name?: string) {
		super();
		if (name !== undefined) {
			if (!name) {
				throw new Error(`${this.constructor.name} must have a name.`);
			}
			this.name = name;
		}
	}

	public override clone(): CadObject {
		const clone = super.clone() as TableEntry;
		clone.onNameChanged = null;
		return clone;
	}

	/** True for an entry AutoCAD stores with an empty name (a shape file's text style). */
	public get keepsEmptyName(): boolean {
		return false;
	}

	/** True for a record an xref brought in (DXF 70 bit 16), which AutoCAD names `xref|symbol`. */
	public get isXrefDependent(): boolean {
		return (this.flags & StandardFlags.XrefDependent) !== 0;
	}

	public override validate(format: CadFileFormat, version: ACadVersion): string[] {
		const errors = super.validate(format, version);
		if (this.name === '' && this.keepsEmptyName) return errors;
		if (format === CadFileFormat.DXF && !this._isValidDxfName(version)) {
			errors.push(`${this.constructor.name}: name is invalid for a DXF file.`);
		}
		return errors;
	}

	// The `|` between an xref-dependent record's xref and symbol names is allowed; each part
	// must be a valid name on its own (AutoCAD help, "About Xref-Dependent Named Objects").
	private _isValidDxfName(version: ACadVersion): boolean {
		if (!this.isXrefDependent) return INamedCadObjectExtensions.isValidDxfName(this, version);
		const parts = this.name.split('|');
		return parts.every((part) => part !== '')
			&& INamedCadObjectExtensions.isValidDxfName({ onNameChanged: null, name: parts.join('_') }, version);
	}

	public override toString(): string {
		return `${this.objectName}:${this.name}`;
	}
}

export { StandardFlags } from './StandardFlags.js';
