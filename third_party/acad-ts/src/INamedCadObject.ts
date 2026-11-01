import { OnNameChangedArgs } from './OnNameChangedArgs.js';

export interface INamedCadObject {
	onNameChanged: ((sender: unknown, args: OnNameChangedArgs) => void) | null;
	name: string;
}
