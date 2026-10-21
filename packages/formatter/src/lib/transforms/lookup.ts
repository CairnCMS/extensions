import { types } from 'node:util';
import { BOUNDS } from '../bounds.js';
import { coerceInputString, coerceOptionalBoolean, coerceString, isAbsent } from '../coerce.js';
import { FormatterError } from '../errors.js';
import { assertDenseDataArray } from '../plain-array.js';
import type { TransformDefinition } from '../registry.js';

function ownDataString(row: object, prop: string, transform: string): string {
	const descriptor = Object.getOwnPropertyDescriptor(row, prop);

	if (descriptor === undefined || !('value' in descriptor)) {
		throw new FormatterError('INVALID_OPTION', `each lookup row must have a string "${prop}" property`, { transform });
	}

	if (typeof descriptor.value !== 'string') {
		throw new FormatterError('INVALID_OPTION', `each lookup row "${prop}" must be a string`, { transform });
	}

	return descriptor.value;
}

function buildLookup(rows: unknown, caseSensitive: boolean, transform: string): Map<string, string> {
	if (types.isProxy(rows) || !Array.isArray(rows)) {
		throw new FormatterError('INVALID_OPTION', 'option "table" must be an array of { key, value } rows', { transform });
	}

	if (rows.length > BOUNDS.maxLookupRows) {
		throw new FormatterError('BOUND_EXCEEDED', 'lookup table has too many rows', { transform });
	}

	assertDenseDataArray(rows, transform, 'INVALID_OPTION', 'option "table" must be an array of { key, value } rows');

	const map = new Map<string, string>();
	let totalLength = 0;

	for (let index = 0; index < rows.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(rows, index);

		if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
			throw new FormatterError('INVALID_OPTION', 'each lookup row must be a { key, value } object', { transform });
		}

		const row = descriptor.value;

		if (row === null || typeof row !== 'object' || types.isProxy(row) || Array.isArray(row)) {
			throw new FormatterError('INVALID_OPTION', 'each lookup row must be a { key, value } object', { transform });
		}

		const key = ownDataString(row, 'key', transform);
		const value = ownDataString(row, 'value', transform);

		totalLength += key.length + value.length;

		if (totalLength > BOUNDS.maxLookupAggregateLength) {
			throw new FormatterError('BOUND_EXCEEDED', 'lookup table is too large', { transform });
		}

		const mapKey = caseSensitive ? key : key.toLowerCase();
		if (!map.has(mapKey)) map.set(mapKey, value);
	}

	return map;
}

const table: TransformDefinition = {
	id: 'lookup.table',
	category: 'lookup',
	optionKeys: ['table', 'fallback', 'caseSensitive'],
	prepare(options, _ctx) {
		const id = this.id;
		const caseSensitive = coerceOptionalBoolean(options['caseSensitive'], 'caseSensitive', id) ?? true;
		const map = buildLookup(options['table'], caseSensitive, id);
		const hasFallback = !isAbsent(options['fallback']);
		const fallback = hasFallback ? coerceString(options['fallback'], 'fallback', id) : undefined;

		return (value) => {
			const key = coerceInputString(value, id);

			const match = map.get(caseSensitive ? key : key.toLowerCase());
			if (match !== undefined) return match;

			if (hasFallback) return fallback;

			throw new FormatterError('INVALID_INPUT', 'no lookup match and no fallback was provided', { transform: id });
		};
	},
};

export const lookupTransforms: TransformDefinition[] = [table];
