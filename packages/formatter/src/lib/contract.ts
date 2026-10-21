export const FIELDS = {
	mode: 'mode',
	value: 'value',
	transform: 'transform',
	source: 'source',
	rules: 'rules',
	onEmpty: 'onEmpty',
	whenEmpty: 'whenEmpty',
	path: 'path',
	missingPath: 'missingPath',
} as const;

export type FormatterMode = 'value' | 'structured';
export type MissingPathBehavior = 'skip' | 'fail';
export type EmptyHandling = 'skip' | 'fail' | 'replace' | 'set-null';

export const VALUE_MODE_STRUCTURAL_KEYS: readonly string[] = [
	FIELDS.mode,
	FIELDS.value,
	FIELDS.transform,
	FIELDS.onEmpty,
	FIELDS.whenEmpty,
];

export const RULE_STRUCTURAL_KEYS: readonly string[] = [
	FIELDS.path,
	FIELDS.transform,
	FIELDS.missingPath,
	FIELDS.onEmpty,
	FIELDS.whenEmpty,
];

export interface FormatterRule {
	[FIELDS.path]?: unknown;
	[FIELDS.transform]?: unknown;
	[FIELDS.missingPath]?: unknown;
	[FIELDS.onEmpty]?: unknown;
	[FIELDS.whenEmpty]?: unknown;
	[key: string]: unknown;
}

export interface FormatterOptions {
	[FIELDS.mode]?: FormatterMode;
	[FIELDS.value]?: unknown;
	[FIELDS.transform]?: string;
	[FIELDS.source]?: unknown;
	[FIELDS.rules]?: unknown;
	[FIELDS.onEmpty]?: EmptyHandling;
	[FIELDS.whenEmpty]?: unknown;
	[key: string]: unknown;
}
