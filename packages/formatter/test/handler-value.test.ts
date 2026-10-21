import { describe, expect, it } from 'vitest';
import operation from '../src/api/index.js';
import { BOUNDS } from '../src/lib/bounds.js';
import { FormatterError } from '../src/lib/errors.js';
import { registerTransform } from '../src/lib/registry.js';
import { manifestOptionKeys, TRANSFORM_MANIFEST, transportFieldName } from '../src/lib/transport.js';

function run(options: unknown): unknown {
	return operation.handler(options as never, {} as never);
}

function caught(fn: () => unknown): FormatterError {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(FormatterError);
		return error as FormatterError;
	}

	throw new Error('expected a rejection');
}

const scale = transportFieldName('number.round', 'scale');
const roundingMode = transportFieldName('number.round', 'mode');
const region = transportFieldName('phone.validate', 'region');

describe('value-mode handler', () => {
	it('dispatches to the selected transform and returns the value directly', () => {
		expect(run({ mode: 'value', value: '  hi  ', transform: 'text.trim' })).toBe('hi');
		expect(run({ mode: 'value', value: 'hi', transform: 'text.trim' })).toBe('hi');
	});

	it('runs the requested transform, not another, from the same options shape', () => {
		expect(run({ mode: 'value', value: 'Hello World', transform: 'text.slugify' })).toBe('hello-world');
		expect(run({ mode: 'value', value: 'Hello World', transform: 'text.uppercase' })).toBe('HELLO WORLD');
	});

	it('passes a prefixed option through to its transform', () => {
		expect(run({ mode: 'value', value: 1.005, transform: 'number.round', [scale]: 2 })).toBe('1.01');
	});

	it('ignores a stale option that belongs to another transform', () => {
		expect(run({ mode: 'value', value: '  hi  ', transform: 'text.trim', [region]: 'US' })).toBe('hi');
	});

	it('ignores stale source and rules after a switch from structured to value mode', () => {
		expect(
			run({ mode: 'value', value: '  hi  ', transform: 'text.trim', source: { a: 1 }, rules: [{ path: 'x' }] })
		).toBe('hi');
	});

	it('does not trip the key-count cap on the full recognized field allowlist', () => {
		const options: Record<string, unknown> = { mode: 'value', value: 'Hello World', transform: 'text.slugify' };

		for (const entry of TRANSFORM_MANIFEST) {
			for (const key of manifestOptionKeys(entry)) {
				options[transportFieldName(entry.id, key)] = 1;
			}
		}

		expect(run(options)).toBe('hello-world');
	});

	it('rejects an option unknown to the whole registry with UNKNOWN_OPTION', () => {
		const error = caught(() => run({ mode: 'value', value: 'x', transform: 'text.trim', number_round__scal: 2 }));
		expect(error.code).toBe('UNKNOWN_OPTION');
		expect(error.message).toMatch(/unknown option field/);
	});

	it('rejects an option field name longer than any valid field before looking it up', () => {
		const error = caught(() => run({ mode: 'value', value: 'x', transform: 'text.trim', ['z'.repeat(500)]: 1 }));
		expect(error.code).toBe('UNKNOWN_OPTION');
	});

	it('rejects an unknown transform with UNKNOWN_TRANSFORM', () => {
		const error = caught(() => run({ mode: 'value', value: 'x', transform: 'nope.nope' }));
		expect(error.code).toBe('UNKNOWN_TRANSFORM');
		expect(error.message).toMatch(/transform is unknown/);
	});

	it('rejects an over-long transform id before the registry lookup, without echoing it', () => {
		const huge = 'a'.repeat(1_000_000);
		const error = caught(() => run({ mode: 'value', value: 'x', transform: huge }));
		expect(error.code).toBe('UNKNOWN_TRANSFORM');
		expect(error.message).not.toContain(huge);
		expect(error.message.length).toBeLessThan(200);
	});

	it('rejects a null or proxy options object with a typed error, not a raw TypeError', () => {
		expect(() => run(null)).toThrow(FormatterError);
		expect(() => run(new Proxy({ mode: 'value', value: 'x', transform: 'text.trim' }, {}))).toThrow(FormatterError);
	});

	it('rejects an invalid mode explicitly', () => {
		expect(() => run({ mode: 'bogus', value: 'x', transform: 'text.trim' })).toThrow(/mode/);
	});

	it('rejects a getter on any structural field without invoking it', () => {
		for (const key of ['mode', 'value', 'transform', 'onEmpty', 'whenEmpty']) {
			let invoked = false;
			const options: Record<string, unknown> = { mode: 'value', value: 'x', transform: 'text.trim' };

			Object.defineProperty(options, key, {
				enumerable: true,
				configurable: true,
				get() {
					invoked = true;
					return 'x';
				},
			});

			expect(() => run(options)).toThrow(FormatterError);
			expect(invoked).toBe(false);
		}
	});

	it('never invokes a getter placed on an option value', () => {
		let invoked = false;
		const options: Record<string, unknown> = { mode: 'value', value: 'x', transform: 'text.trim' };

		Object.defineProperty(options, transportFieldName('text.trim', 'collapse'), {
			enumerable: true,
			configurable: true,
			get() {
				invoked = true;
				return true;
			},
		});

		expect(() => run(options)).toThrow(/own enumerable/);
		expect(invoked).toBe(false);
	});

	it('never echoes an untrusted option field name or transform id in the error', () => {
		const canary = 'customer@example.com';
		const fieldError = caught(() => run({ mode: 'value', value: 'x', transform: 'text.trim', [canary]: 1 }));
		expect(fieldError.code).toBe('UNKNOWN_OPTION');
		expect(fieldError.message).not.toContain(canary);
		expect(JSON.stringify(fieldError.location)).not.toContain(canary);

		const idCanary = 'secret.transform';
		const idError = caught(() => run({ mode: 'value', value: 'x', transform: idCanary }));
		expect(idError.code).toBe('UNKNOWN_TRANSFORM');
		expect(idError.message).not.toContain(idCanary);
		expect(JSON.stringify(idError.location)).not.toContain(idCanary);
	});

	it('clones an object result so it cannot alias or be mutated through the transform', () => {
		const retained = { nested: { v: 1 } };
		registerTransform({ id: 'test.retained', category: 'test', optionKeys: [], prepare: () => () => retained });

		const result = run({ mode: 'value', value: 'x', transform: 'test.retained' });

		expect(result).toEqual({ nested: { v: 1 } });
		expect(result).not.toBe(retained);
		expect((result as { nested: unknown }).nested).not.toBe(retained.nested);

		retained.nested.v = 999;
		expect((result as { nested: { v: number } }).nested.v).toBe(1);
	});

	it('returns an object result whose keys are named value, payload, and changed without flattening', () => {
		registerTransform({
			id: 'test.envelopeish',
			category: 'test',
			optionKeys: [],
			prepare: () => () => ({ value: 'v', payload: 'p', changed: 'c' }),
		});

		expect(run({ mode: 'value', value: 'x', transform: 'test.envelopeish' })).toEqual({
			value: 'v',
			payload: 'p',
			changed: 'c',
		});
	});

	it('returns the phone.validate diagnostic object directly in value mode', () => {
		expect(run({ mode: 'value', value: '623-234-9012', transform: 'phone.validate', [region]: 'US' })).toEqual({
			value: '+16232349012',
			extension: null,
			valid: true,
			possible: true,
		});
	});

	it('applies config-first precedence: a bad option fails before the input is applied', () => {
		expect(() =>
			run({ mode: 'value', value: 'not a number', transform: 'number.round', [scale]: 2, [roundingMode]: 'bogus' })
		).toThrow(/mode/);
	});

	it('reports an invalid transform option before an invalid empty-handling configuration', () => {
		expect(() =>
			run({
				mode: 'value',
				value: '',
				transform: 'number.round',
				[scale]: 2,
				[roundingMode]: 'bogus',
				onEmpty: 'replace',
			})
		).toThrow(/"mode" must be/);

		expect(() =>
			run({ mode: 'value', value: '', transform: 'phone.validate', [region]: 'not a region', onEmpty: 'replace' })
		).toThrow(/"region" must be/);
	});

	it('bounds the configuration graph before prepare runs', () => {
		const table = Array.from({ length: 7000 }, (_, index) => ({ key: `k${index}`, value: 'v' }));

		expect(() =>
			run({
				mode: 'value',
				value: 'k0',
				transform: 'lookup.table',
				[transportFieldName('lookup.table', 'table')]: table,
			})
		).toThrow(/too many nodes/);
	});
});

