import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOUNDS } from '../src/lib/bounds.js';
import { cloneSource, jsonValueByteLength } from '../src/lib/clone.js';
import { FormatterError } from '../src/lib/errors.js';

afterEach(() => {
	vi.restoreAllMocks();
});

function codeOf(fn: () => unknown): string {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(FormatterError);
		return (error as FormatterError).code;
	}

	throw new Error('expected a rejection');
}

describe('cloneSource accepts plain JSON data', () => {
	it('deep-clones objects and arrays into an independent graph', () => {
		const source = { a: 1, b: 'x', c: [true, null, { d: 2 }] };
		const clone = cloneSource(source) as typeof source;

		expect(clone).toEqual(source);
		expect(clone).not.toBe(source);
		expect(clone.c).not.toBe(source.c);
		expect(clone.c[2]).not.toBe(source.c[2]);
	});

	it('accepts a null-prototype object and rebuilds it as plain data', () => {
		const source = Object.assign(Object.create(null), { k: 'v' });
		const clone = cloneSource(source) as { k: string };
		expect(clone.k).toBe('v');
		expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
	});
});

describe('cloneSource rejects non-JSON shapes loudly', () => {
	const cases: Array<[string, unknown]> = [
		['undefined value', { a: undefined }],
		['symbol value', { a: Symbol('s') }],
		['bigint', { a: 1n }],
		['non-finite number', { a: Infinity }],
		['function', { a: () => 1 }],
		[
			'sparse array',
			(() => {
				const x = [1];
				x[3] = 2;
				return { x };
			})(),
		],
	];

	for (const [name, source] of cases) {
		it(`rejects ${name}`, () => {
			expect(() => cloneSource(source)).toThrow(FormatterError);
		});
	}

	it('rejects a cycle', () => {
		const source: Record<string, unknown> = {};
		source['self'] = source;
		expect(() => cloneSource(source)).toThrow(/cycle or repeated/);
	});

	it('rejects a repeated object reference (aliasing)', () => {
		const shared = { n: 1 };
		expect(() => cloneSource({ a: shared, b: shared })).toThrow(/cycle or repeated/);
	});

	it('rejects an accessor without invoking it', () => {
		let invoked = false;
		const source = {};

		Object.defineProperty(source, 'g', {
			get: () => {
				invoked = true;
				return 1;
			},
			enumerable: true,
		});

		expect(() => cloneSource(source)).toThrow(/accessor/);
		expect(invoked).toBe(false);
	});

	it('rejects an exotic prototype', () => {
		expect(() => cloneSource({ d: new Date() })).toThrow(/non-plain prototype/);
	});

	it('rejects a proxy before firing any trap', () => {
		let trapped = false;

		const proxy = new Proxy(
			{},
			{
				ownKeys() {
					trapped = true;
					return [];
				},
				getPrototypeOf() {
					trapped = true;
					return null;
				},
			}
		);

		expect(() => cloneSource({ p: proxy })).toThrow(/proxy/);
		expect(trapped).toBe(false);
	});

	it('rejects an accessor at an array index without invoking it', () => {
		let invoked = false;
		const arr: unknown[] = [];

		Object.defineProperty(arr, 0, {
			get: () => {
				invoked = true;
				return 1;
			},
			enumerable: true,
			configurable: true,
		});

		arr.length = 1;
		expect(() => cloneSource({ arr })).toThrow(/accessor/);
		expect(invoked).toBe(false);
	});

	it('rejects a symbol-keyed array property', () => {
		const arr: unknown[] = [1];
		(arr as unknown as Record<symbol, unknown>)[Symbol('s')] = 2;
		expect(() => cloneSource({ arr })).toThrow(/symbol/);
	});

	it('rejects a non-index property on an array', () => {
		const arr: unknown[] = [1];
		(arr as unknown as Record<string, unknown>)['extra'] = 2;
		expect(() => cloneSource({ arr })).toThrow(/non-index/);
	});

	it('rejects a non-enumerable own property', () => {
		const source = {};
		Object.defineProperty(source, 'hidden', { value: 1, enumerable: false });
		expect(() => cloneSource(source)).toThrow(/non-enumerable/);
	});

	it('rejects a revoked proxy with a typed FormatterError, not a raw TypeError', () => {
		const { proxy, revoke } = Proxy.revocable({}, {});
		revoke();
		expect(() => cloneSource({ p: proxy })).toThrow(FormatterError);
	});
});

