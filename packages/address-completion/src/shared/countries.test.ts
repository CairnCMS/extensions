import { describe, expect, it } from 'vitest';
import { ISO_COUNTRY_CODES } from './countries.js';

describe('ISO_COUNTRY_CODES', () => {
	it('holds the 249 officially assigned alpha-2 codes', () => {
		expect(ISO_COUNTRY_CODES.size).toBe(249);
	});

	it('holds only uppercase two-letter codes', () => {
		for (const code of ISO_COUNTRY_CODES) {
			expect(code).toMatch(/^[A-Z]{2}$/);
		}
	});

	it('contains representative assigned codes', () => {
		for (const code of ['US', 'GB', 'DE', 'JP', 'BR', 'ZA', 'AX', 'SS', 'CW']) {
			expect(ISO_COUNTRY_CODES.has(code)).toBe(true);
		}
	});

	it('excludes unassigned and non-ISO values', () => {
		for (const code of ['ZZ', 'AA', 'XX', 'UK', 'EU', 'XK']) {
			expect(ISO_COUNTRY_CODES.has(code)).toBe(false);
		}
	});
});
