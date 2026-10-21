import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormatterError } from '../src/lib/errors.js';
import type { IcuCapabilities, IcuCapability } from '../src/lib/icu.js';
import { registerBuiltins } from '../src/lib/index.js';
import { getTransform, listTransforms, type TransformContext } from '../src/lib/registry.js';

registerBuiltins();

const ctx: TransformContext = { icu: { normalize: true, casing: true, formatting: true } };

function prepareError(
	id: string,
	options: Record<string, unknown>,
	icu: IcuCapabilities = ctx.icu
): FormatterError | undefined {
	try {
		getTransform(id)!.prepare(options, { icu });
		return undefined;
	} catch (error) {
		if (error instanceof FormatterError) return error;
		throw error;
	}
}

function registeredIds(): string[] {
	return listTransforms()
		.map((definition) => definition.id)
		.sort();
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('prepare-once transform contract', () => {
	it('validates options at prepare, before returning an applier', () => {
		expect(() => getTransform('number.round')!.prepare({ scale: 2, mode: 'bogus' }, ctx)).toThrow(/mode/);
		expect(() => getTransform('phone.format')!.prepare({ region: 'ZZ' }, ctx)).toThrow(/region/);
	});

	it('applies config-first precedence: a config error precedes an input error', () => {
		expect(() => getTransform('number.round')!.prepare({ scale: 2, mode: 'bogus' }, ctx)).toThrow(/mode/);

		const applyBadInput = getTransform('number.round')!.prepare({ scale: 2 }, ctx);
		expect(() => applyBadInput('not a number')).toThrow(/number/);
	});

	it('builds the Intl formatter once per prepared rule, not per value', () => {
		const spy = vi.spyOn(Intl, 'DateTimeFormat');
		const before = spy.mock.calls.length;

		const apply = getTransform('date.format')!.prepare({ inputKind: 'date', locale: 'en-US', dateStyle: 'long' }, ctx);
		apply('2024-01-01');
		apply('2024-02-02');
		apply('2024-03-03');

		expect(spy.mock.calls.length - before).toBe(1);
	});

	it('date.now reads the clock per application, not at prepare', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		const apply = getTransform('date.now')!.prepare({}, ctx);
		const first = apply(null);
		vi.setSystemTime(new Date('2024-01-01T00:00:05Z'));
		const second = apply(null);

		expect(first).toBe('2024-01-01T00:00:00Z');
		expect(second).toBe('2024-01-01T00:00:05Z');
	});

	it('lookup.table snapshots the table at prepare and ignores later source mutation', () => {
		const rows: Array<{ key: string; value: string }> = [
			{ key: 'a', value: 'Alpha' },
			{ key: 'b', value: 'Beta' },
		];

		const apply = getTransform('lookup.table')!.prepare({ table: rows }, ctx);
		rows.push({ key: 'c', value: 'Gamma' });
		rows[0]!.value = 'MUTATED';

		expect(apply('a')).toBe('Alpha');
		expect(() => apply('c')).toThrow(/no lookup match/);
	});

	it('locale.plural snapshots the form slots at prepare and ignores later source mutation', () => {
		const options: Record<string, unknown> = { locale: 'en', one: 'item', other: 'items' };
		const apply = getTransform('locale.plural')!.prepare(options, ctx);
		options['one'] = 'MUTATED';
		options['other'] = 'MUTATED-PLURAL';

		expect(apply(1)).toBe('item');
		expect(apply(5)).toBe('items');
	});

	it('locale.plural rejects a non-string slot at prepare, before any application', () => {
		expect(() => getTransform('locale.plural')!.prepare({ locale: 'en', one: 42, other: 'items' }, ctx)).toThrow(
			/must be a string/
		);
	});

	it('locale.plural rejects incomplete coverage at prepare (missing category and no "other" fallback)', () => {
		expect(() => getTransform('locale.plural')!.prepare({ locale: 'en', one: 'item' }, ctx)).toThrow(
			/the "other" plural form is missing/
		);
	});
});

