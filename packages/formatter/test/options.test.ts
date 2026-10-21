import { describe, expect, it } from 'vitest';
import { BOUNDS } from '../src/lib/bounds.js';
import { cloneSource, cloneSourceAccounted, jsonValueByteLength } from '../src/lib/clone.js';
import { FormatterError } from '../src/lib/errors.js';
import { boundOptionGraph, newBudget, parseValueOptions } from '../src/lib/options.js';
import { cloneAndMeasureResult } from '../src/lib/result.js';

function codeOf(fn: () => unknown): string {
	try {
		fn();
	} catch (error) {
		return (error as FormatterError).code;
	}

	throw new Error('expected a rejection');
}

function nest(depth: number): unknown {
	let node: unknown = 'leaf';
	for (let i = 0; i < depth; i += 1) node = { nested: node };
	return node;
}

describe('option-graph budget', () => {
	it('shares one budget so two individually valid option sets can exceed the combined node limit', () => {
		const budget = newBudget();
		const half = { list: Array.from({ length: 12_000 }, (_, i) => i) };

		expect(() => boundOptionGraph({ half }, budget)).not.toThrow();
		expect(() => boundOptionGraph({ half }, budget)).toThrow(/too many nodes/);
	});

	it('wires the depth bound through to the option graph', () => {
		expect(() => boundOptionGraph({ deep: nest(BOUNDS.maxSourceDepth + 1) }, newBudget())).toThrow(/too deeply nested/);
	});

	it('wires the byte bound through to the option graph', () => {
		expect(() => boundOptionGraph({ big: 'x'.repeat(BOUNDS.maxOptionGraphBytes + 16) }, newBudget())).toThrow(
			/too large/
		);
	});

	it('accepts settings one below and at the value-count limit and refuses one more value', () => {
		const limit = BOUNDS.maxOptionGraphNodeCount;
		const settings = (values: number) => ({ list: Array.from({ length: values - 2 }, () => 0) });

		expect(() => boundOptionGraph(settings(limit - 1), newBudget())).not.toThrow();
		expect(() => boundOptionGraph(settings(limit), newBudget())).not.toThrow();
		expect(codeOf(() => boundOptionGraph(settings(limit + 1), newBudget()))).toBe('BOUND_EXCEEDED');

		expect(() => boundOptionGraph(settings(limit + 1), newBudget())).toThrow(
			/the transform options has too many nodes/
		);
	});

	it('accepts settings one byte below and at the size limit and refuses one more byte', () => {
		const limit = BOUNDS.maxOptionGraphBytes;
		const settings = (bytes: number) => ({ big: 'x'.repeat(bytes - jsonValueByteLength({ big: '' })) });

		expect(jsonValueByteLength(settings(limit))).toBe(limit);
		expect(() => boundOptionGraph(settings(limit - 1), newBudget())).not.toThrow();
		expect(() => boundOptionGraph(settings(limit), newBudget())).not.toThrow();
		expect(codeOf(() => boundOptionGraph(settings(limit + 1), newBudget()))).toBe('BOUND_EXCEEDED');
		expect(() => boundOptionGraph(settings(limit + 1), newBudget())).toThrow(/the transform options is too large/);
	});

	it('returns a fresh copy that does not alias the source option value', () => {
		const source = { rows: [{ a: 1 }] };
		const bounded = boundOptionGraph({ table: source }, newBudget());
		expect(bounded['table']).toEqual(source);
		expect(bounded['table']).not.toBe(source);
	});
});

describe('transform identifier bound', () => {
	it('rejects an over-long transform id inside parseValueOptions, before classification or lookup', () => {
		const huge = 'a'.repeat(1_000_000);

		expect(codeOf(() => parseValueOptions({ mode: 'value', value: 'x', transform: huge }, newBudget()))).toBe(
			'UNKNOWN_TRANSFORM'
		);
	});

	it('returns a bounded id for a plausible but unregistered transform, leaving the registry lookup to the handler', () => {
		const parsed = parseValueOptions({ mode: 'value', value: 'x', transform: 'secret.transform' }, newBudget());
		expect(parsed.transformId).toBe('secret.transform');
	});
});

describe('incremental output accounting invariant', () => {
	it('jsonValueByteLength equals the accounted clone bytes for any plain value', () => {
		const values: unknown[] = [
			null,
			true,
			false,
			42,
			-1.5,
			'hello',
			'quote"and\\slash',
			[1, 'a', null],
			{ a: 1, b: [true, 'x'], c: {} },
		];

		for (const value of values) {
			expect(jsonValueByteLength(value)).toBe(cloneSourceAccounted(value).bytes);
		}
	});
});

describe('boundary-aware error codes', () => {
	it('tags an option-shape rejection with INVALID_OPTION', () => {
		expect(codeOf(() => boundOptionGraph({ bad: () => 1 }, newBudget()))).toBe('INVALID_OPTION');
	});

	it('tags a transform-result-shape rejection with RESULT_SHAPE', () => {
		expect(codeOf(() => cloneAndMeasureResult(() => 1))).toBe('RESULT_SHAPE');
	});

	it('tags a source-shape rejection with SOURCE_SHAPE', () => {
		expect(codeOf(() => cloneSource(() => 1))).toBe('SOURCE_SHAPE');
	});
});