describe('cloneSource preserves dangerous own keys as data without polluting', () => {
	it('keeps a literal __proto__ key as data and leaves Object.prototype clean', () => {
		const source = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
		const clone = cloneSource(source) as Record<string, unknown>;

		expect(Object.prototype.hasOwnProperty.call(clone, '__proto__')).toBe(true);
		expect((clone as { ok: number }).ok).toBe(1);
		expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
		expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
	});

	it('keeps literal constructor and prototype keys as data and leaves Object.prototype clean', () => {
		const source = JSON.parse('{"constructor": {"polluted": true}, "prototype": {"polluted": true}, "ok": 1}');
		const clone = cloneSource(source) as Record<string, unknown>;

		expect(Object.prototype.hasOwnProperty.call(clone, 'constructor')).toBe(true);
		expect(Object.prototype.hasOwnProperty.call(clone, 'prototype')).toBe(true);
		expect(clone['constructor']).toEqual({ polluted: true });
		expect(clone['prototype']).toEqual({ polluted: true });
		expect(clone['ok']).toBe(1);
		expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
		expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
		expect({}.constructor).toBe(Object);
	});

	it('leaves the original graph untouched', () => {
		const source = { a: { b: 1 } };
		cloneSource(source);
		expect(source).toEqual({ a: { b: 1 } });
	});
});