describe('required options', () => {
	const cases: Array<[string, Record<string, unknown>, string[]]> = [
		['text.trim', {}, []],
		['text.normalize', {}, []],
		['text.uppercase', {}, []],
		['text.lowercase', {}, []],
		['text.truncate', { maxLength: 3 }, ['maxLength']],
		['text.replace', { find: 'a' }, ['find']],
		['text.slugify', {}, []],
		['phone.format', { region: 'US' }, ['region']],
		['phone.validate', { region: 'US' }, ['region']],
		['number.round', { scale: 2 }, ['scale']],
		['number.format', { locale: 'en-US' }, ['locale']],
		['number.format', { locale: 'en-US', style: 'currency', currency: 'USD' }, ['currency']],
		['number.format', { locale: 'en-US', style: 'unit', unit: 'kilometer' }, ['unit']],
		['date.format', { inputKind: 'date', locale: 'en-US' }, ['inputKind', 'locale']],
		['date.parse', { inputKind: 'date' }, ['inputKind']],
		['date.now', {}, []],
		['date.relative', { locale: 'en', unit: 'day' }, ['locale', 'unit']],
		['date.range', { inputKind: 'date', locale: 'en-US' }, ['inputKind', 'locale']],
		['locale.list', { locale: 'en' }, ['locale']],
		['locale.display-name', { locale: 'en', type: 'region' }, ['locale', 'type']],
		['locale.plural', { locale: 'en', other: 'items' }, ['locale']],
		['lookup.table', { table: [{ key: 'a', value: 'b' }] }, ['table']],
	];

	it('refuses each documented required option at prepare when only that option is removed from a valid configuration', () => {
		expect([...new Set(cases.map(([id]) => id))].sort()).toEqual(registeredIds());

		for (const [id, valid, required] of cases) {
			expect(prepareError(id, valid), `${id} valid configuration`).toBeUndefined();

			for (const option of required) {
				const withoutOption = { ...valid };
				delete withoutOption[option];
				const error = prepareError(id, withoutOption);

				expect(error?.code, `${id} without ${option}`).toBe('INVALID_OPTION');
				expect(error?.message, `${id} without ${option}`).toContain(`option "${option}"`);
			}
		}
	});
});

describe('ICU capability tiers', () => {
	const smallIcu: IcuCapabilities = { normalize: true, casing: true, formatting: false };
	const noIntl: IcuCapabilities = { normalize: false, casing: false, formatting: false };

	const refusal: Record<IcuCapability, RegExp> = {
		normalize: /normalization is unavailable/,
		casing: /casing is unavailable/,
		formatting: /requires full ICU/,
	};

	const cases: Array<[string, Record<string, unknown>, IcuCapability | null, IcuCapability | null]> = [
		['text.trim', {}, null, null],
		['text.normalize', {}, null, 'normalize'],
		['text.uppercase', {}, null, null],
		['text.uppercase', { locale: 'tr' }, null, 'casing'],
		['text.lowercase', {}, null, null],
		['text.lowercase', { locale: 'tr' }, null, 'casing'],
		['text.truncate', { maxLength: 3 }, null, null],
		['text.replace', { find: 'a' }, null, null],
		['text.slugify', {}, null, 'normalize'],
		['phone.format', { region: 'US' }, null, null],
		['phone.validate', { region: 'US' }, null, null],
		['number.round', { scale: 2 }, null, null],
		['number.format', { locale: 'en-US' }, 'formatting', 'formatting'],
		['date.format', { inputKind: 'date', locale: 'en-US' }, 'formatting', 'formatting'],
		['date.parse', { inputKind: 'date' }, null, null],
		['date.now', {}, null, null],
		['date.now', { locale: 'en-US', timeZone: 'UTC' }, 'formatting', 'formatting'],
		['date.relative', { locale: 'en', unit: 'day' }, 'formatting', 'formatting'],
		['date.range', { inputKind: 'date', locale: 'en-US' }, 'formatting', 'formatting'],
		['locale.list', { locale: 'en' }, 'formatting', 'formatting'],
		['locale.display-name', { locale: 'en', type: 'region' }, 'formatting', 'formatting'],
		['locale.plural', { locale: 'en', other: 'items' }, 'formatting', 'formatting'],
		['lookup.table', { table: [{ key: 'a', value: 'b' }] }, null, null],
	];

	it('prepares each transform or refuses it by its own capability under small ICU and without Intl', () => {
		expect([...new Set(cases.map(([id]) => id))].sort()).toEqual(registeredIds());

		for (const [id, options, underSmallIcu, withoutIntl] of cases) {
			for (const [tier, icu, refusedBy] of [
				['small ICU', smallIcu, underSmallIcu],
				['no Intl', noIntl, withoutIntl],
			] as const) {
				const label = `${id} ${JSON.stringify(options)} under ${tier}`;
				const error = prepareError(id, options, icu);

				if (refusedBy === null) {
					expect(error, label).toBeUndefined();
				} else {
					expect(error?.code, label).toBe('ICU_UNAVAILABLE');
					expect(error?.message, label).toMatch(refusal[refusedBy]);
				}
			}
		}
	});
});
