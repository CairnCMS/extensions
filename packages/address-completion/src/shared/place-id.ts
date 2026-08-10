export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

export function isValidPlaceId(value: unknown): value is string {
	return typeof value === 'string' && PLACE_ID_PATTERN.test(value);
}
