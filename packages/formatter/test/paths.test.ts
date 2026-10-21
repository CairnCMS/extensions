import { describe, expect, it } from 'vitest';
import { BOUNDS } from '../src/lib/bounds.js';
import { FormatterError } from '../src/lib/errors.js';
import { applyAtPath, parsePath } from '../src/lib/paths.js';

const upper = (leaf: unknown) => String(leaf).toUpperCase();

function codeOf(fn: () => unknown): string {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(FormatterError);
		return (error as FormatterError).code;
	}

	throw new Error('expected a rejection');
}

describe('parsePath', () => {
	it('parses a nested key path', () => {
		expect(parsePath('customer.phone')).toEqual([
			{ kind: 'key', key: 'customer' },
			{ kind: 'key', key: 'phone' },
		]);
	});

	it('parses a wildcard path and a root-array wildcard', () => {
		expect(parsePath('items[*].price')).toEqual([
			{ kind: 'key', key: 'items' },
			{ kind: 'wildcard' },
			{ kind: 'key', key: 'price' },
		]);

		expect(parsePath('[*].price')).toEqual([{ kind: 'wildcard' }, { kind: 'key', key: 'price' }]);
	});

	it('rejects forbidden prototype keys without echoing the segment', () => {
		for (const bad of ['__proto__', 'constructor', 'prototype']) {
			try {
				parsePath(`a.${bad}.b`);
				throw new Error('expected throw');
			} catch (error) {
				expect((error as Error).message).toMatch(/forbidden property/);
			}
		}
	});

	it('rejects more than one wildcard and empty paths', () => {
		expect(() => parsePath('a[*].b[*].c')).toThrow(/at most one/);
		expect(() => parsePath('')).toThrow(/non-empty/);
		expect(() => parsePath('a..b')).toThrow(/empty segment/);
	});

	it('rejects a non-string path without invoking its toString', () => {
		let invoked = false;

		const hostile = {
			toString: () => {
				invoked = true;
				return 'secret.path';
			},
		};

		let caught: unknown;

		try {
			parsePath(hostile as unknown as string);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(FormatterError);
		expect((caught as FormatterError).code).toBe('INVALID_PATH');
		expect((caught as Error).message).not.toContain('secret.path');
		expect(invoked).toBe(false);
	});

	it('rejects an over-long path before parsing', () => {
		expect(() => parsePath('a.'.repeat(400))).toThrow(/too long/);
	});

	it('accepts a path one below and at the length limit and refuses one more character', () => {
		const limit = BOUNDS.maxPathLength;

		expect(parsePath('a'.repeat(limit - 1))).toHaveLength(1);
		expect(parsePath('a'.repeat(limit))).toHaveLength(1);
		expect(codeOf(() => parsePath('a'.repeat(limit + 1)))).toBe('INVALID_PATH');
		expect(() => parsePath('a'.repeat(limit + 1))).toThrow(/path is too long/);
	});

	it('accepts a path one below and at the segment limit and refuses one more segment', () => {
		const limit = BOUNDS.maxPathDepth;
		const path = (segments: number): string => Array.from({ length: segments }, () => 'a').join('.');

		expect(parsePath(path(limit - 1))).toHaveLength(limit - 1);
		expect(parsePath(path(limit))).toHaveLength(limit);
		expect(codeOf(() => parsePath(path(limit + 1)))).toBe('INVALID_PATH');
		expect(() => parsePath(path(limit + 1))).toThrow(/path is too deep/);
	});

	it('never carries the untrusted path into the serialized error location', () => {
		let caught: unknown;

		try {
			parsePath('secret-token.__proto__.value');
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(FormatterError);
		expect((caught as FormatterError).code).toBe('INVALID_PATH');
		const serialized = JSON.stringify((caught as { location: unknown }).location);
		expect(serialized).not.toContain('secret-token');
		expect((caught as Error).message).not.toContain('secret-token');
	});
});

describe('applyAtPath', () => {
	it('applies to a nested key', () => {
		const root = { customer: { name: 'ada' } };
		const result = applyAtPath(root, parsePath('customer.name'), upper);
		expect(result).toEqual({ matched: true });
		expect(root.customer.name).toBe('ADA');
	});

	it('applies to every wildcard element', () => {
		const root = { items: [{ sku: 'a' }, { sku: 'b' }] };
		const result = applyAtPath(root, parsePath('items[*].sku'), upper);
		expect(result.matched).toBe(true);
		expect(root.items.map((i) => i.sku)).toEqual(['A', 'B']);
	});

	it('applies to a root-array wildcard', () => {
		const root = [{ sku: 'a' }, { sku: 'b' }];
		applyAtPath(root, parsePath('[*].sku'), upper);
		expect(root.map((i) => i.sku)).toEqual(['A', 'B']);
	});

	it('matches one below and at the wildcard-match limit and refuses one more match', () => {
		const limit = BOUNDS.maxWildcardMatches;
		const root = (matches: number) => ({ items: Array.from({ length: matches }, () => 'a') });

		expect(applyAtPath(root(limit - 1), parsePath('items[*]'), upper)).toEqual({ matched: true });

		const atLimit = root(limit);
		expect(applyAtPath(atLimit, parsePath('items[*]'), upper)).toEqual({ matched: true });
		expect(atLimit.items.every((item) => item === 'A')).toBe(true);

		expect(codeOf(() => applyAtPath(root(limit + 1), parsePath('items[*]'), upper))).toBe('BOUND_EXCEEDED');
		expect(() => applyAtPath(root(limit + 1), parsePath('items[*]'), upper)).toThrow(/too many wildcard matches/);
	});

	it('reports not matched for a missing path and creates no structure', () => {
		const root: Record<string, unknown> = { a: {} };
		const result = applyAtPath(root, parsePath('a.b.c'), upper);
		expect(result.matched).toBe(false);
		expect(root).toEqual({ a: {} });
	});

	it('does not touch prototypes when a key is absent', () => {
		const root: Record<string, unknown> = {};
		const result = applyAtPath(root, parsePath('missing'), upper);
		expect(result.matched).toBe(false);
		expect(root).toEqual({});
	});
});
