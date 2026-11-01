import { CadObject } from './CadObject.js';
import { CollectionChangedEventArgs } from './CollectionChangedEventArgs.js';
import { Seqend } from './Entities/Seqend.js';

export interface ISeqendCollection extends Iterable<CadObject> {
	onSeqendAdded: ((sender: unknown, args: CollectionChangedEventArgs) => void) | null;
	onSeqendRemoved: ((sender: unknown, args: CollectionChangedEventArgs) => void) | null;
	readonly seqend: Seqend | null;
}
