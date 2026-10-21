import { describe, expect, it, vi } from 'vitest';

vi.mock('libphonenumber-js/max', () => ({
	isSupportedCountry: () => true,
	parsePhoneNumberFromString: () => {
		throw new Error('library exploded');
	},
}));

import { FormatterError } from '../src/lib/errors.js';
import type { TransformContext } from '../src/lib/registry.js';
import { phoneTransforms } from '../src/lib/transforms/phone.js';

const ctx: TransformContext = { icu: { normalize: true, casing: true, formatting: true } };

function get(id: string) {
	const def = phoneTransforms.find((transform) => transform.id === id);
	if (!def) throw new Error(`no transform ${id}`);
	return def;
}

function caught(fn: () => unknown): FormatterError {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(FormatterError);
		return error as FormatterError;
	}

	throw new Error('expected a rejection');
}

describe('phone transforms classify an unexpected library failure as internal, not bad input', () => {
	it('phone.format classifies an unexpected library failure as INTERNAL', () => {
		expect(caught(() => get('phone.format').prepare({ region: 'US' }, ctx)('623-234-9012')).code).toBe('INTERNAL');
	});

	it('phone.validate classifies an unexpected library failure as INTERNAL', () => {
		expect(caught(() => get('phone.validate').prepare({ region: 'US' }, ctx)('623-234-9012')).code).toBe('INTERNAL');
	});
});
