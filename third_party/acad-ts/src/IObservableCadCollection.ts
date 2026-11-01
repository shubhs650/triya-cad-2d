import { CadObject } from './CadObject.js';
import { CollectionChangedEventArgs } from './CollectionChangedEventArgs.js';

export interface IObservableCadCollection<T extends CadObject> extends Iterable<T> {
	onAdd: ((sender: unknown, args: CollectionChangedEventArgs) => void) | null;
	onRemove: ((sender: unknown, args: CollectionChangedEventArgs) => void) | null;
}
