import { describe, expect, it } from 'vitest';
import { isValidPlaceId } from './place-id.js';

describe('isValidPlaceId', () => {
	it('accepts real place IDs and the length boundary', () => {
		expect(isValidPlaceId('ChIJgU60wNLqwIcRzYBIZgwf1io')).toBe(true);
		expect(isValidPlaceId('a')).toBe(true);
		expect(isValidPlaceId('a'.repeat(512))).toBe(true);
	});

	it('rejects empty, over-length, non-string, and delimiter-bearing values', () => {
		expect(isValidPlaceId('')).toBe(false);
		expect(isValidPlaceId('a'.repeat(513))).toBe(false);
		expect(isValidPlaceId('a/b')).toBe(false);
		expect(isValidPlaceId('../etc')).toBe(false);
		expect(isValidPlaceId('a b')).toBe(false);
		expect(isValidPlaceId('a.b')).toBe(false);
		expect(isValidPlaceId(null)).toBe(false);
		expect(isValidPlaceId(42)).toBe(false);
	});
});
