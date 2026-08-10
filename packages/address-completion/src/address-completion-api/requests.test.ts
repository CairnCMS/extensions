import { describe, expect, it } from 'vitest';
import { parseAutocompleteBody, parseDetailsRequest, shapeSuggestions } from './requests.js';

const SESSION = 'f8a3b2c1-4d5e-6f70-8192-a3b4c5d6e7f8';

const CAIRNCMS_LOCALES = [
	'af-ZA',
	'ar-SA',
	'bg-BG',
	'bn-IN',
	'br-FR',
	'bs-BA',
	'ca-ES',
	'ckb-IR',
	'cs-CZ',
	'da-DK',
	'de-DE',
	'el-GR',
	'en-CA',
	'en-GB',
	'en-US',
	'eo-UY',
	'es-419',
	'es-CL',
	'es-ES',
	'es-MX',
	'et-EE',
	'fa-IR',
	'fi-FI',
	'fo-FO',
	'fr-CA',
	'fr-FR',
	'he-IL',
	'hi-IN',
	'hr-HR',
	'hu-HU',
	'id-ID',
	'is-IS',
	'it-IT',
	'ja-JP',
	'ka-GE',
	'km-KH',
	'kmr-TR',
	'ko-KR',
	'ku-TR',
	'lt-LT',
	'mn-MN',
	'ms-MY',
	'ne-NP',
	'nl-NL',
	'no-NO',
	'pl-PL',
	'pt-BR',
	'pt-PT',
	'ro-RO',
	'ru-RU',
	'si-LK',
	'sk-SK',
	'sl-SI',
	'sr-CS',
	'sr-SP',
	'sv-SE',
	'sw-KE',
	'sw-TZ',
	'tg-TJ',
	'th-TH',
	'tr-TR',
	'uk-UA',
	'vi-VN',
	'zh-CN',
	'zh-TW',
];

function valid(extra: Record<string, unknown> = {}): Record<string, unknown> {
	return { input: '12345 College Blvd', sessionToken: SESSION, ...extra };
}

function expectInvalid(body: unknown, messagePart: string) {
	const result = parseAutocompleteBody(body);
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.message).toContain(messagePart);
}

function expectOutbound(body: Record<string, unknown>): Record<string, unknown> {
	const result = parseAutocompleteBody(body);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.message);
	return result.outbound;
}

