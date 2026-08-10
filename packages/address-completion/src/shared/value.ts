import { isValidPlaceId } from './place-id.js';

export type AddressComponents = {
	locality?: string;
	region?: string;
	postalCode?: string;
	countryCode?: string;
};

export type AddressLocation = {
	latitude: number;
	longitude: number;
	observedAt: string;
};

export type SelectedAddress = {
	version: 1;
	formattedAddress: string;
	placeId: string;
	location: AddressLocation;
	components?: AddressComponents;
};

export type ManualAddress = {
	version: 1;
	formattedAddress: string;
};

export type AddressValue = SelectedAddress | ManualAddress;

export type ValueVariant = 'selected' | 'manual' | 'empty' | 'foreign';

const SELECTED_KEYS = new Set(['version', 'formattedAddress', 'placeId', 'location', 'components']);
const MANUAL_KEYS = new Set(['version', 'formattedAddress']);
const LOCATION_KEYS = new Set(['latitude', 'longitude', 'observedAt']);
const COMPONENT_KEYS = new Set(['locality', 'region', 'postalCode', 'countryCode']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keysWithin(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(record).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isIsoUtcTimestamp(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const time = Date.parse(value);
	if (Number.isNaN(time)) return false;
	return new Date(time).toISOString() === value;
}

function isValidLatitude(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

function isValidLocation(value: unknown): value is AddressLocation {
	if (!isRecord(value) || !keysWithin(value, LOCATION_KEYS)) return false;
	return (
		isValidLatitude(value['latitude']) && isValidLongitude(value['longitude']) && isIsoUtcTimestamp(value['observedAt'])
	);
}

function isValidComponents(value: unknown): value is AddressComponents {
	if (!isRecord(value) || !keysWithin(value, COMPONENT_KEYS)) return false;
	return Object.values(value).every((entry) => isNonEmptyString(entry));
}

export function classifyValue(value: unknown): ValueVariant {
	if (value === null || value === undefined) return 'empty';
	if (!isRecord(value)) return 'foreign';
	if (value['version'] !== 1 || !isNonEmptyString(value['formattedAddress'])) return 'foreign';

	if (value['placeId'] === undefined && value['location'] === undefined && value['components'] === undefined) {
		return keysWithin(value, MANUAL_KEYS) ? 'manual' : 'foreign';
	}

	if (!keysWithin(value, SELECTED_KEYS)) return 'foreign';
	if (!isValidPlaceId(value['placeId'])) return 'foreign';
	if (!isValidLocation(value['location'])) return 'foreign';
	if (value['components'] !== undefined && !isValidComponents(value['components'])) return 'foreign';

	return 'selected';
}

export type MappedPlace =
	| { ok: true; value: SelectedAddress }
	| { ok: false; reason: 'formattedAddress' | 'placeId' | 'location' | 'observedAt' };

type GoogleComponent = { types: string[]; longText?: string; shortText?: string };

function componentText(
	components: GoogleComponent[],
	type: string,
	field: 'longText' | 'shortText'
): string | undefined {
	const match = components.find((component) => component.types.includes(type));
	const text = match?.[field];
	return isNonEmptyString(text) ? text : undefined;
}

function extractComponents(raw: unknown): AddressComponents | undefined {
	if (!Array.isArray(raw)) return undefined;

	const components = raw.filter((entry): entry is GoogleComponent => isRecord(entry) && Array.isArray(entry['types']));

	const extracted: AddressComponents = {};

	const locality =
		componentText(components, 'locality', 'longText') ?? componentText(components, 'postal_town', 'longText');

	const region = componentText(components, 'administrative_area_level_1', 'shortText');
	const postalCode = componentText(components, 'postal_code', 'longText');
	const countryCode = componentText(components, 'country', 'shortText');

	if (locality !== undefined) extracted.locality = locality;
	if (region !== undefined) extracted.region = region;
	if (postalCode !== undefined) extracted.postalCode = postalCode;
	if (countryCode !== undefined) extracted.countryCode = countryCode;

	return Object.keys(extracted).length > 0 ? extracted : undefined;
}

export function mapPlaceDetails(place: unknown, observedAt: unknown): MappedPlace {
	if (!isRecord(place)) return { ok: false, reason: 'formattedAddress' };

	const formattedAddress = place['formattedAddress'];
	if (!isNonEmptyString(formattedAddress)) return { ok: false, reason: 'formattedAddress' };

	const placeId = place['id'];
	if (!isValidPlaceId(placeId)) return { ok: false, reason: 'placeId' };

	const location = place['location'];

	if (!isRecord(location) || !isValidLatitude(location['latitude']) || !isValidLongitude(location['longitude'])) {
		return { ok: false, reason: 'location' };
	}

	if (!isIsoUtcTimestamp(observedAt)) {
		return { ok: false, reason: 'observedAt' };
	}

	const value: SelectedAddress = {
		version: 1,
		formattedAddress,
		placeId,
		location: {
			latitude: location['latitude'] as number,
			longitude: location['longitude'] as number,
			observedAt,
		},
	};

	const components = extractComponents(place['addressComponents']);
	if (components !== undefined) value.components = components;

	return { ok: true, value };
}
