import Big from 'big.js';
import { describe, expect, it } from 'vitest';
import { BOUNDS } from '../src/lib/bounds.js';
import { FormatterError } from '../src/lib/errors.js';
import type { IcuCapabilities } from '../src/lib/icu.js';
import { registerBuiltins } from '../src/lib/index.js';
import { getTransform, type TransformContext } from '../src/lib/registry.js';

registerBuiltins();

const full: IcuCapabilities = { normalize: true, casing: true, formatting: true };
const none: IcuCapabilities = { normalize: false, casing: false, formatting: false };

function run(id: string, value: unknown, options: Record<string, unknown> = {}, icu: IcuCapabilities = full): unknown {
	const def = getTransform(id);
	if (!def) throw new Error(`no transform ${id}`);
	const ctx: TransformContext = { icu };
	return def.prepare(options, ctx)(value);
}

function codeOf(fn: () => unknown): string {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(FormatterError);
		return (error as FormatterError).code;
	}

	throw new Error('expected a rejection');
}

describe('phone.format', () => {
	it('canonicalizes to E.164 by default and to other formats on request', () => {
		expect(run('phone.format', '623-234-9012', { region: 'US' })).toBe('+16232349012');
		expect(run('phone.format', '623-234-9012', { region: 'US', format: 'national' })).toBe('(623) 234-9012');
		expect(run('phone.format', '+16232349012', { region: 'US', format: 'international' })).toBe('+1 623 234 9012');
		expect(run('phone.format', '623-234-9012', { region: 'US', format: 'rfc3966' })).toBe('tel:+16232349012');
	});

	it('is idempotent for the E.164 canonical form', () => {
		const once = run('phone.format', '(623) 234-9012', { region: 'US' }) as string;
		expect(run('phone.format', once, { region: 'US' })).toBe(once);
	});

	it('rejects an invalid number and a bad region loudly', () => {
		expect(() => run('phone.format', '123', { region: 'US' })).toThrow(/not a valid phone number/);
		expect(() => run('phone.format', '623-234-9012', { region: 'usa' })).toThrow(/two-letter ISO/);
	});

	it('rejects a well-formed but unsupported region as invalid configuration', () => {
		expect(() => run('phone.format', '623-234-9012', { region: 'ZZ' })).toThrow(FormatterError);
		expect(() => run('phone.format', '623-234-9012', { region: 'ZZ' })).toThrow(/region/);
	});

	it('rejects a lowercase region rather than normalizing it', () => {
		expect(codeOf(() => run('phone.format', '2015550123', { region: 'us' }))).toBe('INVALID_OPTION');
	});

	it('refuses E.164 for a number with an extension instead of dropping the extension', () => {
		expect(codeOf(() => run('phone.format', '2015550123 ext. 42', { region: 'US' }))).toBe('INVALID_INPUT');

		expect(codeOf(() => run('phone.format', '2015550123 ext. 42', { region: 'US', format: 'e164' }))).toBe(
			'INVALID_INPUT'
		);

		expect(() => run('phone.format', '2015550123 ext. 42', { region: 'US' })).toThrow(
			/extension that E\.164 cannot represent/
		);
	});

	it('keeps the extension in the RFC 3966, national, and international formats', () => {
		const input = '2015550123 ext. 42';
		expect(run('phone.format', input, { region: 'US', format: 'rfc3966' })).toBe('tel:+12015550123;ext=42');
		expect(run('phone.format', input, { region: 'US', format: 'national' })).toBe('(201) 555-0123 ext. 42');
		expect(run('phone.format', input, { region: 'US', format: 'international' })).toBe('+1 201 555 0123 ext. 42');
	});

	it('is idempotent for RFC 3966 output that carries an extension', () => {
		const once = run('phone.format', '2015550123 x42', { region: 'US', format: 'rfc3966' }) as string;
		expect(once).toBe('tel:+12015550123;ext=42');
		expect(run('phone.format', once, { region: 'US', format: 'rfc3966' })).toBe(once);
	});

	it('extracts a single number from surrounding text and rejects a two-number example', () => {
		expect(run('phone.format', 'Call 2015550123 now', { region: 'US' })).toBe('+12015550123');
		expect(codeOf(() => run('phone.format', '2015550123 or 2025550123', { region: 'US' }))).toBe('INVALID_INPUT');
	});
});

