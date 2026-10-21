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

const NARROW_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x2009, 0x202f)}]`, 'g');
const normalizeSpaces = (input: unknown): string => String(input).replace(NARROW_SPACES, ' ');
const EN_DASH = String.fromCharCode(0x2013);

function codeOf(fn: () => unknown): string {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(FormatterError);
		return (error as FormatterError).code;
	}

	throw new Error('expected a rejection');
}

describe('date.format', () => {
	it('formats an instant into an explicit output timezone', () => {
		expect(
			normalizeSpaces(
				run('date.format', '2024-01-15T17:30:00Z', {
					inputKind: 'instant',
					locale: 'en-US',
					dateStyle: 'long',
					timeStyle: 'short',
					timeZone: 'America/New_York',
				})
			)
		).toBe('January 15, 2024 at 12:30 PM');
	});

	it('formats a date-only value without shifting it through a timezone', () => {
		expect(run('date.format', '2024-01-05', { inputKind: 'date', locale: 'de-DE', dateStyle: 'long' })).toBe(
			'5. Januar 2024'
		);
	});

	it('formats a Spanish month name for a Spanish locale', () => {
		expect(run('date.format', '2024-01-05', { inputKind: 'date', locale: 'es', dateStyle: 'long' })).toBe(
			'5 de enero de 2024'
		);
	});

	it('renders a date-only value as that calendar date under a non-UTC process timezone', () => {
		expect(new Date('2024-01-05T00:00:00Z').getHours()).toBe(19);

		expect(run('date.format', '2024-01-05', { inputKind: 'date', locale: 'en-US', dateStyle: 'full' })).toBe(
			'Friday, January 5, 2024'
		);
	});

	it('requires an output timezone for an instant', () => {
		expect(() => run('date.format', '2024-01-15T17:30:00Z', { inputKind: 'instant', locale: 'en-US' })).toThrow(
			/timeZone/
		);
	});

	it('ignores a timezone stored on a date-only value rather than rejecting it', () => {
		expect(
			run('date.format', '2024-01-05', { inputKind: 'date', locale: 'en-US', dateStyle: 'long', timeZone: 'UTC' })
		).toBe('January 5, 2024');
	});

	it('rejects a local date-time that carries no offset', () => {
		expect(() =>
			run('date.format', '2024-01-15T12:00:00', { inputKind: 'instant', locale: 'en-US', timeZone: 'UTC' })
		).toThrow(/Z or an explicit offset/);
	});

	it('is refused when the full-ICU capability is absent', () => {
		expect(() => run('date.format', '2024-01-05', { inputKind: 'date', locale: 'en-US' }, none)).toThrow(/full ICU/);
	});
});

describe('date.format format style', () => {
	const instant = '2024-01-15T17:30:00Z';
	const base = { inputKind: 'instant', locale: 'en-US', timeZone: 'UTC' };

	it('uses only the preset group and ignores stored component fields, so a group switch never throws the mix', () => {
		expect(
			run('date.format', instant, {
				...base,
				formatStyle: 'preset',
				dateStyle: 'long',
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			})
		).toBe('January 15, 2024');
	});

	it('uses only the component group and ignores a stored preset, so a group switch never throws the mix', () => {
		expect(
			run('date.format', instant, {
				...base,
				formatStyle: 'components',
				dateStyle: 'long',
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			})
		).toBe('Jan 15, 2024');
	});

	it('defaults to the preset group when no format style is stored', () => {
		expect(run('date.format', instant, { ...base, dateStyle: 'long' })).toBe('January 15, 2024');
	});

	it('strips time controls on date-only input rather than fabricating a time', () => {
		expect(
			run('date.format', '2024-01-05', {
				inputKind: 'date',
				locale: 'en-US',
				formatStyle: 'components',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				hour: 'numeric',
				minute: 'numeric',
			})
		).toBe('January 5, 2024');

		expect(
			run('date.format', '2024-01-05', {
				inputKind: 'date',
				locale: 'en-US',
				formatStyle: 'preset',
				dateStyle: 'long',
				timeStyle: 'short',
			})
		).toBe('January 5, 2024');
	});

	it('rejects an invalid active format style', () => {
		expect(() => run('date.format', instant, { ...base, formatStyle: 'bogus' })).toThrow(/"formatStyle" must be/);
	});
});

describe('date.parse', () => {
	it('canonicalizes an instant to a UTC ISO string', () => {
		expect(run('date.parse', '2024-03-10T12:00:00.5Z', { inputKind: 'instant' })).toBe('2024-03-10T12:00:00.500Z');
		expect(run('date.parse', '2024-03-10T07:00:00-05:00', { inputKind: 'instant' })).toBe('2024-03-10T12:00:00.000Z');
	});

	it('canonicalizes a date-only value to YYYY-MM-DD', () => {
		expect(run('date.parse', '2024-01-05', { inputKind: 'date' })).toBe('2024-01-05');
	});

	it('parses an epoch value with an explicitly selected unit', () => {
		expect(run('date.parse', 1_700_000_000, { inputKind: 'epoch-seconds' })).toBe(
			new Date(1_700_000_000_000).toISOString()
		);
	});

	it('emits the selected output unit for an instant', () => {
		expect(run('date.parse', '2024-03-10T12:00:00Z', { inputKind: 'instant', output: 'epoch-milliseconds' })).toBe(
			new Date('2024-03-10T12:00:00Z').getTime()
		);

		expect(run('date.parse', '2024-03-10T12:00:00Z', { inputKind: 'instant', output: 'epoch-seconds' })).toBe(
			Math.floor(new Date('2024-03-10T12:00:00Z').getTime() / 1000)
		);
	});

	it('ignores an output selection stored on a date-only value rather than rejecting it', () => {
		expect(run('date.parse', '2024-01-05', { inputKind: 'date', output: 'iso' })).toBe('2024-01-05');
		expect(run('date.parse', '2024-01-05', { inputKind: 'date', output: 'epoch-seconds' })).toBe('2024-01-05');
	});

	it('rejects a non-integer epoch and an unparseable instant', () => {
		expect(() => run('date.parse', 1.5, { inputKind: 'epoch-seconds' })).toThrow(/integer/);
		expect(() => run('date.parse', 'not a date', { inputKind: 'instant' })).toThrow(FormatterError);
	});

	it('rejects impossible calendar dates instead of silently normalizing them', () => {
		expect(() => run('date.parse', '2024-02-30T12:00:00Z', { inputKind: 'instant' })).toThrow(/real date/);
		expect(() => run('date.parse', '2023-02-29T00:00:00Z', { inputKind: 'instant' })).toThrow(/real date/);
		expect(() => run('date.parse', '2024-04-31', { inputKind: 'date' })).toThrow(/real calendar date/);
		expect(() => run('date.parse', '2023-02-29', { inputKind: 'date' })).toThrow(/real calendar date/);
	});

	it('accepts a valid leap day in both forms', () => {
		expect(run('date.parse', '2024-02-29T12:00:00Z', { inputKind: 'instant' })).toBe('2024-02-29T12:00:00.000Z');
		expect(run('date.parse', '2024-02-29', { inputKind: 'date' })).toBe('2024-02-29');
	});

	it('accepts four-digit years in the range 0000 to 0099 without remapping them', () => {
		expect(run('date.parse', '0001-01-01', { inputKind: 'date' })).toBe('0001-01-01');
		expect(run('date.parse', '0099-12-31T23:59:59Z', { inputKind: 'instant' })).toBe('0099-12-31T23:59:59.000Z');
		expect(() => run('date.parse', '0001-02-30', { inputKind: 'date' })).toThrow(/real calendar date/);
	});

	it('places a sub-second pre-1970 instant in the correct negative epoch second', () => {
		expect(run('date.parse', '1969-12-31T23:59:59.999Z', { inputKind: 'instant', output: 'epoch-seconds' })).toBe(-1);
	});
});

describe('date.now', () => {
	it('returns a milliseconds-stripped ISO instant when no locale is given', () => {
		expect(run('date.now', null)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
	});

	it('formats the current instant when a locale and timezone are given', () => {
		const formatted = run('date.now', null, { locale: 'en-US', dateStyle: 'short', timeZone: 'UTC' });
		expect(typeof formatted).toBe('string');
		expect((formatted as string).length).toBeGreaterThan(0);
	});

	it('requires a timezone once a locale is given', () => {
		expect(() => run('date.now', null, { locale: 'en-US' })).toThrow(/timeZone/);
	});

	it('ignores formatting options stored when no locale is given', () => {
		expect(run('date.now', null, { timeZone: 'UTC' })).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
		expect(run('date.now', null, { dateStyle: 'short' })).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
	});
});

describe('date.relative', () => {
	it('formats a relative time with an explicit value and unit', () => {
		expect(run('date.relative', -1, { locale: 'en', unit: 'day', numeric: 'auto' })).toBe('yesterday');
		expect(run('date.relative', -1, { locale: 'en', unit: 'day', numeric: 'always' })).toBe('1 day ago');
		expect(run('date.relative', 3, { locale: 'de', unit: 'hour', numeric: 'always' })).toBe('in 3 Stunden');
	});

	it('rejects an unsupported unit', () => {
		expect(() => run('date.relative', 1, { locale: 'en', unit: 'fortnight' })).toThrow(/unit/);
	});

	it('is refused when the full-ICU capability is absent', () => {
		expect(() => run('date.relative', -1, { locale: 'en', unit: 'day' }, none)).toThrow(/full ICU/);
	});
});

describe('date.range', () => {
	it('formats a date-only interval', () => {
		expect(
			normalizeSpaces(
				run(
					'date.range',
					{ start: '2024-01-01', end: '2024-01-05' },
					{ inputKind: 'date', locale: 'en-US', dateStyle: 'medium' }
				)
			)
		).toBe(`Jan 1 ${EN_DASH} 5, 2024`);
	});

	it('rejects a range whose members mix input kinds', () => {
		expect(() =>
			run('date.range', { start: '2024-01-01', end: '2024-01-05T00:00:00Z' }, { inputKind: 'date', locale: 'en-US' })
		).toThrow(/YYYY-MM-DD/);
	});

	it('rejects a non-object input and a missing member', () => {
		expect(() => run('date.range', 'nope', { inputKind: 'date', locale: 'en-US' })).toThrow(/start, end/);
		expect(() => run('date.range', { start: '2024-01-01' }, { inputKind: 'date', locale: 'en-US' })).toThrow(/"end"/);
	});

	it('rejects a date-only range whose start is after its end as invalid input', () => {
		const reversed = () =>
			run(
				'date.range',
				{ start: '2024-01-08', end: '2024-01-05' },
				{ inputKind: 'date', locale: 'en-US', dateStyle: 'medium' }
			);

		expect(codeOf(reversed)).toBe('INVALID_INPUT');
		expect(reversed).toThrow(/range start is after its end/);
	});

	it('rejects reversed instant and epoch ranges as invalid input', () => {
		const timed = { locale: 'en-US', timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' };

		expect(
			codeOf(() =>
				run(
					'date.range',
					{ start: '2024-01-05T12:00:00Z', end: '2024-01-05T09:00:00Z' },
					{ ...timed, inputKind: 'instant' }
				)
			)
		).toBe('INVALID_INPUT');

		expect(
			codeOf(() => run('date.range', { start: 1704412800, end: 1704153600 }, { ...timed, inputKind: 'epoch-seconds' }))
		).toBe('INVALID_INPUT');
	});

	it('orders instants by the moment they name, not by their text', () => {
		expect(
			normalizeSpaces(
				run(
					'date.range',
					{ start: '2024-01-05T10:00:00+05:00', end: '2024-01-05T06:00:00Z' },
					{ inputKind: 'instant', locale: 'en-US', timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }
				)
			)
		).toBe(`Jan 5, 2024, 5:00 ${EN_DASH} 6:00 AM`);
	});

	it('formats a range whose start equals its end', () => {
		expect(
			normalizeSpaces(
				run(
					'date.range',
					{ start: '2024-01-05', end: '2024-01-05' },
					{ inputKind: 'date', locale: 'en-US', dateStyle: 'medium' }
				)
			)
		).toBe('Jan 5, 2024');
	});

	it('reports a malformed member before checking the order', () => {
		expect(() =>
			run(
				'date.range',
				{ start: '2024-02-30', end: '2024-01-05' },
				{ inputKind: 'date', locale: 'en-US', dateStyle: 'medium' }
			)
		).toThrow(/real calendar date/);
	});
});

describe('locale.list', () => {
	it('formats a conjunction and a disjunction by locale', () => {
		expect(run('locale.list', ['red', 'green', 'blue'], { locale: 'en', type: 'conjunction' })).toBe(
			'red, green, and blue'
		);

		expect(normalizeSpaces(run('locale.list', ['rojo', 'verde', 'azul'], { locale: 'es', type: 'disjunction' }))).toBe(
			'rojo, verde o azul'
		);
	});

	it('rejects a non-array input and a non-string item', () => {
		expect(() => run('locale.list', 'nope', { locale: 'en' })).toThrow(/array of strings/);
		expect(() => run('locale.list', [1], { locale: 'en' })).toThrow(/every list item must be a string/);
	});

	it('rejects a revoked proxy and never invokes an element getter', () => {
		const { proxy, revoke } = Proxy.revocable(['a', 'b'], {});
		revoke();
		expect(() => run('locale.list', proxy, { locale: 'en' })).toThrow(FormatterError);

		let invoked = false;
		const withGetter: unknown[] = ['a'];

		Object.defineProperty(withGetter, 1, {
			enumerable: true,
			configurable: true,
			get() {
				invoked = true;
				return 'b';
			},
		});

		expect(() => run('locale.list', withGetter, { locale: 'en' })).toThrow(/every list item must be a string/);
		expect(invoked).toBe(false);
	});

	it('is refused when the full-ICU capability is absent', () => {
		expect(() => run('locale.list', ['a', 'b'], { locale: 'en' }, none)).toThrow(/full ICU/);
	});

	it('rejects a list carrying a symbol key or a non-index property', () => {
		const withSymbol: unknown[] = ['a'];
		(withSymbol as unknown as Record<symbol, unknown>)[Symbol('extra')] = 'b';
		expect(() => run('locale.list', withSymbol, { locale: 'en' })).toThrow(/array of strings/);

		const withNamed: unknown[] = ['a'];
		(withNamed as unknown as Record<string, unknown>)['extra'] = 'b';
		expect(() => run('locale.list', withNamed, { locale: 'en' })).toThrow(/array of strings/);
	});

	it('rejects the non-index property 4294967295, which is past the maximum array index', () => {
		const items: unknown[] = ['a'];

		Object.defineProperty(items, '4294967295', {
			value: 'b',
			enumerable: true,
			configurable: true,
			writable: true,
		});

		expect(() => run('locale.list', items, { locale: 'en' })).toThrow(/array of strings/);
	});

	it('rejects a non-enumerable item rather than silently skipping it', () => {
		const items: unknown[] = ['a', 'placeholder'];

		Object.defineProperty(items, 1, {
			value: 'b',
			enumerable: false,
			configurable: true,
			writable: true,
		});

		expect(() => run('locale.list', items, { locale: 'en' })).toThrow(/every list item must be a string/);
	});

	it('accepts a list one below and at the item limit and refuses one more item', () => {
		const limit = BOUNDS.maxListItems;
		const list = (length: number): string[] => Array.from({ length }, () => 'x');

		expect(() => run('locale.list', list(limit - 1), { locale: 'en' })).not.toThrow();
		expect(() => run('locale.list', list(limit), { locale: 'en' })).not.toThrow();

		expect(codeOf(() => run('locale.list', list(limit + 1), { locale: 'en' }))).toBe('BOUND_EXCEEDED');
		expect(() => run('locale.list', list(limit + 1), { locale: 'en' })).toThrow(/the list has too many items/);
	});

	it('accepts list content one below and at the total length limit and refuses one more character', () => {
		const limit = BOUNDS.maxInputStringLength;
		const fullItems = Math.floor(limit / 1000) - 1;

		const list = (totalLength: number): string[] => [
			...Array.from({ length: fullItems }, () => 'x'.repeat(1000)),
			'x'.repeat(totalLength - fullItems * 1000),
		];

		expect(() => run('locale.list', list(limit - 1), { locale: 'en' })).not.toThrow();
		expect(() => run('locale.list', list(limit), { locale: 'en' })).not.toThrow();

		expect(codeOf(() => run('locale.list', list(limit + 1), { locale: 'en' }))).toBe('BOUND_EXCEEDED');
		expect(() => run('locale.list', list(limit + 1), { locale: 'en' })).toThrow(/the list content is too long/);
	});
});

describe('locale.display-name', () => {
	it('maps a code to its localized display name', () => {
		expect(run('locale.display-name', 'US', { locale: 'en', type: 'region' })).toBe('United States');
		expect(run('locale.display-name', 'de', { locale: 'fr', type: 'language' })).toBe('allemand');
		expect(run('locale.display-name', 'EUR', { locale: 'de', type: 'currency' })).toBe('Euro');
	});

	it('rejects an invalid code and an unknown type', () => {
		expect(() => run('locale.display-name', '!!', { locale: 'en', type: 'region' })).toThrow(/valid region code/);

		expect(() => run('locale.display-name', 'US', { locale: 'en', type: 'planet' })).toThrow(
			/region, language, script, or currency/
		);
	});

	it('fails loudly for a syntactically valid but unassigned code', () => {
		expect(() => run('locale.display-name', 'ZZZ', { locale: 'en', type: 'currency' })).toThrow(
			/no currency display name/
		);

		expect(() => run('locale.display-name', 'qqq', { locale: 'en', type: 'language' })).toThrow(
			/no language display name/
		);
	});
});

describe('locale.plural', () => {
	it('selects the operator form for the resolved category', () => {
		const forms = { one: 'item', other: 'items' };
		expect(run('locale.plural', 1, { locale: 'en', ...forms })).toBe('item');
		expect(run('locale.plural', 2, { locale: 'en', ...forms })).toBe('items');
		expect(run('locale.plural', 5, { locale: 'en', ...forms })).toBe('items');
	});

	it('resolves language-specific categories', () => {
		expect(run('locale.plural', 2, { locale: 'pl', one: 'x', few: 'kilka', many: 'm', other: 'o' })).toBe('kilka');

		expect(
			run('locale.plural', 1, { locale: 'en', type: 'ordinal', one: 'st', two: 'nd', few: 'rd', other: 'th' })
		).toBe('st');
	});

	it('omits a blank slot so an empty value never overrides a real form', () => {
		expect(run('locale.plural', 1, { locale: 'en', one: '', other: 'items' })).toBe('items');
		expect(run('locale.plural', 1, { locale: 'en', one: undefined, other: 'items' })).toBe('items');
		expect(run('locale.plural', 1, { locale: 'en', one: null, other: 'items' })).toBe('items');
	});

	it('fails loudly at prepare when a needed plural form and "other" are both absent', () => {
		expect(() => run('locale.plural', 1, { locale: 'en', two: 'x' })).toThrow(/the "one" plural form is missing/);
	});

	it('rejects a non-string slot at prepare', () => {
		expect(() => run('locale.plural', 1, { locale: 'en', one: 42, other: 'items' })).toThrow(/must be a string/);
	});
});

describe('hourCycle', () => {
	const base = { inputKind: 'instant', locale: 'en-US', timeZone: 'UTC', timeStyle: 'short' };

	it('selects the clock explicitly on format, now, and range', () => {
		expect(run('date.format', '2024-01-05T13:05:00Z', { ...base, hourCycle: 'h23' })).toBe('13:05');
		expect(run('date.format', '2024-01-05T13:05:00Z', { ...base, hourCycle: 'h12' })).toMatch(/^1:05\sPM$/);

		expect(run('date.now', null, { locale: 'en-US', timeZone: 'UTC', timeStyle: 'short', hourCycle: 'h23' })).toMatch(
			/^\d{2}:\d{2}$/
		);

		const range = { start: '2024-01-05T13:05:00Z', end: '2024-01-05T14:05:00Z' };
		expect(run('date.range', range, { ...base, hourCycle: 'h23' })).toMatch(/13:05/);
	});

	it('rejects an unknown cycle through the formatter constructor', () => {
		expect(() => run('date.format', '2024-01-05T13:05:00Z', { ...base, hourCycle: 'h25' })).toThrow(
			/formatting options are invalid/
		);
	});
});