describe('empty-input handling', () => {
	const phoneRegion = transportFieldName('phone.format', 'region');

	it('skips an empty input by default, leaving it unchanged', () => {
		expect(run({ mode: 'value', value: '', transform: 'text.trim' })).toBe('');
		expect(run({ mode: 'value', value: null, transform: 'text.trim' })).toBeNull();
		expect(run({ mode: 'value', value: '  hi  ', transform: 'text.trim' })).toBe('hi');
		expect(run({ mode: 'value', value: '', transform: 'text.trim', onEmpty: 'skip' })).toBe('');
	});

	it('skips an empty input for a strict transform instead of erroring', () => {
		const phone = { mode: 'value', transform: 'phone.format', [phoneRegion]: 'US' };
		expect(run({ ...phone, value: '' })).toBe('');
		expect(run({ ...phone, value: null })).toBeNull();
		expect(run({ ...phone, value: '2015550123' })).toBe('+12015550123');
	});

	it('formats the literal string "undefined" that a missing expression renders, rather than skipping it as empty', () => {
		const error = caught(() =>
			run({ mode: 'value', transform: 'phone.format', [phoneRegion]: 'US', value: 'undefined' })
		);

		expect(error.code).toBe('INVALID_INPUT');
		expect(error.message).toMatch(/not a valid phone number/);
	});

	it('fails the operation on an empty input when onEmpty is fail', () => {
		const fail = { mode: 'value', transform: 'text.trim', onEmpty: 'fail' };
		const error = caught(() => run({ ...fail, value: '' }));
		expect(error.code).toBe('INVALID_INPUT');
		expect(error.message).toMatch(/empty/);
		expect(caught(() => run({ ...fail, value: null })).code).toBe('INVALID_INPUT');
		expect(run({ ...fail, value: '  hi  ' })).toBe('hi');
	});

	it('replaces an empty input only when onEmpty is replace', () => {
		const replace = { mode: 'value', transform: 'text.trim', onEmpty: 'replace', whenEmpty: 'N/A' };
		expect(run({ ...replace, value: '' })).toBe('N/A');
		expect(run({ ...replace, value: null })).toBe('N/A');
		expect(run({ ...replace, value: '  hi  ' })).toBe('hi');
	});

	it('accepts a replacement value one below and at the setting length limit and refuses one more character', () => {
		const limit = BOUNDS.maxOptionStringLength;

		const replace = (length: number) => ({
			mode: 'value',
			value: '',
			transform: 'text.trim',
			onEmpty: 'replace',
			whenEmpty: 'r'.repeat(length),
		});

		expect(run(replace(limit - 1))).toBe('r'.repeat(limit - 1));
		expect(run(replace(limit))).toBe('r'.repeat(limit));

		const error = caught(() => run(replace(limit + 1)));
		expect(error.code).toBe('BOUND_EXCEEDED');
		expect(error.message).toMatch(/option "whenEmpty" string is too long/);
	});

	it('sets an empty input to null when onEmpty is set-null, ignoring any replacement value', () => {
		const setNull = { mode: 'value', transform: 'text.trim', onEmpty: 'set-null' };
		expect(run({ ...setNull, value: '' })).toBeNull();
		expect(run({ ...setNull, value: null })).toBeNull();
		expect(run({ ...setNull, value: 'x', whenEmpty: 'stale' })).toBe('x');
		expect(run({ ...setNull, value: '', whenEmpty: 'stale' })).toBeNull();
	});

	it('treats replace without a replacement value as a configuration error, never as a silent null', () => {
		const cleared = { mode: 'value', value: '', transform: 'text.trim', onEmpty: 'replace' };
		const error = caught(() => run({ ...cleared, whenEmpty: null }));
		expect(error.code).toBe('INVALID_OPTION');
		expect(error.message).toMatch(/replacement value/);
		expect(caught(() => run(cleared)).code).toBe('INVALID_OPTION');
	});

	it('ignores a stale replacement value when onEmpty is skip or unset', () => {
		expect(run({ mode: 'value', value: '', transform: 'text.trim', onEmpty: 'skip', whenEmpty: 'stale' })).toBe('');
		expect(run({ mode: 'value', value: '', transform: 'text.trim', onEmpty: null, whenEmpty: 'stale' })).toBe('');
	});

	it('rejects the removed format value and any unknown onEmpty, for every transform', () => {
		expect(caught(() => run({ mode: 'value', value: '', transform: 'text.trim', onEmpty: 'format' })).code).toBe(
			'INVALID_OPTION'
		);

		expect(caught(() => run({ mode: 'value', value: '', transform: 'text.trim', onEmpty: 'bogus' })).code).toBe(
			'INVALID_OPTION'
		);

		expect(
			caught(() => run({ mode: 'value', value: '1', transform: 'phone.validate', [region]: 'US', onEmpty: 'format' }))
				.code
		).toBe('INVALID_OPTION');
	});

	it('runs an input-handling transform on empty and ignores any recognized empty-handling selection', () => {
		const validate = { mode: 'value', transform: 'phone.validate', [region]: 'US' };

		expect(run({ ...validate, value: '', onEmpty: 'replace', whenEmpty: 'x' })).toEqual({
			value: null,
			extension: null,
			valid: false,
			possible: false,
		});

		expect(run({ ...validate, value: '', onEmpty: 'set-null' })).toMatchObject({ valid: false });
		expect(caught(() => run({ ...validate, value: null })).code).toBe('INVALID_INPUT');
	});
});