describe('parseAutocompleteBody', () => {
	it('rejects non-object bodies', () => {
		for (const body of [null, undefined, 'text', 42, ['input']]) {
			expectInvalid(body, 'object');
		}
	});

	it('requires input as a string', () => {
		expectInvalid({ sessionToken: SESSION }, 'input is required');
		expectInvalid({ input: 42, sessionToken: SESSION }, 'input is required');
	});

	it('rejects empty, whitespace-only, and over-length input', () => {
		expectInvalid(valid({ input: '' }), '1 to 255');
		expectInvalid(valid({ input: '   ' }), '1 to 255');
		expectInvalid(valid({ input: 'x'.repeat(256) }), '1 to 255');
	});

	it('trims input and accepts up to 255 characters', () => {
		expect(expectOutbound(valid({ input: '  10 Main St  ' }))['input']).toBe('10 Main St');
		expect(expectOutbound(valid({ input: 'x'.repeat(255) }))['input']).toBe('x'.repeat(255));
	});

	it('requires a URL-safe session token of at most 36 characters', () => {
		expectInvalid(valid({ sessionToken: undefined }), 'sessionToken');
		expectInvalid(valid({ sessionToken: 'not valid!!' }), 'sessionToken');
		expectInvalid(valid({ sessionToken: 'x'.repeat(37) }), 'sessionToken');
		expect(expectOutbound(valid())['sessionToken']).toBe(SESSION);
	});

	it('emits only the expected keys for a minimal request', () => {
		expect(Object.keys(expectOutbound(valid())).sort()).toEqual(['input', 'sessionToken']);
	});

	it('rejects more than 15 country entries before any traversal, duplicates included', () => {
		expectInvalid(valid({ countries: Array(16).fill('GB') }), 'at most 15');
		expectInvalid(valid({ countries: Array(100000).fill('GB') }), 'at most 15');
	});

	it('rejects values outside the ISO 3166-1 alpha-2 set', () => {
		for (const code of ['ZZ', 'AA', 'UK', 'USA', 'U', '']) {
			expectInvalid(valid({ countries: [code] }), 'ISO 3166-1');
		}

		expectInvalid(valid({ countries: ['GB', 42] }), 'ISO 3166-1');
		expectInvalid(valid({ countries: 'GB' }), 'countries must be an array');
	});

	it('lowercases, deduplicates case-insensitively, and preserves order', () => {
		expect(expectOutbound(valid({ countries: ['GB', 'gb', 'US'] }))['includedRegionCodes']).toEqual(['gb', 'us']);
	});

	it('accepts 15 distinct codes and omits the key for an empty array', () => {
		const codes = ['US', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'IE'];
		expect(expectOutbound(valid({ countries: codes }))['includedRegionCodes']).toHaveLength(15);
		expect('includedRegionCodes' in expectOutbound(valid({ countries: [] }))).toBe(false);
	});

	it('maps each scope to its exact primary types', () => {
		expect('includedPrimaryTypes' in expectOutbound(valid({ scope: 'all' }))).toBe(false);

		expect(expectOutbound(valid({ scope: 'addresses' }))['includedPrimaryTypes']).toEqual([
			'street_address',
			'premise',
			'subpremise',
			'route',
			'postal_code',
		]);

		expect(expectOutbound(valid({ scope: 'cities' }))['includedPrimaryTypes']).toEqual(['(cities)']);
		expect(expectOutbound(valid({ scope: 'regions' }))['includedPrimaryTypes']).toEqual(['(regions)']);
	});

	it('rejects inherited object properties as scope values', () => {
		for (const scope of ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty']) {
			expectInvalid(valid({ scope }), 'scope must be one of');
		}
	});

	it('rejects unknown and non-string scope values', () => {
		expectInvalid(valid({ scope: 'pois' }), 'scope must be one of');
		expectInvalid(valid({ scope: ['cities'] }), 'scope must be one of');
	});

	it('shapes a valid bias into a circle', () => {
		expect(
			expectOutbound(valid({ bias: { latitude: 38.92, longitude: -94.72, radiusMeters: 20000 } }))['locationBias']
		).toEqual({
			circle: { center: { latitude: 38.92, longitude: -94.72 }, radius: 20000 },
		});
	});

	it('accepts bias boundary values', () => {
		for (const bias of [
			{ latitude: 90, longitude: 180, radiusMeters: 100 },
			{ latitude: -90, longitude: -180, radiusMeters: 50000 },
			{ latitude: 0, longitude: 0, radiusMeters: 5000 },
		]) {
			expect('locationBias' in expectOutbound(valid({ bias }))).toBe(true);
		}
	});

	it('rejects out-of-range, non-finite, and non-integer bias values', () => {
		expectInvalid(valid({ bias: { latitude: 90.1, longitude: 0, radiusMeters: 5000 } }), 'latitude');
		expectInvalid(valid({ bias: { latitude: Number.NaN, longitude: 0, radiusMeters: 5000 } }), 'latitude');
		expectInvalid(valid({ bias: { latitude: 0, longitude: 180.1, radiusMeters: 5000 } }), 'longitude');

		expectInvalid(
			valid({ bias: { latitude: 0, longitude: Number.POSITIVE_INFINITY, radiusMeters: 5000 } }),
			'longitude'
		);

		expectInvalid(valid({ bias: { latitude: 0, longitude: 0, radiusMeters: 99 } }), 'radiusMeters');
		expectInvalid(valid({ bias: { latitude: 0, longitude: 0, radiusMeters: 50001 } }), 'radiusMeters');
		expectInvalid(valid({ bias: { latitude: 0, longitude: 0, radiusMeters: 100.5 } }), 'radiusMeters');
		expectInvalid(valid({ bias: { latitude: 0, longitude: 0 } }), 'radiusMeters');
		expectInvalid(valid({ bias: { longitude: 0, radiusMeters: 5000 } }), 'latitude');
		expectInvalid(valid({ bias: [38, -94, 5000] }), 'bias must be an object');
		expectInvalid(valid({ bias: 'nearby' }), 'bias must be an object');
	});

	it('accepts every CairnCMS locale as a languageCode', () => {
		for (const locale of CAIRNCMS_LOCALES) {
			expect(expectOutbound(valid({ languageCode: locale }))['languageCode']).toBe(locale);
		}
	});

	it('rejects malformed language tags', () => {
		for (const languageCode of ['no_good!', 'a', 'en-', '-en', 'en--US', 'x'.repeat(36), 'en US', 42]) {
			expectInvalid(valid({ languageCode }), 'languageCode');
		}
	});
});

