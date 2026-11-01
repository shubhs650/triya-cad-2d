import { CadObject } from '../CadObject.js';
import { OnNameChangedArgs } from '../OnNameChangedArgs.js';
import { ObjectType } from '../Types/ObjectType.js';

export abstract class NonGraphicalObject extends CadObject {
	onNameChanged: ((sender: unknown, args: OnNameChangedArgs) => void) | null = null;

	get name(): string { return this._name; }
	set name(value: string) {
		this.onNameChanged?.call(this, this, new OnNameChangedArgs(this._name, value));
		this._name = value;
	}

	override get objectType(): ObjectType {
		return ObjectType.UNLISTED;
	}

	private _name: string = '';

	constructor(name?: string) {
		super();
		if (name) {
			this.name = name;
		}
	}

	override clone(): CadObject {
		const clone = super.clone() as NonGraphicalObject;
		clone.onNameChanged = null;
		return clone;
	}

	override toString(): string {
		if (!this._name) {
			return `${this.objectName}:${this.handle}`;
		} else {
			return `${this.objectName}:${this._name}:${this.handle}`;
		}
	}
}
