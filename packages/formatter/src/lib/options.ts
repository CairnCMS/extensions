import { types } from 'node:util';
import { BOUNDS, type Bounds } from './bounds.js';
import { cloneSourceAccounted } from './clone.js';
import { FIELDS, type FormatterMode } from './contract.js';
import { FormatterError } from './errors.js';
import { manifestOptionKeys, TRANSFORM_MANIFEST, transportFieldName } from './transport.js';

interface FieldMapping {
	transformId: string;
	optionKey: string;
}

function buildReverseMap(): Map<string, FieldMapping> {
	const map = new Map<string, FieldMapping>();

	for (const entry of TRANSFORM_MANIFEST) {
		for (const optionKey of manifestOptionKeys(entry)) {
			const field = transportFieldName(entry.id, optionKey);

			if (map.has(field)) {
				throw new Error(`duplicate transport field name: ${field}`);
			}

			map.set(field, { transformId: entry.id, optionKey });
		}
	}

	return map;
}

const FIELD_TO_OPTION = buildReverseMap();

const VALUE_STRUCTURAL = [
	FIELDS.mode,
	FIELDS.value,
	FIELDS.transform,
	FIELDS.source,
	FIELDS.rules,
	FIELDS.onEmpty,
	FIELDS.whenEmpty,
];

const VALUE_STRUCTURAL_SET = new Set<string>(VALUE_STRUCTURAL);
const RULE_STRUCTURAL = [FIELDS.path, FIELDS.transform, FIELDS.missingPath, FIELDS.onEmpty, FIELDS.whenEmpty];

const MAX_KEY_LENGTH = Math.max(
	...[...FIELD_TO_OPTION.keys()].map((key) => key.length),
	...VALUE_STRUCTURAL.map((key) => key.length)
);

const MAX_TRANSFORM_ID_LENGTH = Math.max(...TRANSFORM_MANIFEST.map((entry) => entry.id.length));

export interface OptionGraphBudget {
	nodes: number;
	bytes: number;
}

export function newBudget(): OptionGraphBudget {
	return { nodes: 0, bytes: 0 };
}

export function requirePlainObject(container: unknown): object {
	if (container === null || typeof container !== 'object' || types.isProxy(container) || Array.isArray(container)) {
		throw new FormatterError('INVALID_OPTION', 'operation options must be a plain object');
	}

	const prototype = Object.getPrototypeOf(container);

	if (prototype !== Object.prototype && prototype !== null) {
		throw new FormatterError('INVALID_OPTION', 'operation options must be a plain object');
	}

	return container;
}

export function readMode(rawContainer: unknown): FormatterMode {
	const container = requirePlainObject(rawContainer);
	const descriptor = Object.getOwnPropertyDescriptor(container, FIELDS.mode);

	if (descriptor === undefined) return 'value';

	if (!('value' in descriptor) || !descriptor.enumerable) {
		throw new FormatterError('INVALID_OPTION', 'option "mode" must be an own enumerable value');
	}

	const mode = descriptor.value;

	if (mode === undefined || mode === null || mode === '') return 'value';

	if (mode !== 'value' && mode !== 'structured') {
		throw new FormatterError('INVALID_OPTION', 'option "mode" must be "value" or "structured"');
	}

	return mode;
}

interface ClassifiedContainer {
	structural: Record<string, unknown>;
	transformId: string;
	transformOptions: Record<string, unknown>;
}

function classifyContainer(
	rawContainer: unknown,
	structuralKeys: readonly string[],
	budget: OptionGraphBudget
): ClassifiedContainer {
	const container = requirePlainObject(rawContainer);
	const structuralSet = new Set<string>(structuralKeys);
	const maxKeys = FIELD_TO_OPTION.size + structuralSet.size;
	const keys = Reflect.ownKeys(container);

	if (keys.length > maxKeys) {
		throw new FormatterError('BOUND_EXCEEDED', 'the operation has too many option fields');
	}

	const structural: Record<string, unknown> = {};
	const candidates: Array<{ key: string; value: unknown }> = [];

	for (const key of keys) {
		if (typeof key !== 'string') {
			throw new FormatterError('INVALID_OPTION', 'operation options must not have symbol keys');
		}

		if (key.length > MAX_KEY_LENGTH) {
			throw new FormatterError('UNKNOWN_OPTION', 'an unknown option field was provided');
		}

		const descriptor = Object.getOwnPropertyDescriptor(container, key)!;

		if (!('value' in descriptor) || !descriptor.enumerable) {
			throw new FormatterError('INVALID_OPTION', 'operation options must be own enumerable data properties');
		}

		if (structuralSet.has(key)) {
			structural[key] = descriptor.value;
			continue;
		}

		candidates.push({ key, value: descriptor.value });
	}

	const transformId = structural[FIELDS.transform];

	if (typeof transformId !== 'string' || transformId.length === 0) {
		throw new FormatterError('INVALID_OPTION', 'a transform must be selected');
	}

	if (transformId.length > MAX_TRANSFORM_ID_LENGTH) {
		throw new FormatterError('UNKNOWN_TRANSFORM', 'the selected transform is unknown');
	}

	const collected: Record<string, unknown> = {};

	for (const { key, value } of candidates) {
		const mapping = FIELD_TO_OPTION.get(key);

		if (mapping === undefined) {
			throw new FormatterError('UNKNOWN_OPTION', 'an unknown option field was provided');
		}

		if (mapping.transformId !== transformId) continue;

		collected[mapping.optionKey] = value;
	}

	return { structural, transformId, transformOptions: boundOptionGraph(collected, budget) };
}

