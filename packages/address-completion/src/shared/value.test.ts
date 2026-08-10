import { describe, expect, it } from 'vitest';
import { classifyValue, mapPlaceDetails } from './value.js';

const SELECTED = {
	version: 1,
	formattedAddress: '12345 College Blvd, Overland Park, KS 66210, USA',
	placeId: 'ChIJgU60wNLqwIcRzYBIZgwf1io',
	location: { latitude: 38.9249484, longitude: -94.7269431, observedAt: '2026-08-09T14:22:24.388Z' },
	components: { locality: 'Overland Park', region: 'KS', postalCode: '66210', countryCode: 'US' },
};

const MANUAL = { version: 1, formattedAddress: 'Warehouse dock 3, rear entrance' };

function selectedWith(patch: Record<string, unknown>): Record<string, unknown> {
	return { ...structuredClone(SELECTED), ...patch };
}

function locationWith(patch: Record<string, unknown>): Record<string, unknown> {
	return selectedWith({ location: { ...structuredClone(SELECTED.location), ...patch } });
}

describe('classifyValue', () => {
	it('classifies null and undefined as empty', () => {
		expect(classifyValue(null)).toBe('empty');
		expect(classifyValue(undefined)).toBe('empty');
	});

	it('classifies non-records as foreign', () => {
		for (const value of ['address', 42, true, ['a']]) {
			expect(classifyValue(value)).toBe('foreign');
		}
	});

	it('classifies the full Selected record as selected, with and without components', () => {
		expect(classifyValue(SELECTED)).toBe('selected');
		const { components: _components, ...withoutComponents } = SELECTED;
		expect(classifyValue(withoutComponents)).toBe('selected');
	});

	it('classifies the Manual record as manual', () => {
		expect(classifyValue(MANUAL)).toBe('manual');
	});

	it('rejects wrong versions and blank addresses', () => {
		expect(classifyValue({ ...MANUAL, version: 2 })).toBe('foreign');
		expect(classifyValue({ version: 1, formattedAddress: '' })).toBe('foreign');
		expect(classifyValue({ version: 1, formattedAddress: '   ' })).toBe('foreign');
	});

	it('rejects a Manual record carrying unknown keys', () => {
		expect(classifyValue({ ...MANUAL, extra: true })).toBe('foreign');
	});

	it('rejects a Selected record carrying unknown keys', () => {
		expect(classifyValue(selectedWith({ viewport: {} }))).toBe('foreign');
	});

	it('rejects a blank or missing placeId when location is present', () => {
		expect(classifyValue(selectedWith({ placeId: '' }))).toBe('foreign');
		expect(classifyValue(selectedWith({ placeId: '  ' }))).toBe('foreign');
	});

	it('rejects a placeId that violates the endpoint grammar, so a stored record cannot refuse its own refresh', () => {
		expect(classifyValue(selectedWith({ placeId: 'a/b' }))).toBe('foreign');
		expect(classifyValue(selectedWith({ placeId: 'a'.repeat(513) }))).toBe('foreign');
	});

	it('rejects out-of-range and non-finite coordinates', () => {
		expect(classifyValue(locationWith({ latitude: 90.1 }))).toBe('foreign');
		expect(classifyValue(locationWith({ latitude: Number.NaN }))).toBe('foreign');
		expect(classifyValue(locationWith({ longitude: -180.1 }))).toBe('foreign');
		expect(classifyValue(locationWith({ longitude: '0' }))).toBe('foreign');
	});

	it('accepts zero coordinates', () => {
		expect(classifyValue(locationWith({ latitude: 0, longitude: 0 }))).toBe('selected');
	});

	it('rejects location objects with missing or extra keys', () => {
		expect(classifyValue(selectedWith({ location: { latitude: 1, longitude: 2 } }))).toBe('foreign');
		expect(classifyValue(locationWith({ altitude: 100 }))).toBe('foreign');
	});

	it('rejects observedAt values outside the canonical UTC form', () => {
		for (const observedAt of [
			'2026-08-09T14:22:24Z',
			'2026-08-09T14:22:24.388+02:00',
			'2026-02-31T00:00:00.000Z',
			'not a date',
			'',
			1723212144,
		]) {
			expect(classifyValue(locationWith({ observedAt }))).toBe('foreign');
		}
	});

	it('rejects invalid component records', () => {
		expect(classifyValue(selectedWith({ components: { locality: '' } }))).toBe('foreign');
		expect(classifyValue(selectedWith({ components: { city: 'Overland Park' } }))).toBe('foreign');
		expect(classifyValue(selectedWith({ components: [] }))).toBe('foreign');
	});
});