describe('phone.validate', () => {
	it('returns the judgment without throwing for expected inputs', () => {
		expect(run('phone.validate', '623-234-9012', { region: 'US' })).toEqual({
			value: '+16232349012',
			extension: null,
			valid: true,
			possible: true,
		});

		expect(run('phone.validate', '1', { region: 'US' })).toEqual({
			value: null,
			extension: null,
			valid: false,
			possible: false,
		});
	});

	it('reports an extension separately from the canonical main number', () => {
		expect(run('phone.validate', '2015550123 ext. 42', { region: 'US' })).toEqual({
			value: '+12015550123',
			extension: '42',
			valid: true,
			possible: true,
		});
	});

	it('judges single-number text valid and a two-number example invalid', () => {
		expect(run('phone.validate', 'Call 2015550123 now', { region: 'US' })).toEqual({
			value: '+12015550123',
			extension: null,
			valid: true,
			possible: true,
		});

		expect(run('phone.validate', '2015550123 or 2025550123', { region: 'US' })).toEqual({
			value: null,
			extension: null,
			valid: false,
			possible: false,
		});
	});

	it('reports an unsupported region as invalid configuration, not an invalid phone', () => {
		expect(() => run('phone.validate', '623-234-9012', { region: 'AA' })).toThrow(/region/);
	});

	it('rejects a lowercase region rather than normalizing it', () => {
		expect(codeOf(() => run('phone.validate', '2015550123', { region: 'us' }))).toBe('INVALID_OPTION');
	});
});

describe('number.round', () => {
	it('rounds by exact decimal with a fixed scale and trailing zeros', () => {
		expect(run('number.round', 1.005, { scale: 2 })).toBe('1.01');
		expect(run('number.round', 1.2, { scale: 2 })).toBe('1.20');
		expect(run('number.round', '1.005', { scale: 2, mode: 'toward-zero' })).toBe('1.00');
	});

	it('honors every rounding mode', () => {
		expect(run('number.round', 2.5, { scale: 0, mode: 'half-even' })).toBe('2');
		expect(run('number.round', 3.5, { scale: 0, mode: 'half-even' })).toBe('4');
		expect(run('number.round', -1.5, { scale: 0, mode: 'away-from-zero' })).toBe('-2');
	});

	it('is idempotent and can output a number', () => {
		const once = run('number.round', 1.005, { scale: 2 }) as string;
		expect(run('number.round', once, { scale: 2 })).toBe(once);
		expect(run('number.round', 1.5, { scale: 0, output: 'number' })).toBe(2);
	});

	it('rejects a non-numeric input and an over-long number', () => {
		expect(() => run('number.round', 'abc', { scale: 2 })).toThrow(FormatterError);
		expect(() => run('number.round', '1'.repeat(101), { scale: 2 })).toThrow(/too many digits/);
	});

	it('rejects an oversized exponent before constructing Big', () => {
		expect(() => run('number.round', '1e9999', { scale: 0 })).toThrow(/exponent is too large/);
	});

	it('leaves big.js global precision and rounding state untouched across modes', () => {
		const decimalPlaces = Big.DP;
		const roundingMode = Big.RM;
		run('number.round', 2.5, { scale: 0, mode: 'half-even' });
		run('number.round', 2.5, { scale: 0, mode: 'half-up' });
		run('number.round', '12.3456', { scale: 3, mode: 'away-from-zero' });
		expect(Big.DP).toBe(decimalPlaces);
		expect(Big.RM).toBe(roundingMode);
	});

	it('rounds a number one below and at the digit limit exactly', () => {
		const limit = BOUNDS.maxNumberDigits;
		const integerDigits = (digits: number): string => '9'.repeat(digits - 3);

		expect(run('number.round', `${integerDigits(limit - 1)}.125`, { scale: 2 })).toBe(`${integerDigits(limit - 1)}.13`);
		expect(run('number.round', `${integerDigits(limit)}.125`, { scale: 2 })).toBe(`${integerDigits(limit)}.13`);
	});

	it('accepts an exponent one below and at the exponent limit in both directions and refuses one more', () => {
		const limit = BOUNDS.maxExponentMagnitude;

		expect(run('number.round', `1e${limit - 1}`, { scale: 0 })).toBe(`1${'0'.repeat(limit - 1)}`);
		expect(run('number.round', `1e${limit}`, { scale: 0 })).toBe(`1${'0'.repeat(limit)}`);
		expect(run('number.round', `1e-${limit - 1}`, { scale: 0 })).toBe('0');
		expect(run('number.round', `1e-${limit}`, { scale: 0 })).toBe('0');

		for (const over of [`1e${limit + 1}`, `1e-${limit + 1}`]) {
			expect(
				codeOf(() => run('number.round', over, { scale: 0 })),
				over
			).toBe('BOUND_EXCEEDED');

			expect(() => run('number.round', over, { scale: 0 }), over).toThrow(/number exponent is too large/);
		}
	});

	it('refuses a number written as text by its character limit even when it holds a single digit', () => {
		const limit = BOUNDS.maxOptionStringLength;
		const spaced = (length: number): string => `${' '.repeat(length - 1)}1`;

		for (const length of [limit - 1, limit]) {
			expect(
				codeOf(() => run('number.round', spaced(length), { scale: 0 })),
				String(length)
			).toBe('INVALID_INPUT');

			expect(() => run('number.round', spaced(length), { scale: 0 }), String(length)).toThrow(
				/not a valid decimal number/
			);
		}

		expect(codeOf(() => run('number.round', spaced(limit + 1), { scale: 0 }))).toBe('BOUND_EXCEEDED');
		expect(() => run('number.round', spaced(limit + 1), { scale: 0 })).toThrow(/number has too many digits/);
	});
});