describe('parseDetailsRequest', () => {
	it('builds the details URL with the place id as a single encoded segment', () => {
		const result = parseDetailsRequest('/place/ChIJgU60wNLqwIcRzYBIZgwf1io', {});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.url).toBe('https://places.googleapis.com/v1/places/ChIJgU60wNLqwIcRzYBIZgwf1io');
	});

	it('accepts ids at the 512 boundary and rejects 513', () => {
		expect(parseDetailsRequest(`/place/${'a'.repeat(512)}`, {}).ok).toBe(true);
		expect(parseDetailsRequest(`/place/${'a'.repeat(513)}`, {}).ok).toBe(false);
	});

	it('rejects traversal and delimiter characters in the id', () => {
		for (const id of ['..%2Fplaces:autocomplete', '../other', 'a/b', 'a?b', 'a#b', 'a.b', '', 'id with space']) {
			expect(parseDetailsRequest(`/place/${id}`, {}).ok).toBe(false);
		}
	});

	it('appends a validated session token and rejects invalid ones', () => {
		const result = parseDetailsRequest('/place/abc', { sessionToken: SESSION });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.url).toBe(`https://places.googleapis.com/v1/places/abc?sessionToken=${SESSION}`);

		expect(parseDetailsRequest('/place/abc', { sessionToken: 'bad token!' }).ok).toBe(false);
		expect(parseDetailsRequest('/place/abc', { sessionToken: 'x'.repeat(37) }).ok).toBe(false);
	});

	it('appends a validated languageCode with the correct separator', () => {
		const alone = parseDetailsRequest('/place/abc', { languageCode: 'en-US' });
		if (alone.ok) expect(alone.url).toBe('https://places.googleapis.com/v1/places/abc?languageCode=en-US');

		const both = parseDetailsRequest('/place/abc', { sessionToken: SESSION, languageCode: 'en-US' });
		if (both.ok)
			expect(both.url).toBe(`https://places.googleapis.com/v1/places/abc?sessionToken=${SESSION}&languageCode=en-US`);

		expect(parseDetailsRequest('/place/abc', { languageCode: 'no_good!' }).ok).toBe(false);
	});
});

describe('shapeSuggestions', () => {
	it('returns an empty list for non-object and suggestion-less bodies', () => {
		for (const body of [null, undefined, 'text', 42, {}, { suggestions: 'many' }]) {
			expect(shapeSuggestions(body)).toEqual([]);
		}
	});

	it('shapes valid predictions to exactly placeId and text', () => {
		const shaped = shapeSuggestions({
			suggestions: [{ placePrediction: { placeId: 'ChIJabc', text: { text: '10 Main St' }, extra: 'dropped' } }],
		});

		expect(shaped).toEqual([{ placeId: 'ChIJabc', text: '10 Main St' }]);
		expect(Object.keys(shaped[0]!).sort()).toEqual(['placeId', 'text']);
	});

	it('drops entries with missing, malformed, or contract-violating parts', () => {
		const shaped = shapeSuggestions({
			suggestions: [
				null,
				{},
				{ placePrediction: null },
				{ placePrediction: { placeId: 'a/b', text: { text: 'slash id' } } },
				{ placePrediction: { placeId: 'x'.repeat(513), text: { text: 'oversized id' } } },
				{ placePrediction: { placeId: 'ChIJok', text: null } },
				{ placePrediction: { placeId: 'ChIJok', text: { text: '' } } },
				{ placePrediction: { placeId: 'ChIJok', text: { text: 'kept' } } },
			],
		});

		expect(shaped).toEqual([{ placeId: 'ChIJok', text: 'kept' }]);
	});
});
