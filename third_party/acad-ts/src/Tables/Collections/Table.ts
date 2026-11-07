import { CadObject } from '../../CadObject.js';
import { CadObjectReferenceHandler } from '../../CadObjectReferenceHandler.js';
import { CollectionChangedEventArgs } from '../../CollectionChangedEventArgs.js';
import { DxfFileToken } from '../../DxfFileToken.js';
import { DxfSubclassMarker } from '../../DxfSubclassMarker.js';
import { OnNameChangedArgs } from '../../OnNameChangedArgs.js';
import { TableEntry } from '../TableEntry.js';
import { ITable } from './ITable.js';

export abstract class Table<T extends TableEntry> extends CadObject implements ITable, Iterable<T> {
	public onAdd: ((sender: unknown, args: CollectionChangedEventArgs) => void) | null = null;
	public onRemove: ((sender: unknown, args: CollectionChangedEventArgs) => void) | null = null;

	public get count(): number {
		return this.entries.size;
	}

	public override get objectName(): string {
		return DxfFileToken.tableEntry;
	}

	public override get subclassMarker(): string {
		return DxfSubclassMarker.table;
	}

	protected abstract get defaultEntries(): string[];

	protected entries: Map<string, T> = new Map<string, T>();
	private readonly _referenceHandler = new CadObjectReferenceHandler<string, T>();

	protected constructor() {
		super();
	}

	public add(item: T): void {
		if (!item.name || !item.name.trim()) {
			if (item.keepsEmptyName) {
				// Kept under a key no name can have, so lookups by name never find it. A table control
				// can list an entry twice (DWG); a named one lands on the same key, so this one must too.
				if ([...this.entries.values()].includes(item)) return;
				this.addEntry(this.createName('\u0000nameless'), item);
				return;
			}
			item.name = this.createName('unnamed');
		}
		this.addEntry(item.name, item);
	}

	public addRange(items: Iterable<T>): void {
		for (const item of items) {
			this.add(item);
		}
	}

	public tryAdd(item: T): T {
		const existing = this.tryGetValue(item.name);
		if (existing !== undefined) {
			return existing;
		} else {
			this.add(item);
			return item;
		}
	}

	public contains(key: string): boolean {
		return this.entries.has(key.toUpperCase());
	}

	public createDefaultEntries(): void {
		for (const entry of this.defaultEntries) {
			if (this.contains(entry)) continue;
			// Table subclasses with concrete default entries override this hook.
		}
	}

	public [Symbol.iterator](): Iterator<T> {
		return this.entries.values()[Symbol.iterator]();
	}

	public getReferences(name: string): Iterable<CadObject> {
		return this._referenceHandler.getReferences(name.toUpperCase());
	}

	public remove(key: string): T | null {
		if (this.defaultEntries.some(d => d.toUpperCase() === key.toUpperCase())) {
			return null;
		}

		const upperKey = key.toUpperCase();
		const item = this.entries.get(upperKey);
		if (item) {
			this.entries.delete(upperKey);
			item.owner = null;
			this.onRemove?.(this, new CollectionChangedEventArgs(item));
			item.onNameChanged = null;
			this.assignToDefault(item.name);
			return item;
		}

		return null;
	}

	public tryGetValue(key: string): T | undefined {
		return this.entries.get(key.toUpperCase());
	}

	public removeReference(name: string | null | undefined, owner: CadObject): void {
		if (!name) return;
		this._referenceHandler.removeReference(name.toUpperCase(), owner);
	}

	public updateReference(owner: CadObject, entry: T, assignValue: (entry: T) => void): T {
		if (owner.document !== this.document) {
			throw new Error('The reference must belong to the same document as the table.');
		}
		const existing = this.tryAdd(entry);
		const key = existing.name.toUpperCase();
		this._referenceHandler.addReference(key, owner, assignValue);
		assignValue(existing);
		return existing;
	}

	protected addEntry(key: string, item: T): void {
		this.entries.set(key.toUpperCase(), item);
		item.owner = this;

		item.onNameChanged = (sender: unknown, e: OnNameChangedArgs) => {
			this._onEntryNameChanged(sender, e);
		};

		this.onAdd?.(this, new CollectionChangedEventArgs(item));
	}

	protected addHandlePrefix(item: T): void {
		item.owner = this;
		item.onNameChanged = (sender: unknown, e: OnNameChangedArgs) => {
			this._onEntryNameChanged(sender, e);
		};

		this.onAdd?.(this, new CollectionChangedEventArgs(item));

		const key = `${item.handle}:${item.name}`;
		this.entries.set(key.toUpperCase(), item);
	}

	protected createName(prefix: string): string {
		let i = 0;
		while (this.entries.has(`${prefix}${i}`.toUpperCase())) {
			i++;
		}
		return `${prefix}${i}`;
	}

	/**
	 * Swaps the names of two entries: each keeps its place in the table, and the references to it
	 * follow it to its new name. Unlike a rename, a default entry may take part (the current
	 * layout's block, BlockRecordsTable.setPaperSpace).
	 */
	protected swapEntryNames(a: T, b: T): void {
		const aKey = a.name.toUpperCase();
		const bKey = b.name.toUpperCase();
		if (a === b || this.entries.get(aKey) !== a || this.entries.get(bKey) !== b) {
			throw new Error('Both entries must be in the table under their own names.');
		}
		const kept = [...this.entries].map(([k, v]): [string, T] => (v === a ? [bKey, a] : v === b ? [aKey, b] : [k, v]));
		this.entries.clear();
		for (const [k, v] of kept) this.entries.set(k, v);
		const handlers = [a.onNameChanged, b.onNameChanged];
		a.onNameChanged = null;
		b.onNameChanged = null;
		const name = a.name;
		a.name = b.name;
		b.name = name;
		[a.onNameChanged, b.onNameChanged] = handlers;
		const swap = '\u0000swap';
		this._referenceHandler.changeKey(aKey, swap);
		this._referenceHandler.changeKey(bKey, aKey);
		this._referenceHandler.changeKey(swap, bKey);
	}

	private _onEntryNameChanged(sender: unknown, e: OnNameChangedArgs): void {
		if (this.defaultEntries.some(d => d.toUpperCase() === e.oldName.toUpperCase())) {
			throw new Error(`The name ${e.oldName} belongs to a default entry.`);
		}

		// A nameless entry is kept under a key of its own (keepsEmptyName).
		const oldKey = e.oldName
			? e.oldName.toUpperCase()
			: [...this.entries].find(([, v]) => v === sender)?.[0];
		const entry = oldKey === undefined ? undefined : this.entries.get(oldKey);
		if (entry && oldKey !== undefined) {
			// Re-keyed in place: the table is written in entry order.
			const kept = [...this.entries].map(([k, v]): [string, T] => (k === oldKey ? [e.newName.toUpperCase(), entry] : [k, v]));
			this.entries.clear();
			for (const [k, v] of kept) this.entries.set(k, v);
		}
		this._referenceHandler.changeKey(e.oldName.toUpperCase(), e.newName.toUpperCase());
	}

	public getDefaultEntry(): T | null {
		if (this.defaultEntries.length === 0) return null;
		return this.tryGetValue(this.defaultEntries[0]) ?? null;
	}

	private assignToDefault(name: string): void {
		this._referenceHandler.assignAndRemove(name.toUpperCase(), this.getDefaultEntry() as T);
	}

	public get(name: string): T {
		const entry = this.entries.get(name.toUpperCase());
		if (entry === undefined) {
			throw new Error(`Entry '${name}' not found in table.`);
		}
		return entry;
	}
}