describe('optional options cleared to null', () => {
	it('number.format: fraction digits set, then cleared, execute as if omitted', () => {
		const locale = transportFieldName('number.format', 'locale');
		const minimum = transportFieldName('number.format', 'minimumFractionDigits');
		const maximum = transportFieldName('number.format', 'maximumFractionDigits');
		const base = { mode: 'value', value: 1.5, transform: 'number.format', [locale]: 'en-US' };

		expect(run({ ...base, [minimum]: 3 })).toBe('1.500');
		expect(run({ ...base, [minimum]: null })).toBe('1.5');
		expect(run({ ...base, [maximum]: null })).toBe('1.5');
	});

	it('date.parse: an output stored on date-only input is ignored rather than rejected', () => {
		const inputKind = transportFieldName('date.parse', 'inputKind');
		const output = transportFieldName('date.parse', 'output');
		const base = { mode: 'value', value: '2024-01-05', transform: 'date.parse', [inputKind]: 'date' };

		expect(run({ ...base, [output]: 'iso' })).toBe('2024-01-05');
		expect(run({ ...base, [output]: null })).toBe('2024-01-05');
	});

	it('date.format: a stored time zone on date-only input is ignored rather than rejected', () => {
		const inputKind = transportFieldName('date.format', 'inputKind');
		const locale = transportFieldName('date.format', 'locale');
		const timeZone = transportFieldName('date.format', 'timeZone');
		const dateStyle = transportFieldName('date.format', 'dateStyle');
		const hourCycle = transportFieldName('date.format', 'hourCycle');

		const base = {
			mode: 'value',
			value: '2024-01-05',
			transform: 'date.format',
			[inputKind]: 'date',
			[locale]: 'en-US',
		};

		expect(run({ ...base, [dateStyle]: 'long' })).toBe('January 5, 2024');
		expect(run({ ...base, [dateStyle]: 'long', [timeZone]: 'UTC' })).toBe('January 5, 2024');
		expect(run({ ...base, [timeZone]: null, [dateStyle]: null, [hourCycle]: null })).toBe('1/5/2024');
	});

	it('date.now: formatting options stored without a locale are ignored and still yield the ISO instant', () => {
		const dateStyle = transportFieldName('date.now', 'dateStyle');
		const hourCycle = transportFieldName('date.now', 'hourCycle');
		const timeZone = transportFieldName('date.now', 'timeZone');

		expect(run({ mode: 'value', transform: 'date.now', [dateStyle]: 'short' })).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
		);

		expect(
			run({ mode: 'value', transform: 'date.now', [dateStyle]: null, [hourCycle]: null, [timeZone]: null })
		).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
	});

	it('lookup.table: a cleared fallback means no fallback', () => {
		const table = transportFieldName('lookup.table', 'table');
		const fallback = transportFieldName('lookup.table', 'fallback');
		const base = { mode: 'value', transform: 'lookup.table', [table]: [{ key: 'a', value: 'A' }] };

		expect(run({ ...base, value: 'zzz', [fallback]: 'none' })).toBe('none');
		expect(run({ ...base, value: 'a', [fallback]: null })).toBe('A');
		expect(caught(() => run({ ...base, value: 'zzz', [fallback]: null })).code).toBe('INVALID_INPUT');
	});
});

