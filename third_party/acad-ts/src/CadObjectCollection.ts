import { CadObject } from './CadObject.js';
import { CollectionChangedEventArgs } from './CollectionChangedEventArgs.js';

export class CadObjectCollection<T extends CadObject> implements Iterable<T> {
	public onAdd: ((sender: unknown, args: CollectionChangedEventArgs) => void) | null = null;
	public onRemove: ((sender: unknown, args: CollectionChangedEventArgs) => void) | null = null;

	public readonly owner: CadObject;

	public get count(): number { return this._entries.size; }

	protected readonly _entries: Set<T> = new Set<T>();

	constructor(owner: CadObject) {
		this.owner = owner;
	}

	public getAt(index: number): T | undefined {
		let i = 0;
		for (const entry of this._entries) {
			if (i === index) return entry;
			i++;
		}
		return undefined;
	}

	public add(item: T): void {
		if (item == null) throw new Error("item is null");
		if (item.owner != null) throw new Error(`Item already has an owner`);
		if (this._entries.has(item)) throw new Error(`Item is already in the collection`);

		this._entries.add(item);
		item.owner = this.owner;

		this.onAdd?.(this, new CollectionChangedEventArgs(item));
	}

	public addRange(items: Iterable<T>): void {
		for (const item of items) {
			this.add(item);
		}
	}

	public clear(): void {
		const entries = [...this._entries];
		for (const entry of entries) {
			this.remove(entry);
		}
	}

	public remove(item: T): T | null {
		if (!this._entries.delete(item)) return null;
		item.owner = null;
		this.onRemove?.(this, new CollectionChangedEventArgs(item));
		return item;
	}

	public removeRange(items: Iterable<T>): void {
		for (const item of items) {
			this.remove(item);
		}
	}

	/**
	 * Moves `item` from this collection to `target`, another collection of the same document,
	 * as `item`'s new owner. Unlike `remove` and `add`, the item stays registered with its
	 * document: it keeps its handle, its reactors and its extension dictionary.
	 */
	public moveTo(item: T, target: CadObjectCollection<T>): void {
		if (!this._entries.has(item)) throw new Error(`Item is not in the collection`);
		if (target === this) throw new Error(`Item is already in the collection`);
		if (target.owner.document !== this.owner.document) throw new Error(`The collections belong to different documents`);
		this._entries.delete(item);
		target._entries.add(item);
		item.owner = target.owner;
	}

	/** Puts the entries in `order`, which must hold every entry of the collection once. */
	public reorder(order: readonly T[]): void {
		const next = new Set<T>(order);
		if (next.size !== order.length || next.size !== this._entries.size || order.some((item) => !this._entries.has(item))) {
			throw new Error(`The order must hold every entry of the collection once`);
		}
		this._entries.clear();
		for (const item of order) this._entries.add(item);
	}

	[Symbol.iterator](): Iterator<T> {
		return this._entries[Symbol.iterator]();
	}
}
