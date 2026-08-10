import { ISO_COUNTRY_CODES } from '../shared/countries.js';
import { isValidPlaceId } from '../shared/place-id.js';

export const PLACES_ORIGIN = 'https://places.googleapis.com';
export const AUTOCOMPLETE_URL = `${PLACES_ORIGIN}/v1/places:autocomplete`;
export const AUTOCOMPLETE_FIELD_MASK = 'suggestions.placePrediction.placeId,suggestions.placePrediction.text';
export const DETAILS_FIELD_MASK = 'id,formattedAddress,location,addressComponents';

const INPUT_MAX_LENGTH = 255;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const COUNTRY_LIMIT = 15;
const BIAS_RADIUS_MIN = 100;
const BIAS_RADIUS_MAX = 50000;

const SCOPE_PRIMARY_TYPES: Record<string, string[] | null> = {
	all: null,
	addresses: ['street_address', 'premise', 'subpremise', 'route', 'postal_code'],
	cities: ['(cities)'],
	regions: ['(regions)'],
};

export type Invalid = { ok: false; message: string };
export type ParsedAutocomplete = { ok: true; outbound: Record<string, unknown> };
export type ParsedDetails = { ok: true; url: string };
export type Suggestion = { placeId: string; text: string };

function invalid(message: string): Invalid {
	return { ok: false, message };
}

export function parseAutocompleteBody(raw: unknown): ParsedAutocomplete | Invalid {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return invalid('the request body must be an object');
	}

	const body = raw as Record<string, unknown>;

	if (typeof body['input'] !== 'string') return invalid('input is required');
	const input = body['input'].trim();

	if (input.length === 0 || input.length > INPUT_MAX_LENGTH) {
		return invalid(`input must be 1 to ${INPUT_MAX_LENGTH} characters after trimming`);
	}

	const sessionToken = body['sessionToken'];

	if (typeof sessionToken !== 'string' || !SESSION_TOKEN_PATTERN.test(sessionToken)) {
		return invalid('sessionToken must be URL-safe and at most 36 characters');
	}

	const outbound: Record<string, unknown> = { input, sessionToken };

	if (body['countries'] !== undefined) {
		const countries = body['countries'];

		if (!Array.isArray(countries)) return invalid('countries must be an array');

		if (countries.length > COUNTRY_LIMIT) {
			return invalid(`countries allows at most ${COUNTRY_LIMIT} codes`);
		}

		const normalized: string[] = [];

		for (const code of countries) {
			if (typeof code !== 'string' || !ISO_COUNTRY_CODES.has(code.toUpperCase())) {
				return invalid('countries must be ISO 3166-1 alpha-2 codes');
			}

			const lowered = code.toLowerCase();
			if (!normalized.includes(lowered)) normalized.push(lowered);
		}

		if (normalized.length > 0) outbound['includedRegionCodes'] = normalized;
	}

	if (body['scope'] !== undefined) {
		const scope = body['scope'];

		if (typeof scope !== 'string' || !Object.hasOwn(SCOPE_PRIMARY_TYPES, scope)) {
			return invalid('scope must be one of all, addresses, cities, regions');
		}

		const primaryTypes = SCOPE_PRIMARY_TYPES[scope];
		if (primaryTypes) outbound['includedPrimaryTypes'] = primaryTypes;
	}

	if (body['bias'] !== undefined) {
		const bias = body['bias'];

		if (typeof bias !== 'object' || bias === null || Array.isArray(bias)) {
			return invalid('bias must be an object');
		}

		const { latitude, longitude, radiusMeters } = bias as Record<string, unknown>;

		if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
			return invalid('bias.latitude must be between -90 and 90');
		}

		if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
			return invalid('bias.longitude must be between -180 and 180');
		}

		if (
			typeof radiusMeters !== 'number' ||
			!Number.isInteger(radiusMeters) ||
			radiusMeters < BIAS_RADIUS_MIN ||
			radiusMeters > BIAS_RADIUS_MAX
		) {
			return invalid(`bias.radiusMeters must be an integer between ${BIAS_RADIUS_MIN} and ${BIAS_RADIUS_MAX}`);
		}

		outbound['locationBias'] = { circle: { center: { latitude, longitude }, radius: radiusMeters } };
	}

	if (body['languageCode'] !== undefined) {
		const languageCode = body['languageCode'];

		if (typeof languageCode !== 'string' || languageCode.length > 35 || !LANGUAGE_PATTERN.test(languageCode)) {
			return invalid('languageCode must be a valid language tag');
		}

		outbound['languageCode'] = languageCode;
	}

	return { ok: true, outbound };
}

export function parseDetailsRequest(path: string, query: Record<string, unknown>): ParsedDetails | Invalid {
	const placeId = path.slice('/place/'.length);

	if (!isValidPlaceId(placeId)) {
		return invalid('the place id must be 1 to 512 URL-safe characters');
	}

	let url = `${PLACES_ORIGIN}/v1/places/${encodeURIComponent(placeId)}`;
	const sessionToken = query['sessionToken'];

	if (sessionToken !== undefined) {
		if (typeof sessionToken !== 'string' || !SESSION_TOKEN_PATTERN.test(sessionToken)) {
			return invalid('sessionToken must be URL-safe and at most 36 characters');
		}

		url += `?sessionToken=${encodeURIComponent(sessionToken)}`;
	}

	const languageCode = query['languageCode'];

	if (languageCode !== undefined) {
		if (typeof languageCode !== 'string' || languageCode.length > 35 || !LANGUAGE_PATTERN.test(languageCode)) {
			return invalid('languageCode must be a valid language tag');
		}

		url += `${url.includes('?') ? '&' : '?'}languageCode=${encodeURIComponent(languageCode)}`;
	}

	return { ok: true, url };
}

export function shapeSuggestions(googleBody: unknown): Suggestion[] {
	if (typeof googleBody !== 'object' || googleBody === null) return [];

	const suggestions = (googleBody as Record<string, unknown>)['suggestions'];
	if (!Array.isArray(suggestions)) return [];

	const shaped: Suggestion[] = [];

	for (const entry of suggestions) {
		if (typeof entry !== 'object' || entry === null) continue;

		const prediction = (entry as Record<string, unknown>)['placePrediction'];
		if (typeof prediction !== 'object' || prediction === null) continue;

		const placeId = (prediction as Record<string, unknown>)['placeId'];
		const text = (prediction as Record<string, unknown>)['text'];
		if (!isValidPlaceId(placeId)) continue;
		if (typeof text !== 'object' || text === null) continue;

		const textValue = (text as Record<string, unknown>)['text'];
		if (typeof textValue !== 'string' || textValue.length === 0) continue;

		shaped.push({ placeId, text: textValue });
	}

	return shaped;
}
