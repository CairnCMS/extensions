import { describe, expect, it } from 'vitest';
import { FormatterError } from '../src/lib/errors.js';
import { registerBuiltins } from '../src/lib/index.js';
import { getTransform, listTransforms, type TransformContext } from '../src/lib/registry.js';

registerBuiltins();

const ctx: TransformContext = { icu: { normalize: true, casing: true, formatting: true } };

describe('FormatterError builds a fresh, allowlisted, bounded location', () => {
	it('keeps only a bounded transform and an integer index, dropping everything else', () => {
		const supplied = {
			transform: 'x'.repeat(200),
			index: 3,
			path: 'secret-path',
			extra: 'secret-extra',
		} as unknown as ConstructorParameters<typeof FormatterError>[2];

		const error = new FormatterError('INVALID_OPTION', 'a reason', supplied);

		expect(Object.keys(error.location).sort()).toEqual(['index', 'transform']);
		expect(error.location.transform).toBe('x'.repeat(64));
		expect(error.location.index).toBe(3);
		expect(error.location).not.toBe(supplied);

		const serialized = JSON.stringify(error.location);
		expect(serialized).not.toContain('secret-path');
		expect(serialized).not.toContain('secret-extra');
		expect(error.message).not.toContain('secret-path');
		expect(error.message).not.toContain('secret-extra');
	});

	it('is immune to later mutation of the supplied location object', () => {
		const supplied = { transform: 'text.trim', index: 1 };
		const error = new FormatterError('INVALID_INPUT', 'reason', supplied);

		(supplied as Record<string, unknown>)['transform'] = 'mutated';
		(supplied as Record<string, unknown>)['leaked'] = 'secret';

		expect(error.location.transform).toBe('text.trim');
		expect(JSON.stringify(error.location)).not.toContain('secret');
	});

	it('omits a non-integer index', () => {
		const error = new FormatterError('BOUND_EXCEEDED', 'reason', {
			index: 1.5,
		} as unknown as ConstructorParameters<typeof FormatterError>[2]);

		expect(error.location.index).toBeUndefined();
		expect('index' in error.location).toBe(false);
	});
});

describe('transform input errors never repeat the input', () => {
	const name = 'Ada Lovelace';
	const phone = '2015550199';
	const text = `${name} ${phone}`;
	const record = { name, phone };

	const exempt = ['date.now'];

	const cases: Array<[string, Record<string, unknown>, unknown]> = [
		['text.trim', {}, record],
		['text.normalize', {}, record],
		['text.uppercase', {}, record],
		['text.lowercase', {}, record],
		['text.truncate', { maxLength: 3 }, record],
		['text.replace', { find: 'a' }, record],
		['text.slugify', {}, record],
		['phone.format', { region: 'US' }, `${text} or 2025550123`],
		['phone.validate', { region: 'US' }, record],
		['number.round', { scale: 2 }, text],
		['number.format', { locale: 'en-US' }, text],
		['date.format', { inputKind: 'date', locale: 'en-US' }, text],
		['date.parse', { inputKind: 'instant' }, text],
		['date.relative', { locale: 'en', unit: 'day' }, text],
		['date.range', { inputKind: 'date', locale: 'en-US' }, { start: text, end: '2024-01-05' }],
		['locale.list', { locale: 'en' }, [name, Number(phone)]],
		['locale.display-name', { locale: 'en', type: 'region' }, text],
		['locale.plural', { locale: 'en', other: 'items' }, text],
		['lookup.table', { table: [{ key: 'a', value: 'b' }] }, text],
	];

	it('rejects input carrying a name and a phone number without repeating either, for every transform', () => {
		const covered = [...cases.map(([id]) => id), ...exempt].sort();

		expect(covered).toEqual(
			listTransforms()
				.map((definition) => definition.id)
				.sort()
		);

		for (const [id, options, input] of cases) {
			let caught: unknown;

			try {
				getTransform(id)!.prepare(options, ctx)(input);
			} catch (error) {
				caught = error;
			}

			expect(caught, id).toBeInstanceOf(FormatterError);
			const error = caught as FormatterError;
			expect(error.code, id).toBe('INVALID_INPUT');

			const location = JSON.stringify(error.location);

			for (const fragment of ['Ada', 'Lovelace', phone]) {
				expect(error.message, id).not.toContain(fragment);
				expect(location, id).not.toContain(fragment);
			}
		}
	});
});
