import { describe, expect, it } from 'vitest';
import { renderTemplate } from './template.js';

const VALUE = {
	version: 1,
	formattedAddress: '12345 College Blvd, Overland Park, KS 66210, USA',
	placeId: 'ChIJok',
	location: { latitude: 38.9249484, longitude: -94.7269431, observedAt: '2026-08-09T14:22:24.388Z' },
	components: { locality: 'Overland Park', region: 'KS', postalCode: '66210', countryCode: 'US' },
};

describe('renderTemplate', () => {
	it('renders top-level and nested dot paths', () => {
		expect(renderTemplate('{{ formattedAddress }}', VALUE)).toBe(VALUE.formattedAddress);
		expect(renderTemplate('{{ components.locality }}, {{ components.region }}', VALUE)).toBe('Overland Park, KS');
		expect(renderTemplate('{{ location.latitude }}', VALUE)).toBe('38.9249484');
	});

	it('renders missing paths as empty text', () => {
		expect(renderTemplate('[{{ components.missing }}]', VALUE)).toBe('[]');
		expect(renderTemplate('[{{ nothing.here }}]', VALUE)).toBe('[]');
	});

	it('renders non-scalar values as empty text', () => {
		expect(renderTemplate('[{{ location }}]', VALUE)).toBe('[]');
		expect(renderTemplate('[{{ components }}]', VALUE)).toBe('[]');
	});

	it('cannot reach prototype properties', () => {
		expect(renderTemplate('[{{ constructor }}]', VALUE)).toBe('[]');
		expect(renderTemplate('[{{ formattedAddress.length }}]', VALUE)).toBe('[]');
		expect(renderTemplate('[{{ __proto__ }}]', VALUE)).toBe('[]');
	});

	it('falls back on malformed paths and templates', () => {
		expect(renderTemplate('{{ components..locality }}', VALUE)).toBeNull();
		expect(renderTemplate('{{ components.locality', VALUE)).toBeNull();
		expect(renderTemplate('{{ a b }}', VALUE)).toBeNull();
		expect(renderTemplate('{{ .locality }}', VALUE)).toBeNull();
	});

	it('falls back on empty and over-length templates', () => {
		expect(renderTemplate('', VALUE)).toBeNull();
		expect(renderTemplate('x'.repeat(1025), VALUE)).toBeNull();
		expect(renderTemplate('x'.repeat(1024), VALUE)).toBe('x'.repeat(1024));
	});
});
