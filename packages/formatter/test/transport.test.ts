import { describe, expect, it } from 'vitest';
import { registerBuiltins } from '../src/lib/index.js';
import { listTransforms } from '../src/lib/registry.js';
import {
	manifestOptionKeys,
	TRANSFORM_MANIFEST,
	transportFieldName,
	type TransformOption,
} from '../src/lib/transport.js';

registerBuiltins();

function allOptions(): TransformOption[] {
	return TRANSFORM_MANIFEST.flatMap((entry) => [...entry.options]);
}

describe('transport manifest', () => {
	it('agrees with the server registry: same ids and same option keys', () => {
		const registry = new Map(listTransforms().map((definition) => [definition.id, [...definition.optionKeys].sort()]));
		const manifest = new Map(TRANSFORM_MANIFEST.map((entry) => [entry.id, manifestOptionKeys(entry).sort()]));

		expect([...manifest.keys()].sort()).toEqual([...registry.keys()].sort());

		for (const [id, keys] of manifest) {
			expect(keys).toEqual(registry.get(id));
		}
	});

	it('produces a unique field name for every option', () => {
		const fields = new Set<string>();

		for (const entry of TRANSFORM_MANIFEST) {
			for (const key of manifestOptionKeys(entry)) {
				const field = transportFieldName(entry.id, key);
				expect(fields.has(field)).toBe(false);
				fields.add(field);
			}
		}
	});

	it('sanitizes dots and hyphens with a double-underscore separator', () => {
		expect(transportFieldName('number.round', 'mode')).toBe('number_round__mode');
		expect(transportFieldName('locale.display-name', 'type')).toBe('locale_display_name__type');
	});

	it('gives every option a label and pairs each interface with a matching storage type', () => {
		const allowedTypes: Record<TransformOption['interface'], TransformOption['type'][]> = {
			input: ['string', 'integer'],
			'select-dropdown': ['string'],
			boolean: ['boolean'],
			'input-code': ['json'],
			list: ['json'],
		};

		for (const option of allOptions()) {
			expect(option.label.length, option.key).toBeGreaterThan(0);
			expect(allowedTypes[option.interface], option.key).toContain(option.type);
		}
	});

	it('gives every select at least two choices and every list its row fields', () => {
		for (const option of allOptions()) {
			if (option.interface === 'select-dropdown') {
				expect(option.choices?.length, option.key).toBeGreaterThanOrEqual(2);
			}

			if (option.interface === 'list') {
				expect(option.rowFields?.length, option.key).toBeGreaterThan(0);
			}
		}
	});

	it('gives every select choice a display label rather than echoing the raw value', () => {
		const choicesFor = (transformId: string, key: string) =>
			TRANSFORM_MANIFEST.find((entry) => entry.id === transformId)?.options.find((option) => option.key === key)
				?.choices;

		expect(choicesFor('phone.format', 'format')).toEqual([
			{ value: 'e164', text: 'E.164' },
			{ value: 'international', text: 'International' },
			{ value: 'national', text: 'National' },
			{ value: 'rfc3966', text: 'RFC 3966' },
		]);

		expect(choicesFor('number.round', 'mode')).toEqual([
			{ value: 'half-up', text: 'Half up' },
			{ value: 'half-even', text: 'Half even' },
			{ value: 'toward-zero', text: 'Toward zero' },
			{ value: 'away-from-zero', text: 'Away from zero' },
		]);

		expect(choicesFor('date.parse', 'output')).toEqual([
			{ value: 'iso', text: 'ISO' },
			{ value: 'epoch-seconds', text: 'Epoch seconds' },
			{ value: 'epoch-milliseconds', text: 'Epoch milliseconds' },
		]);

		expect(choicesFor('number.format', 'style')).toEqual([
			{ value: 'decimal', text: 'Decimal' },
			{ value: 'currency', text: 'Currency' },
			{ value: 'percent', text: 'Percent' },
			{ value: 'unit', text: 'Unit' },
		]);

		for (const option of allOptions()) {
			if (option.interface !== 'select-dropdown') continue;

			if (typeof option.placeholder === 'string' && option.placeholder.startsWith('Default: ')) {
				expect(/^Default: [A-Z0-9]/.test(option.placeholder), option.key).toBe(true);
			}
		}
	});
});
