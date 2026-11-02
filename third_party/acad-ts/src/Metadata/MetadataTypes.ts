export type MetadataValueKind = 'date' | 'timespan' | 'char' | 'handle';

export interface PropertyMetadata {
	propertyName: string;
	valueCodes: number[];
	referenceType: number;
	collectionCodes?: number[];
	valueKind?: MetadataValueKind;
}

export interface SystemVariableMetadata extends PropertyMetadata {
	name: string;
	isName: boolean;
}

export interface ClassMetadata {
	typeName: string;
	baseTypeName?: string;
	dxfName?: string;
	dxfSubClassName?: string;
	dxfSubClassIsEmpty?: boolean;
	properties: PropertyMetadata[];
	systemVariables: SystemVariableMetadata[];
}