describe('locale.plural flat-slot transport', () => {
	const locale = transportFieldName('locale.plural', 'locale');
	const one = transportFieldName('locale.plural', 'one');
	const other = transportFieldName('locale.plural', 'other');

	it('assembles the forms from flat slot fields and selects by count', () => {
		const base = { mode: 'value', transform: 'locale.plural', [locale]: 'en', [one]: 'item', [other]: 'items' };

		expect(run({ ...base, value: 1 })).toBe('item');
		expect(run({ ...base, value: 2 })).toBe('items');
		expect(run({ ...base, value: 5 })).toBe('items');
	});

	it('omits a blank slot so an empty value never overrides a real form', () => {
		expect(
			run({ mode: 'value', value: 1, transform: 'locale.plural', [locale]: 'en', [one]: '', [other]: 'items' })
		).toBe('items');
	});

	it('rejects an unknown plural category field at the parser boundary with UNKNOWN_OPTION', () => {
		const error = caught(() =>
			run({
				mode: 'value',
				value: 1,
				transform: 'locale.plural',
				[locale]: 'en',
				[other]: 'items',
				locale_plural__othre: 'typo',
			})
		);

		expect(error.code).toBe('UNKNOWN_OPTION');
	});

	it('rejects an accessor-backed slot at the parser boundary without invoking its getter', () => {
		let invoked = false;

		const options: Record<string, unknown> = {
			mode: 'value',
			value: 1,
			transform: 'locale.plural',
			[locale]: 'en',
			[other]: 'items',
		};

		Object.defineProperty(options, one, {
			enumerable: true,
			configurable: true,
			get() {
				invoked = true;
				return 'item';
			},
		});

		expect(() => run(options)).toThrow(/own enumerable/);
		expect(invoked).toBe(false);
	});
});