describe('number.format', () => {
	it('formats decimals, currency, units, and compact notation by locale', () => {
		expect(run('number.format', 1234.56, { locale: 'de-DE' })).toBe('1.234,56');
		expect(run('number.format', 1234.56, { locale: 'de-DE', style: 'currency', currency: 'EUR' })).toBe('1.234,56 €');

		expect(run('number.format', 1234.56, { locale: 'en-US', style: 'unit', unit: 'kilometer-per-hour' })).toBe(
			'1,234.56 km/h'
		);

		expect(run('number.format', 1234, { locale: 'en-US', notation: 'compact' })).toBe('1.2K');
	});

	it('requires an explicit percent input scale', () => {
		expect(run('number.format', 0.12, { locale: 'en-US', style: 'percent', percentScale: 'fraction' })).toBe('12%');
		expect(run('number.format', 12, { locale: 'en-US', style: 'percent', percentScale: 'points' })).toBe('12%');
		expect(() => run('number.format', 12, { locale: 'en-US', style: 'percent' })).toThrow(/percentScale/);
	});

	it('is refused when the full-ICU capability is absent', () => {
		expect(() => run('number.format', 1, { locale: 'de-DE' }, none)).toThrow(/full ICU/);
	});

	it('formats for locales the runtime canonicalizes or falls back from', () => {
		expect(run('number.format', 1234.5, { locale: 'iw-IL' })).toBe('1,234.5');
		expect(run('number.format', 1234.5, { locale: 'en-Latn-US' })).toBe('1,234.5');
	});

	it('accepts a numeric input string one below and at the character limit and refuses one more character', () => {
		const limit = BOUNDS.maxOptionStringLength;

		expect(() => run('number.format', '1'.repeat(limit - 1), { locale: 'en-US' })).not.toThrow();
		expect(() => run('number.format', '1'.repeat(limit), { locale: 'en-US' })).not.toThrow();

		expect(codeOf(() => run('number.format', '1'.repeat(limit + 1), { locale: 'en-US' }))).toBe('BOUND_EXCEEDED');

		expect(() => run('number.format', '1'.repeat(limit + 1), { locale: 'en-US' })).toThrow(
			/numeric input string is too long/
		);
	});

	it('validates a currency code up to the setting length limit and refuses one more character by the limit', () => {
		const limit = BOUNDS.maxOptionStringLength;

		const currency = (length: number): Record<string, unknown> => ({
			locale: 'en-US',
			style: 'currency',
			currency: 'A'.repeat(length),
		});

		for (const length of [limit - 1, limit]) {
			expect(
				codeOf(() => run('number.format', 1, currency(length))),
				String(length)
			).toBe('INVALID_OPTION');

			expect(() => run('number.format', 1, currency(length)), String(length)).toThrow(
				/the number formatting options are invalid/
			);
		}

		expect(codeOf(() => run('number.format', 1, currency(limit + 1)))).toBe('BOUND_EXCEEDED');
		expect(() => run('number.format', 1, currency(limit + 1))).toThrow(/option "currency" is too long/);
	});
});

