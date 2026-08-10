import { describe, expect, it } from 'vitest';
import { resolveLanguage } from './language.js';

describe('resolveLanguage', () => {
	it('prefers a valid user language', () => {
		expect(resolveLanguage('pt-BR', 'de-DE')).toBe('pt-BR');
	});

	it('falls back to the project default when the user language is invalid', () => {
		expect(resolveLanguage(null, 'de-DE')).toBe('de-DE');
		expect(resolveLanguage('no good', 'de-DE')).toBe('de-DE');
		expect(resolveLanguage(42, 'de-DE')).toBe('de-DE');
	});

	it('falls back to en-US when both are invalid', () => {
		expect(resolveLanguage(null, undefined)).toBe('en-US');
		expect(resolveLanguage('', 'x'.repeat(36))).toBe('en-US');
		expect(resolveLanguage('en-', '-en')).toBe('en-US');
	});

	it('accepts tags with numeric and long subtags', () => {
		expect(resolveLanguage('es-419', null)).toBe('es-419');
		expect(resolveLanguage('ckb-IR', null)).toBe('ckb-IR');
		expect(resolveLanguage('kmr-TR', null)).toBe('kmr-TR');
	});
});
