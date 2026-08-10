import { describe, expect, it } from 'vitest';
import { displayText } from './format.js';

const SELECTED = {
	version: 1,
	formattedAddress: '12345 College Blvd, Overland Park, KS 66210, USA',
	placeId: 'ChIJok',
	location: { latitude: 38.9249484, longitude: -94.7269431, observedAt: '2026-08-09T14:22:24.388Z' },
	components: { locality: 'Overland Park', region: 'KS' },
};

const MANUAL = { version: 1, formattedAddress: 'Warehouse dock 3' };

describe('displayText', () => {
	it('renders both record variants as their bare formatted address', () => {
		expect(displayText(SELECTED, null)).toBe(SELECTED.formattedAddress);
		expect(displayText(MANUAL, null)).toBe(MANUAL.formattedAddress);
	});

	it('renders nothing for empty and foreign values', () => {
		expect(displayText(null, null)).toBeNull();
		expect(displayText(undefined, null)).toBeNull();
		expect(displayText({ type: 'Feature' }, null)).toBeNull();
		expect(displayText({ ...MANUAL, extra: 1 }, null)).toBeNull();
	});

	it('applies a valid template', () => {
		expect(displayText(SELECTED, '{{ components.locality }}, {{ components.region }}')).toBe('Overland Park, KS');
	});

	it('falls back to the formatted address on a malformed template', () => {
		expect(displayText(SELECTED, '{{ components..locality }}')).toBe(SELECTED.formattedAddress);
	});

	it('ignores non-string and empty templates', () => {
		expect(displayText(SELECTED, 42)).toBe(SELECTED.formattedAddress);
		expect(displayText(SELECTED, '')).toBe(SELECTED.formattedAddress);
	});
});