describe('lookup.table', () => {
	const rows = [
		{ key: 'delivery', value: 'Shipped' },
		{ key: 'pickup', value: 'Picked up' },
	];

	it('maps a key to its value, case-sensitively by default', () => {
		expect(run('lookup.table', 'delivery', { table: rows })).toBe('Shipped');
		expect(() => run('lookup.table', 'DELIVERY', { table: rows })).toThrow(/no lookup match/);
		expect(run('lookup.table', 'DELIVERY', { table: rows, caseSensitive: false })).toBe('Shipped');
	});

	it('returns the fallback when provided and no key matches', () => {
		expect(run('lookup.table', 'unknown', { table: rows, fallback: 'Unknown' })).toBe('Unknown');
	});

	it('rejects a malformed table', () => {
		expect(() => run('lookup.table', 'x', { table: 'nope' })).toThrow(/must be an array/);
	});

	it('rejects a table with too many rows', () => {
		const many = Array.from({ length: 1001 }, (_, index) => ({ key: `k${index}`, value: 'v' }));
		expect(() => run('lookup.table', 'k0', { table: many })).toThrow(/too many rows/);
	});

	it('accepts a table exactly at the aggregate code-unit limit', () => {
		const value = 'v'.repeat(BOUNDS.maxLookupAggregateLength - 1);
		expect(run('lookup.table', 'k', { table: [{ key: 'k', value }] })).toBe(value);
	});

	it('rejects a table one code unit over the aggregate limit', () => {
		const value = 'v'.repeat(BOUNDS.maxLookupAggregateLength);
		expect(() => run('lookup.table', 'k', { table: [{ key: 'k', value }] })).toThrow(/too large/);
	});

	it('bounds by code-unit length, so multibyte content under the limit is accepted', () => {
		const value = 'ü'.repeat(BOUNDS.maxLookupAggregateLength - 1);
		expect(run('lookup.table', 'k', { table: [{ key: 'k', value }] })).toBe(value);
	});

	it('accepts a table one code unit under the aggregate limit', () => {
		const value = 'v'.repeat(BOUNDS.maxLookupAggregateLength - 2);
		expect(run('lookup.table', 'k', { table: [{ key: 'k', value }] })).toBe(value);
	});

	it('accepts a table one row below and at the row limit', () => {
		const table = (rows: number): Array<{ key: string; value: string }> =>
			Array.from({ length: rows }, (_, index) => ({ key: `k${index}`, value: 'v' }));

		expect(run('lookup.table', 'k0', { table: table(BOUNDS.maxLookupRows - 1) })).toBe('v');
		expect(run('lookup.table', 'k0', { table: table(BOUNDS.maxLookupRows) })).toBe('v');
	});

	it('rejects a matched row that has no value', () => {
		expect(() => run('lookup.table', 'k', { table: [{ key: 'k' }] })).toThrow(/"value"/);
	});

	it('validates every row, not only up to the first match', () => {
		const table = [{ key: 'first', value: 'ok' }, { key: 'second' }];
		expect(() => run('lookup.table', 'first', { table })).toThrow(/"value"/);
	});

	it('rejects a revoked proxy row as a typed error, not a raw TypeError', () => {
		const { proxy, revoke } = Proxy.revocable({ key: 'k', value: 'v' }, {});
		revoke();
		expect(() => run('lookup.table', 'k', { table: [proxy] })).toThrow(FormatterError);
	});

	it('rejects an accessor "value" without invoking its getter', () => {
		let invoked = false;
		const row: Record<string, unknown> = { key: 'k' };

		Object.defineProperty(row, 'value', {
			enumerable: true,
			configurable: true,
			get() {
				invoked = true;
				return 'boom';
			},
		});

		expect(() => run('lookup.table', 'k', { table: [row] })).toThrow(/"value"/);
		expect(invoked).toBe(false);
	});

	it('rejects a revoked proxy table as a typed error, not a raw TypeError', () => {
		const { proxy, revoke } = Proxy.revocable([{ key: 'a', value: 'A' }], {});
		revoke();
		expect(() => run('lookup.table', 'a', { table: proxy })).toThrow(FormatterError);
	});

	it('rejects a table with an accessor row and never invokes its getter', () => {
		let invoked = false;
		const rows: unknown[] = [{ key: 'a', value: 'A' }];

		Object.defineProperty(rows, 1, {
			enumerable: true,
			configurable: true,
			get() {
				invoked = true;
				return { key: 'b', value: 'B' };
			},
		});

		expect(() => run('lookup.table', 'a', { table: rows })).toThrow(FormatterError);
		expect(invoked).toBe(false);
	});

	it('rejects a table carrying a symbol key', () => {
		const rows: unknown[] = [{ key: 'a', value: 'A' }];
		(rows as unknown as Record<symbol, unknown>)[Symbol('extra')] = { key: 'b', value: 'B' };
		expect(() => run('lookup.table', 'a', { table: rows })).toThrow(/must be an array/);
	});

	it('rejects a table carrying a non-index property', () => {
		const rows: unknown[] = [{ key: 'a', value: 'A' }];
		(rows as unknown as Record<string, unknown>)['extra'] = { key: 'b', value: 'B' };
		expect(() => run('lookup.table', 'a', { table: rows })).toThrow(/must be an array/);
	});

	it('rejects the non-index property 4294967295, which is past the maximum array index', () => {
		const rows: unknown[] = [{ key: 'a', value: 'A' }];

		Object.defineProperty(rows, '4294967295', {
			value: { key: 'b', value: 'B' },
			enumerable: true,
			configurable: true,
			writable: true,
		});

		expect(() => run('lookup.table', 'a', { table: rows })).toThrow(/must be an array/);
	});

	it('rejects a non-enumerable row rather than silently skipping it', () => {
		const rows: unknown[] = [{ key: 'a', value: 'A' }, null];

		Object.defineProperty(rows, 1, {
			value: { key: 'b', value: 'B' },
			enumerable: false,
			configurable: true,
			writable: true,
		});

		expect(() => run('lookup.table', 'a', { table: rows })).toThrow(FormatterError);
	});
});