describe('cloneSource enforces bounds during the walk', () => {
	it('rejects an over-deep payload', () => {
		let node: Record<string, unknown> = {};
		const root = node;

		for (let i = 0; i < 40; i += 1) {
			const next = {};
			node['n'] = next;
			node = next;
		}

		expect(() => cloneSource(root, { ...BOUNDS, maxSourceDepth: 8 })).toThrow(/deeply nested|too many nodes/);
	});

	it('rejects too many nodes', () => {
		const source = { list: Array.from({ length: 50 }, (_, i) => ({ i })) };
		expect(() => cloneSource(source, { ...BOUNDS, maxSourceNodeCount: 10 })).toThrow(/too many nodes/);
	});

	it('accepts a payload one below and at the real nesting limit and refuses one more level', () => {
		const limit = BOUNDS.maxSourceDepth;

		const nest = (depth: number): unknown => {
			let node: unknown = 'leaf';
			for (let i = 0; i < depth; i += 1) node = { n: node };
			return node;
		};

		expect(() => cloneSource(nest(limit - 1))).not.toThrow();
		expect(() => cloneSource(nest(limit))).not.toThrow();
		expect(codeOf(() => cloneSource(nest(limit + 1)))).toBe('BOUND_EXCEEDED');
		expect(() => cloneSource(nest(limit + 1))).toThrow(/source payload is too deeply nested/);
	});

	it('accepts a payload one below and at the real value-count limit and refuses one more value', () => {
		const limit = BOUNDS.maxSourceNodeCount;
		const payload = (values: number): unknown => ({ list: Array.from({ length: values - 2 }, () => 0) });

		expect(() => cloneSource(payload(limit - 1))).not.toThrow();
		expect(() => cloneSource(payload(limit))).not.toThrow();
		expect(codeOf(() => cloneSource(payload(limit + 1)))).toBe('BOUND_EXCEEDED');
		expect(() => cloneSource(payload(limit + 1))).toThrow(/source payload has too many nodes/);
	});

	it('accepts a payload one byte below and at the real size limit and refuses one more byte', () => {
		const limit = BOUNDS.maxSerializedSizeBytes;
		const payload = (bytes: number): unknown => ({ s: 'x'.repeat(bytes - jsonValueByteLength({ s: '' })) });

		expect(jsonValueByteLength(payload(limit))).toBe(limit);
		expect(() => cloneSource(payload(limit - 1))).not.toThrow();
		expect(() => cloneSource(payload(limit))).not.toThrow();
		expect(codeOf(() => cloneSource(payload(limit + 1)))).toBe('BOUND_EXCEEDED');
		expect(() => cloneSource(payload(limit + 1))).toThrow(/source payload is too large/);
	});

	it('enforces the size bound at the byte boundary (below rejects, at accepts)', () => {
		const payload = { a: 'xx' };
		expect(() => cloneSource(payload, { ...BOUNDS, maxSerializedSizeBytes: 10 })).toThrow(/too large/);
		expect(cloneSource(payload, { ...BOUNDS, maxSerializedSizeBytes: 11 })).toEqual(payload);
	});

	it('counts JSON escaping so escaped strings cannot undercount', () => {
		const payload = { s: '"'.repeat(20) };
		expect(() => cloneSource(payload, { ...BOUNDS, maxSerializedSizeBytes: 40 })).toThrow(/too large/);
	});

	it('counts the exact serialized length of finite numbers, including at the boundary', () => {
		expect(cloneSource(5)).toBe(5);
		expect(() => cloneSource(12345, { ...BOUNDS, maxSerializedSizeBytes: 4 })).toThrow(/too large/);

		const n = -0.0000031339555805550973;
		expect(() => cloneSource({ a: n, b: n }, { ...BOUNDS, maxSerializedSizeBytes: 61 })).toThrow(/too large/);
		expect(cloneSource({ a: n, b: n }, { ...BOUNDS, maxSerializedSizeBytes: 62 })).toEqual({ a: n, b: n });
	});

	it('rejects alternate array-index spellings that would be silently dropped', () => {
		for (const spelling of ['01', '1e0', '-0']) {
			const arr: unknown[] = [1, 2];
			(arr as unknown as Record<string, unknown>)[spelling] = 99;
			expect(() => cloneSource({ arr }), spelling).toThrow(/non-index/);
		}
	});

	it('counts key bytes and non-ASCII string bytes toward the size bound', () => {
		const longKey = 'k'.repeat(10_000);
		expect(() => cloneSource({ [longKey]: 1 }, { ...BOUNDS, maxSerializedSizeBytes: 100 })).toThrow(/too large/);

		const nonAscii = { greeting: 'ü'.repeat(200) };
		expect(() => cloneSource(nonAscii, { ...BOUNDS, maxSerializedSizeBytes: 300 })).toThrow(/too large/);
		expect(() => cloneSource(nonAscii, { ...BOUNDS, maxSerializedSizeBytes: 10_000 })).not.toThrow();
	});

	it('rejects an oversized string by length without scanning it, in the value and the key position', () => {
		const spy = vi.spyOn(String.prototype, 'charCodeAt');

		const overValue = 'a'.repeat(1_000_000);
		expect(() => cloneSource(overValue, { ...BOUNDS, maxSerializedSizeBytes: 100 })).toThrow(/too large/);

		const overKey = 'k'.repeat(1_000_000);
		expect(() => cloneSource({ [overKey]: 1 }, { ...BOUNDS, maxSerializedSizeBytes: 100 })).toThrow(/too large/);

		expect(spy.mock.calls.length).toBe(0);
	});

	it('stops scanning a string once its running byte count exceeds the budget', () => {
		const spy = vi.spyOn(String.prototype, 'charCodeAt');

		const value = 'ü'.repeat(150);
		expect(() => cloneSource(value, { ...BOUNDS, maxSerializedSizeBytes: 200 })).toThrow(/too large/);

		expect(spy.mock.calls.length).toBeGreaterThan(0);
		expect(spy.mock.calls.length).toBeLessThan(value.length);
	});
});