const GOOGLE_PLACE = {
	id: 'ChIJgU60wNLqwIcRzYBIZgwf1io',
	formattedAddress: '12345 College Blvd, Overland Park, KS 66210, USA',
	location: { latitude: 38.9249484, longitude: -94.7269431 },
	addressComponents: [
		{ types: ['street_number'], longText: '12345', shortText: '12345' },
		{ types: ['route'], longText: 'College Boulevard', shortText: 'College Blvd' },
		{ types: ['locality', 'political'], longText: 'Overland Park', shortText: 'Overland Park' },
		{ types: ['administrative_area_level_1', 'political'], longText: 'Kansas', shortText: 'KS' },
		{ types: ['postal_code'], longText: '66210', shortText: '66210' },
		{ types: ['country', 'political'], longText: 'United States', shortText: 'US' },
	],
};

const OBSERVED_AT = '2026-08-09T14:22:24.388Z';

describe('mapPlaceDetails', () => {
	it('maps a full place to the exact Selected record', () => {
		const result = mapPlaceDetails(GOOGLE_PLACE, OBSERVED_AT);

		expect(result).toEqual({
			ok: true,
			value: {
				version: 1,
				formattedAddress: GOOGLE_PLACE.formattedAddress,
				placeId: GOOGLE_PLACE.id,
				location: { latitude: 38.9249484, longitude: -94.7269431, observedAt: OBSERVED_AT },
				components: { locality: 'Overland Park', region: 'KS', postalCode: '66210', countryCode: 'US' },
			},
		});
	});

	it('falls back to postal_town for the locality', () => {
		const place = {
			...GOOGLE_PLACE,
			formattedAddress: '10 Downing St, London SW1A 2AA, UK',
			addressComponents: [
				{ types: ['postal_town'], longText: 'London', shortText: 'London' },
				{ types: ['country', 'political'], longText: 'United Kingdom', shortText: 'GB' },
				{ types: ['postal_code'], longText: 'SW1A 2AA', shortText: 'SW1A 2AA' },
			],
		};

		const result = mapPlaceDetails(place, OBSERVED_AT);
		expect(result.ok).toBe(true);

		if (result.ok) {
			expect(result.value.components).toEqual({ locality: 'London', postalCode: 'SW1A 2AA', countryCode: 'GB' });
		}
	});

	it('omits the components key entirely when nothing extractable exists', () => {
		const result = mapPlaceDetails(
			{ ...GOOGLE_PLACE, addressComponents: [{ types: ['street_number'], longText: '1' }] },
			OBSERVED_AT
		);

		expect(result.ok).toBe(true);
		if (result.ok) expect('components' in result.value).toBe(false);
	});

	it('tolerates a missing or malformed addressComponents array', () => {
		for (const addressComponents of [undefined, 'x', [{ noTypes: true }, null]]) {
			const result = mapPlaceDetails({ ...GOOGLE_PLACE, addressComponents }, OBSERVED_AT);
			expect(result.ok).toBe(true);
			if (result.ok) expect('components' in result.value).toBe(false);
		}
	});

	it('accepts zero coordinates', () => {
		const result = mapPlaceDetails({ ...GOOGLE_PLACE, location: { latitude: 0, longitude: 0 } }, OBSERVED_AT);
		expect(result.ok).toBe(true);
	});

	it('fails with the formattedAddress reason for a missing or blank address', () => {
		for (const place of [null, {}, { ...GOOGLE_PLACE, formattedAddress: ' ' }]) {
			const result = mapPlaceDetails(place, OBSERVED_AT);
			expect(result).toEqual({ ok: false, reason: 'formattedAddress' });
		}
	});

	it('fails with the placeId reason for a missing, blank, or grammar-violating id', () => {
		expect(mapPlaceDetails({ ...GOOGLE_PLACE, id: '' }, OBSERVED_AT)).toEqual({ ok: false, reason: 'placeId' });
		expect(mapPlaceDetails({ ...GOOGLE_PLACE, id: 'a/b' }, OBSERVED_AT)).toEqual({ ok: false, reason: 'placeId' });

		expect(mapPlaceDetails({ ...GOOGLE_PLACE, id: 'a'.repeat(513) }, OBSERVED_AT)).toEqual({
			ok: false,
			reason: 'placeId',
		});
	});

	it('fails with the location reason for missing or invalid coordinates', () => {
		for (const location of [undefined, {}, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: '1' }]) {
			expect(mapPlaceDetails({ ...GOOGLE_PLACE, location }, OBSERVED_AT)).toEqual({ ok: false, reason: 'location' });
		}
	});

	it('fails with the observedAt reason for non-canonical timestamps', () => {
		for (const observedAt of ['2026-08-09T14:22:24Z', '2026-02-31T00:00:00.000Z', '', undefined]) {
			expect(mapPlaceDetails(GOOGLE_PLACE, observedAt)).toEqual({ ok: false, reason: 'observedAt' });
		}
	});
});
