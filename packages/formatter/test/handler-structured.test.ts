import { describe, expect, it } from 'vitest';
import operation from '../src/api/index.js';
import { BOUNDS } from '../src/lib/bounds.js';
import { jsonValueByteLength } from '../src/lib/clone.js';
import { FormatterError } from '../src/lib/errors.js';
import { registerTransform } from '../src/lib/registry.js';
import { manifestOptionKeys, TRANSFORM_MANIFEST, transportFieldName } from '../src/lib/transport.js';

function run(options: unknown): unknown {
	return operation.handler(options as never, {} as never);
}

function thrown(fn: () => unknown): FormatterError {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(FormatterError);
		return error as FormatterError;
	}

	throw new Error('expected a rejection');
}

function indexOf(fn: () => unknown): number | undefined {
	return thrown(fn).location.index;
}

const region = transportFieldName('phone.validate', 'region');
const numberMode = transportFieldName('number.round', 'mode');
const numberScale = transportFieldName('number.round', 'scale');
const truncateMax = transportFieldName('text.truncate', 'maxLength');

describe('structured-mode handler', () => {
	it('applies rules in row order with a non-commuting pair, so reversing them changes the result', () => {
		const trimThenTruncate = [
			{ path: 'title', transform: 'text.trim' },
			{ path: 'title', transform: 'text.truncate', [truncateMax]: 5 },
		];

		expect(run({ mode: 'structured', source: { title: '  Hello World  ' }, rules: trimThenTruncate })).toEqual({
			title: 'Hello',
		});

		expect(
			run({ mode: 'structured', source: { title: '  Hello World  ' }, rules: [...trimThenTruncate].reverse() })
		).toEqual({ title: 'Hel' });
	});

	it('returns the payload unchanged when every rule leaves its field unchanged', () => {
		expect(
			run({
				mode: 'structured',
				source: { name: 'BOB' },
				rules: [
					{ path: 'name', transform: 'text.trim' },
					{ path: 'name', transform: 'text.uppercase' },
				],
			})
		).toEqual({ name: 'BOB' });
	});

	it('applies a wildcard rule to every element of a line-item array', () => {
		const result = run({
			mode: 'structured',
			source: { items: [{ price: '  1.50 ' }, { price: '2.00 ' }] },
			rules: [{ path: 'items[*].price', transform: 'text.trim' }],
		});

		expect(result).toEqual({ items: [{ price: '1.50' }, { price: '2.00' }] });
	});

	it('applies a wildcard rule over a root array', () => {
		expect(
			run({
				mode: 'structured',
				source: [{ code: 'ab' }, { code: 'cd' }],
				rules: [{ path: '[*].code', transform: 'text.uppercase' }],
			})
		).toEqual([{ code: 'AB' }, { code: 'CD' }]);
	});

	it('skips a rule whose path matches nothing by default and fails when set to fail', () => {
		expect(
			run({ mode: 'structured', source: { name: 'bob' }, rules: [{ path: 'missing', transform: 'text.uppercase' }] })
		).toEqual({ name: 'bob' });

		expect(() =>
			run({
				mode: 'structured',
				source: { name: 'bob' },
				rules: [{ path: 'missing', transform: 'text.uppercase', missingPath: 'fail' }],
			})
		).toThrow(/matched no field/);
	});

	it('treats a wildcard that reaches no element as no match: skip by default, reject on fail', () => {
		expect(
			run({ mode: 'structured', source: { items: [] }, rules: [{ path: 'items[*].price', transform: 'text.trim' }] })
		).toEqual({ items: [] });

		expect(
			run({ mode: 'structured', source: { name: 'bob' }, rules: [{ path: 'items[*].price', transform: 'text.trim' }] })
		).toEqual({ name: 'bob' });

		const error = thrown(() =>
			run({
				mode: 'structured',
				source: { items: [] },
				rules: [{ path: 'items[*].price', transform: 'text.trim', missingPath: 'fail' }],
			})
		);

		expect(error.code).toBe('INVALID_INPUT');
		expect(error.message).toMatch(/matched no field/);
	});

	it('fails atomically and leaves the original source graph unchanged', () => {
		const source = { a: 'x', b: 123 };

		expect(() =>
			run({
				mode: 'structured',
				source,
				rules: [
					{ path: 'a', transform: 'text.uppercase' },
					{ path: 'b', transform: 'text.trim' },
				],
			})
		).toThrow(FormatterError);

		expect(source).toEqual({ a: 'x', b: 123 });
	});

	it('prepares each rule once, not once per matched leaf', () => {
		let prepares = 0;

		registerTransform({
			id: 'test.prepcount',
			category: 'test',
			optionKeys: [],
			prepare() {
				prepares += 1;
				return (value) => value;
			},
		});

		run({
			mode: 'structured',
			source: { items: Array.from({ length: 50 }, () => ({ v: 'x' })) },
			rules: [{ path: 'items[*].v', transform: 'test.prepcount' }],
		});

		expect(prepares).toBe(1);
	});

	it('checks the operation-wide invocation cap before each transform call', () => {
		let calls = 0;

		registerTransform({
			id: 'test.count',
			category: 'test',
			optionKeys: [],
			prepare: () => (value) => {
				calls += 1;
				return value;
			},
		});

		const items = Array.from({ length: 7000 }, () => ({ v: 'x' }));
		const rule = { path: 'items[*].v', transform: 'test.count' };

		expect(() => run({ mode: 'structured', source: { items }, rules: [rule, rule, rule] })).toThrow(
			/too many field values/
		);

		expect(calls).toBe(BOUNDS.maxInvocationsPerOperation);
	});

	it('counts whenEmpty fallback leaves toward the invocation cap', () => {
		const items = Array.from({ length: 7000 }, () => ({ v: '' }));
		const rule = { path: 'items[*].v', transform: 'text.trim', onEmpty: 'replace', whenEmpty: 'N/A' };

		expect(() => run({ mode: 'structured', source: { items }, rules: [rule, rule, rule] })).toThrow(
			/too many field values/
		);
	});

	it('completes one below and at the operation-wide invocation cap', () => {
		const limit = BOUNDS.maxInvocationsPerOperation;
		const half = limit / 2;
		const items = (length: number): string[] => Array.from({ length }, () => ' x ');
		const rule = { path: 'items[*]', transform: 'text.trim' };

		const below = run({
			mode: 'structured',
			source: { items: items(half - 1), single: ' x ' },
			rules: [rule, rule, { path: 'single', transform: 'text.trim' }],
		}) as { items: string[]; single: string };

		expect(below.items.every((item) => item === 'x')).toBe(true);
		expect(below.single).toBe('x');

		const atLimit = run({ mode: 'structured', source: { items: items(half) }, rules: [rule, rule] }) as {
			items: string[];
		};

		expect(atLimit.items).toHaveLength(half);
		expect(atLimit.items.every((item) => item === 'x')).toBe(true);
	});

	it('accepts processed field content one byte below and at the operation-wide limit and refuses one more byte', () => {
		const limit = BOUNDS.maxProcessedInputBytes;
		const large = 'a'.repeat(99_998);
		const largeRules = Math.floor(limit / jsonValueByteLength(large));
		const largeBytes = largeRules * jsonValueByteLength(large);

		const source = (processedBytes: number) => ({
			large,
			small: 'b'.repeat(processedBytes - largeBytes - jsonValueByteLength('')),
		});

		const rules = [
			...Array.from({ length: largeRules }, () => ({ path: 'large', transform: 'text.trim' })),
			{ path: 'small', transform: 'text.trim' },
		];

		expect(largeBytes + jsonValueByteLength(source(limit).small)).toBe(limit);
		expect(() => run({ mode: 'structured', source: source(limit - 1), rules })).not.toThrow();
		expect(() => run({ mode: 'structured', source: source(limit), rules })).not.toThrow();

		const error = thrown(() => run({ mode: 'structured', source: source(limit + 1), rules }));
		expect(error.code).toBe('BOUND_EXCEEDED');
		expect(error.message).toMatch(/processed too much field content/);
	});

	it('accepts a returned payload one byte below and at the output limit and refuses one more byte', () => {
		const limit = BOUNDS.maxAggregateOutputBytes;
		const expanded = 'x'.repeat(100_000);

		const result = (tailLength: number) => ({
			items: Array.from({ length: 10 }, () => expanded),
			tail: 'y'.repeat(tailLength),
		});

		const tailFor = (outputBytes: number): number => outputBytes - jsonValueByteLength(result(0));
		const find = transportFieldName('text.replace', 'find');
		const replaceWith = transportFieldName('text.replace', 'replaceWith');

		const options = (outputBytes: number) => ({
			mode: 'structured',
			source: { items: Array.from({ length: 10 }, () => 'a'), tail: 'a' },
			rules: [
				{ path: 'items[*]', transform: 'text.replace', [find]: 'a', [replaceWith]: expanded },
				{ path: 'tail', transform: 'text.replace', [find]: 'a', [replaceWith]: 'y'.repeat(tailFor(outputBytes)) },
			],
		});

		expect(jsonValueByteLength(run(options(limit - 1)))).toBe(limit - 1);
		expect(jsonValueByteLength(run(options(limit)))).toBe(limit);

		const error = thrown(() => run(options(limit + 1)));
		expect(error.code).toBe('BOUND_EXCEEDED');
		expect(error.message).toMatch(/output payload is too large/);
	});

	it('runs one below and at the rule limit and refuses one more rule', () => {
		const limit = BOUNDS.maxRulesPerOperation;
		const rules = (count: number) => Array.from({ length: count }, () => ({ path: 'a', transform: 'text.trim' }));

		expect(run({ mode: 'structured', source: { a: ' x ' }, rules: rules(limit - 1) })).toEqual({ a: 'x' });
		expect(run({ mode: 'structured', source: { a: ' x ' }, rules: rules(limit) })).toEqual({ a: 'x' });

		const error = thrown(() => run({ mode: 'structured', source: { a: ' x ' }, rules: rules(limit + 1) }));
		expect(error.code).toBe('BOUND_EXCEEDED');
		expect(error.message).toMatch(/the operation has too many rules/);
	});

	it('bounds total processed content across rules even when the rule and invocation caps are not reached', () => {
		const source = { f: 'a'.repeat(40_000) };
		const rule = { path: 'f', transform: 'text.trim' };

		const under = Array.from({ length: 20 }, () => rule);
		expect(run({ mode: 'structured', source, rules: under })).toEqual(source);

		const over = Array.from({ length: 30 }, () => rule);
		const error = thrown(() => run({ mode: 'structured', source, rules: over }));
		expect(error.code).toBe('BOUND_EXCEEDED');
		expect(error.message).toMatch(/processed too much field content/);
	});

	it('resolves the empty-input policies per rule: skip default, replacement, and null', () => {
		expect(
			run({
				mode: 'structured',
				source: { a: '', b: '', c: '' },
				rules: [
					{ path: 'a', transform: 'text.trim' },
					{ path: 'b', transform: 'text.trim', onEmpty: 'replace', whenEmpty: 'N/A' },
					{ path: 'c', transform: 'text.trim', onEmpty: 'set-null', whenEmpty: 'stale' },
				],
			})
		).toEqual({ a: '', b: 'N/A', c: null });
	});

	it('under skip, a wildcard preserves empty leaves and formats the rest', () => {
		const items = ['2015550123', '', '6502530000', ''];
		const phoneRegion = transportFieldName('phone.format', 'region');

		expect(
			run({
				mode: 'structured',
				source: { items },
				rules: [{ path: 'items[*]', transform: 'phone.format', [phoneRegion]: 'US' }],
			})
		).toEqual({ items: ['+12015550123', '', '+16502530000', ''] });
	});

	it('under fail, an empty leaf rejects the operation and leaves the original source untouched', () => {
		const source = { items: ['2015550123', ''] };
		const phoneRegion = transportFieldName('phone.format', 'region');

		const error = thrown(() =>
			run({
				mode: 'structured',
				source,
				rules: [{ path: 'items[*]', transform: 'phone.format', [phoneRegion]: 'US', onEmpty: 'fail' }],
			})
		);

		expect(error.code).toBe('INVALID_INPUT');
		expect(source).toEqual({ items: ['2015550123', ''] });
	});

	it('runs input-handling transforms on empty, handling empty string and null separately', () => {
		const table = transportFieldName('lookup.table', 'table');
		const rule = { path: 'a', transform: 'lookup.table', [table]: [{ key: '', value: 'BLANK' }] };

		expect(run({ mode: 'structured', source: { a: '' }, rules: [rule] })).toEqual({ a: 'BLANK' });

		const nullError = thrown(() => run({ mode: 'structured', source: { a: null }, rules: [rule] }));
		expect(nullError.code).toBe('INVALID_INPUT');
	});

	it('preserves data keys literally named value, payload, and changed', () => {
		expect(
			run({
				mode: 'structured',
				source: { value: 1, payload: 2, changed: 3, phone: '2015550123' },
				rules: [{ path: 'phone', transform: 'phone.format', [transportFieldName('phone.format', 'region')]: 'US' }],
			})
		).toEqual({ value: 1, payload: 2, changed: 3, phone: '+12015550123' });
	});

	it('rejects an extension-bearing phone under E.164 and keeps it under RFC 3966', () => {
		const phoneRegion = transportFieldName('phone.format', 'region');
		const phoneFormat = transportFieldName('phone.format', 'format');
		const source = { phone: '2015550123 ext. 42' };

		const error = thrown(() =>
			run({ mode: 'structured', source, rules: [{ path: 'phone', transform: 'phone.format', [phoneRegion]: 'US' }] })
		);

		expect(error.code).toBe('INVALID_INPUT');
		expect(error.location).toEqual({ transform: 'phone.format', index: 0 });
		expect(source).toEqual({ phone: '2015550123 ext. 42' });

		expect(
			run({
				mode: 'structured',
				source,
				rules: [{ path: 'phone', transform: 'phone.format', [phoneRegion]: 'US', [phoneFormat]: 'rfc3966' }],
			})
		).toEqual({ phone: 'tel:+12015550123;ext=42' });
	});

	it('ignores an option field that belongs to another transform when it is left on a rule', () => {
		const staleRegion = transportFieldName('phone.format', 'region');

		const rules = [{ path: 'a', transform: 'text.trim', [staleRegion]: 'US' }];

		expect(run({ mode: 'structured', source: { a: ' x ' }, rules })).toEqual({ a: 'x' });
	});

	it('rejects Phone: Validate as a field rule because it returns a diagnostic object', () => {
		const error = thrown(() =>
			run({
				mode: 'structured',
				source: { phone: '2015550123' },
				rules: [{ path: 'phone', transform: 'phone.validate', [region]: 'US' }],
			})
		);

		expect(error.code).toBe('INVALID_OPTION');
		expect(error.message).toMatch(/diagnostic result/);
		expect(error.location).toEqual({ transform: 'phone.validate', index: 0 });
	});

	it('reports a rule whose replacement value was cleared as a configuration error at its index', () => {
		const error = thrown(() =>
			run({
				mode: 'structured',
				source: { a: '' },
				rules: [
					{ path: 'a', transform: 'text.trim' },
					{ path: 'a', transform: 'text.trim', onEmpty: 'replace', whenEmpty: null },
				],
			})
		);

		expect(error.code).toBe('INVALID_OPTION');
		expect(error.location).toEqual({ transform: 'text.trim', index: 1 });
	});

	it('rejects an output-expanding wildcard before retaining the over-budget payload', () => {
		const items = Array.from({ length: 12 }, () => ({ s: 'a' }));
		const find = transportFieldName('text.replace', 'find');
		const replaceWith = transportFieldName('text.replace', 'replaceWith');

		const error = thrown(() =>
			run({
				mode: 'structured',
				source: { items },
				rules: [{ path: 'items[*].s', transform: 'text.replace', [find]: 'a', [replaceWith]: 'x'.repeat(100_000) }],
			})
		);

		expect(error.message).toMatch(/output payload is too large/);
		expect(error.location).toEqual({ transform: 'text.replace', index: 0 });
	});

	it('de-aliases a transform that returns the same object for two leaves', () => {
		const shared = { tag: 'X' };
		registerTransform({ id: 'test.shared', category: 'test', optionKeys: [], prepare: () => () => shared });

		const payload = run({
			mode: 'structured',
			source: { items: [{ v: 'a' }, { v: 'b' }] },
			rules: [{ path: 'items[*].v', transform: 'test.shared' }],
		}) as { items: Array<{ v: unknown }> };

		expect(payload.items[0]!.v).toEqual({ tag: 'X' });
		expect(payload.items[1]!.v).toEqual({ tag: 'X' });
		expect(payload.items[0]!.v).not.toBe(payload.items[1]!.v);
	});

	it('rejects a scalar or null source', () => {
		expect(() => run({ mode: 'structured', source: 'hello', rules: [] })).toThrow(/source object or array/);
		expect(() => run({ mode: 'structured', source: null, rules: [] })).toThrow(/source object or array/);
		expect(() => run({ mode: 'structured', source: 42, rules: [] })).toThrow(/source object or array/);
	});

	it('rejects an unknown outer field and never invokes an outer getter, but tolerates value-mode remnants', () => {
		expect(() => run({ mode: 'structured', source: {}, rules: [], bogus: 1 })).toThrow(/unknown option field/);

		let invoked = false;
		const options: Record<string, unknown> = { mode: 'structured', rules: [] };

		Object.defineProperty(options, 'source', {
			enumerable: true,
			configurable: true,
			get() {
				invoked = true;
				return {};
			},
		});

		expect(() => run(options)).toThrow(/own enumerable/);
		expect(invoked).toBe(false);

		expect(
			run({
				mode: 'structured',
				source: { a: 'x' },
				rules: [{ path: 'a', transform: 'text.uppercase' }],
				value: 'stale',
				transform: 'text.trim',
				number_round__scale: 2,
			})
		).toEqual({ a: 'X' });
	});

	it('rejects too many outer option fields before classifying them', () => {
		const options: Record<string, unknown> = { mode: 'structured', source: {}, rules: [] };
		const recognizedFieldCount = TRANSFORM_MANIFEST.reduce((sum, entry) => sum + manifestOptionKeys(entry).length, 0);
		for (let i = 0; i < recognizedFieldCount + 20; i += 1) options[`junk${i}`] = 1;
		expect(() => run(options)).toThrow(/too many option fields/);
	});

	it('rejects a sparse rules array', () => {
		const rules: unknown[] = [{ path: 'a', transform: 'text.trim' }];
		rules[2] = { path: 'a', transform: 'text.trim' };
		expect(() => run({ mode: 'structured', source: { a: 'x' }, rules })).toThrow(/each rule must be/);
	});

	it('carries the rule index through configuration, empty handling, prepare, and apply failures', () => {
		const ok = { path: 'a', transform: 'text.trim' };

		expect(
			indexOf(() =>
				run({ mode: 'structured', source: { a: 'x' }, rules: [ok, { path: 'a', transform: 'text.trim', bogus: 1 }] })
			)
		).toBe(1);

		expect(
			indexOf(() =>
				run({
					mode: 'structured',
					source: { a: '' },
					rules: [ok, { path: 'a', transform: 'text.trim', onEmpty: 'fail' }],
				})
			)
		).toBe(1);

		expect(
			indexOf(() =>
				run({
					mode: 'structured',
					source: { a: 'x', b: 1.5 },
					rules: [ok, { path: 'b', transform: 'number.round', [numberMode]: 'bogus' }],
				})
			)
		).toBe(1);

		expect(
			indexOf(() =>
				run({ mode: 'structured', source: { a: 'x', b: 123 }, rules: [ok, { path: 'b', transform: 'text.trim' }] })
			)
		).toBe(1);
	});

	it('reports an invalid transform option before an invalid empty-handling configuration', () => {
		const error = thrown(() =>
			run({
				mode: 'structured',
				source: { a: '' },
				rules: [
					{ path: 'a', transform: 'text.trim' },
					{ path: 'a', transform: 'number.round', [numberScale]: 2, [numberMode]: 'bogus', onEmpty: 'replace' },
				],
			})
		);

		expect(error.message).toMatch(/"mode" must be/);
		expect(error.location).toEqual({ transform: 'number.round', index: 1 });
	});

	it('carries the rule index on a path error without doubling the formatter prefix', () => {
		const error = thrown(() =>
			run({ mode: 'structured', source: { a: 'x' }, rules: [{ path: 123, transform: 'text.trim' }] })
		);

		expect(error.code).toBe('INVALID_PATH');
		expect(error.location).toEqual({ transform: 'text.trim', index: 0 });
		expect(error.message.match(/formatter/g)?.length).toBe(1);
	});

	it('names the resolved transform on post-resolution rule errors but not on unknown-transform errors', () => {
		const missing = thrown(() =>
			run({
				mode: 'structured',
				source: { a: 'x' },
				rules: [{ path: 'missing', transform: 'text.uppercase', missingPath: 'fail' }],
			})
		);

		expect(missing.location).toEqual({ transform: 'text.uppercase', index: 0 });

		const unknown = thrown(() =>
			run({ mode: 'structured', source: { a: 'x' }, rules: [{ path: 'a', transform: 'nope.nope' }] })
		);

		expect(unknown.code).toBe('UNKNOWN_TRANSFORM');
		expect(unknown.location).toEqual({ index: 0 });
	});

	it('rejects a symbol-keyed outer option', () => {
		const options: Record<string, unknown> = { mode: 'structured', source: {}, rules: [] };
		(options as Record<PropertyKey, unknown>)[Symbol('leak')] = 1;

		const error = thrown(() => run(options));
		expect(error.code).toBe('INVALID_OPTION');
		expect(error.message).toMatch(/symbol/);
	});

	it('clones the input object even when a transform returns the exact input object', () => {
		registerTransform({ id: 'test.identity', category: 'test', optionKeys: [], prepare: () => (leaf) => leaf });

		const source = { obj: { k: 1 } };
		const result = run({ mode: 'structured', source, rules: [{ path: 'obj', transform: 'test.identity' }] });

		expect((result as { obj: unknown }).obj).toEqual({ k: 1 });
		expect((result as { obj: unknown }).obj).not.toBe(source.obj);
	});

	it('leaves the retained original source unchanged after a successful run', () => {
		const source = { name: '  bob  ', items: [{ v: 'a' }] };

		const result = run({
			mode: 'structured',
			source,
			rules: [
				{ path: 'name', transform: 'text.trim' },
				{ path: 'items[*].v', transform: 'text.uppercase' },
			],
		});

		expect(result).toEqual({ name: 'bob', items: [{ v: 'A' }] });
		expect(source).toEqual({ name: '  bob  ', items: [{ v: 'a' }] });
	});

	it('rejects a proxy rules array, an accessor rule, and an unknown rule field', () => {
		expect(() => run({ mode: 'structured', source: {}, rules: new Proxy([], {}) })).toThrow(FormatterError);

		const unknownField = thrown(() =>
			run({ mode: 'structured', source: { a: 'x' }, rules: [{ path: 'a', transform: 'text.trim', bogus: 1 }] })
		);

		expect(unknownField.code).toBe('UNKNOWN_OPTION');
		expect(unknownField.message).toMatch(/unknown option field/);
		expect(unknownField.location.index).toBe(0);

		const rules: unknown[] = [];

		Object.defineProperty(rules, 0, {
			enumerable: true,
			configurable: true,
			get() {
				return { path: 'a', transform: 'text.trim' };
			},
		});

		expect(() => run({ mode: 'structured', source: { a: 'x' }, rules })).toThrow(/each rule must be/);
	});
});