export interface ParsedValueOptions {
	transformId: string;
	value: unknown;
	onEmpty: unknown;
	whenEmpty: unknown;
	transformOptions: Record<string, unknown>;
}

export function parseValueOptions(rawContainer: unknown, budget: OptionGraphBudget): ParsedValueOptions {
	const { structural, transformId, transformOptions } = classifyContainer(rawContainer, VALUE_STRUCTURAL, budget);

	return {
		transformId,
		value: structural[FIELDS.value],
		onEmpty: structural[FIELDS.onEmpty],
		whenEmpty: structural[FIELDS.whenEmpty],
		transformOptions,
	};
}

export interface ParsedRule {
	path: unknown;
	transformId: string;
	missingPath: unknown;
	onEmpty: unknown;
	whenEmpty: unknown;
	transformOptions: Record<string, unknown>;
}

export function parseRuleOptions(rawRule: unknown, budget: OptionGraphBudget): ParsedRule {
	const { structural, transformId, transformOptions } = classifyContainer(rawRule, RULE_STRUCTURAL, budget);

	return {
		path: structural[FIELDS.path],
		transformId,
		missingPath: structural[FIELDS.missingPath],
		onEmpty: structural[FIELDS.onEmpty],
		whenEmpty: structural[FIELDS.whenEmpty],
		transformOptions,
	};
}

export interface StructuredContainer {
	source: unknown;
	rules: unknown;
}

export function classifyStructuredContainer(rawContainer: unknown): StructuredContainer {
	const container = requirePlainObject(rawContainer);
	const keys = Reflect.ownKeys(container);

	if (keys.length > FIELD_TO_OPTION.size + VALUE_STRUCTURAL_SET.size) {
		throw new FormatterError('BOUND_EXCEEDED', 'the operation has too many option fields');
	}

	let source: unknown;
	let rules: unknown;

	for (const key of keys) {
		if (typeof key !== 'string') {
			throw new FormatterError('INVALID_OPTION', 'operation options must not have symbol keys');
		}

		if (key.length > MAX_KEY_LENGTH) {
			throw new FormatterError('UNKNOWN_OPTION', 'an unknown option field was provided');
		}

		const descriptor = Object.getOwnPropertyDescriptor(container, key)!;

		if (!('value' in descriptor) || !descriptor.enumerable) {
			throw new FormatterError('INVALID_OPTION', 'operation options must be own enumerable data properties');
		}

		if (key === FIELDS.source) {
			source = descriptor.value;
		} else if (key === FIELDS.rules) {
			rules = descriptor.value;
		} else if (!VALUE_STRUCTURAL_SET.has(key) && !FIELD_TO_OPTION.has(key)) {
			throw new FormatterError('UNKNOWN_OPTION', 'an unknown option field was provided');
		}
	}

	return { source, rules };
}

export function boundOptionGraph(
	collected: Record<string, unknown>,
	budget: OptionGraphBudget
): Record<string, unknown> {
	const remaining: Bounds = {
		...BOUNDS,
		maxSourceNodeCount: Math.max(0, BOUNDS.maxOptionGraphNodeCount - budget.nodes),
		maxSerializedSizeBytes: Math.max(0, BOUNDS.maxOptionGraphBytes - budget.bytes),
	};

	const walked = cloneSourceAccounted(collected, remaining, 'the transform options', 'INVALID_OPTION');
	budget.nodes += walked.nodes;
	budget.bytes += walked.bytes;
	return walked.value as Record<string, unknown>;
}
