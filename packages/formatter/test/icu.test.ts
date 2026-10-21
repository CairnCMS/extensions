import { afterEach, describe, expect, it } from 'vitest';
import { BOUNDS } from '../src/lib/bounds.js';
import { FormatterError } from '../src/lib/errors.js';
import {
	detectIcuCapabilities,
	requireCapability,
	requireValidLocale,
	requireValidTimeZone,
	resetIcuCapabilitiesCache,
	type IcuCapabilities,
} from '../src/lib/icu.js';

afterEach(() => resetIcuCapabilitiesCache());

function rejection(fn: () => unknown): FormatterError {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(FormatterError);
		return error as FormatterError;
	}

	throw new Error('expected a rejection');
}

describe('detectIcuCapabilities', () => {
	it('reports all three capabilities as booleans and caches the result', () => {
		const first = detectIcuCapabilities();
		expect(typeof first.normalize).toBe('boolean');
		expect(typeof first.casing).toBe('boolean');
		expect(typeof first.formatting).toBe('boolean');
		expect(detectIcuCapabilities()).toBe(first);
	});

	it('passes all three probes on this full-ICU test runtime', () => {
		expect(detectIcuCapabilities()).toEqual({ normalize: true, casing: true, formatting: true });
	});

	it('resolves a throwing probe to capability-unavailable instead of failing to load', () => {
		const original = Intl.DateTimeFormat;

		(Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = function () {
			throw new Error('no ICU in this build');
		};

		try {
			resetIcuCapabilitiesCache();
			expect(detectIcuCapabilities().formatting).toBe(false);
		} finally {
			(Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = original;
			resetIcuCapabilitiesCache();
		}
	});
});

describe('requireCapability', () => {
	const absent: IcuCapabilities = { normalize: false, casing: false, formatting: false };
	const present: IcuCapabilities = { normalize: true, casing: true, formatting: true };

	it('throws a remediable FormatterError when the capability is absent', () => {
		try {
			requireCapability(absent, 'formatting', 'date.format');
			throw new Error('expected throw');
		} catch (error) {
			expect(error).toBeInstanceOf(FormatterError);
			expect((error as FormatterError).code).toBe('ICU_UNAVAILABLE');
			expect((error as Error).message).toMatch(/full ICU/);
		}
	});

	it('does not throw when the capability is present', () => {
		expect(() => requireCapability(present, 'normalize', 'text.normalize')).not.toThrow();
	});
});

describe('locale and time zone validation', () => {
	it('accepts valid locales and rejects invalid or over-long ones', () => {
		expect(() => requireValidLocale('de-DE', 'number.format')).not.toThrow();
		expect(() => requireValidLocale('not a locale!', 'number.format')).toThrow(/valid BCP 47/);
		expect(() => requireValidLocale('a'.repeat(65), 'number.format')).toThrow(/too long/);
	});

	it('accepts valid IANA time zones and rejects invalid ones', () => {
		expect(() => requireValidTimeZone('Europe/Berlin', 'date.format')).not.toThrow();
		expect(() => requireValidTimeZone('Mars/Phobos', 'date.format')).toThrow(/valid IANA/);
	});

	it('accepts locales the runtime canonicalizes or falls back from', () => {
		expect(() => requireValidLocale('iw-IL', 'number.format')).not.toThrow();
		expect(() => requireValidLocale('en-Latn-US', 'number.format')).not.toThrow();
	});

	it('accepts a valid locale one below and at the identifier length limit and refuses one more character', () => {
		const limit = BOUNDS.maxLocaleIdentifierLength;

		const privateUseTag = (length: number): string => {
			let tag = 'en-x';
			while (tag.length + 9 <= length) tag += '-aaaaaaaa';
			return `${tag}-${'a'.repeat(length - tag.length - 1)}`;
		};

		for (const length of [limit - 1, limit]) {
			expect(privateUseTag(length)).toHaveLength(length);
			expect(() => requireValidLocale(privateUseTag(length), 'number.format')).not.toThrow();
		}

		const error = rejection(() => requireValidLocale(`${privateUseTag(limit)}a`, 'number.format'));
		expect(error.code).toBe('INVALID_OPTION');
		expect(error.message).toMatch(/locale identifier is too long/);
	});

	it('checks a time zone at the identifier length limit as a zone and refuses one more character by length', () => {
		const limit = BOUNDS.maxLocaleIdentifierLength;

		const atLimit = rejection(() => requireValidTimeZone('A'.repeat(limit), 'date.format'));
		expect(atLimit.code).toBe('INVALID_OPTION');
		expect(atLimit.message).toMatch(/not a valid IANA identifier/);

		const overLimit = rejection(() => requireValidTimeZone('A'.repeat(limit + 1), 'date.format'));
		expect(overLimit.code).toBe('INVALID_OPTION');
		expect(overLimit.message).toMatch(/time zone identifier is too long/);
	});
});
