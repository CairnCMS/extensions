import { type CountryCode, isSupportedCountry, parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { coerceInputString, coerceOptionalString, coerceString } from '../coerce.js';
import { FormatterError } from '../errors.js';
import type { TransformDefinition } from '../registry.js';

const OUTPUT_FORMATS: Record<string, 'E.164' | 'INTERNATIONAL' | 'NATIONAL' | 'RFC3966'> = {
	e164: 'E.164',
	international: 'INTERNATIONAL',
	national: 'NATIONAL',
	rfc3966: 'RFC3966',
};

function coerceRegion(options: Record<string, unknown>, transform: string): CountryCode {
	const region = coerceString(options['region'], 'region', transform);

	if (!/^[A-Z]{2}$/.test(region) || !isSupportedCountry(region)) {
		throw new FormatterError('INVALID_OPTION', 'option "region" must be a supported two-letter ISO country code', {
			transform,
		});
	}

	return region as CountryCode;
}

const format: TransformDefinition = {
	id: 'phone.format',
	category: 'phone',
	optionKeys: ['region', 'format'],
	prepare(options, _ctx) {
		const id = this.id;
		const region = coerceRegion(options, id);
		const key = (coerceOptionalString(options['format'], 'format', id) ?? 'e164').toLowerCase();
		const output = OUTPUT_FORMATS[key];

		if (output === undefined) {
			throw new FormatterError('INVALID_OPTION', 'option "format" must be e164, international, national, or rfc3966', {
				transform: id,
			});
		}

		return (value) => {
			const input = coerceInputString(value, id);

			let parsed;

			try {
				parsed = parsePhoneNumberFromString(input, region);
			} catch {
				throw new FormatterError('INTERNAL', 'the phone number library failed unexpectedly', { transform: id });
			}

			if (!parsed || !parsed.isValid()) {
				throw new FormatterError('INVALID_INPUT', 'not a valid phone number for the region', { transform: id });
			}

			if (parsed.ext && output === 'E.164') {
				throw new FormatterError('INVALID_INPUT', 'the phone number has an extension that E.164 cannot represent', {
					transform: id,
				});
			}

			return parsed.format(output);
		};
	},
};

const validate: TransformDefinition = {
	id: 'phone.validate',
	category: 'phone',
	optionKeys: ['region'],
	prepare(options, _ctx) {
		const id = this.id;
		const region = coerceRegion(options, id);

		return (value) => {
			const input = coerceInputString(value, id);

			let parsed;

			try {
				parsed = parsePhoneNumberFromString(input, region);
			} catch {
				throw new FormatterError('INTERNAL', 'the phone number library failed unexpectedly', { transform: id });
			}

			if (parsed && parsed.isValid()) {
				return { value: parsed.number, extension: parsed.ext ?? null, valid: true, possible: true };
			}

			return { value: null, extension: null, valid: false, possible: parsed ? parsed.isPossible() : false };
		};
	},
};

export const phoneTransforms: TransformDefinition[] = [format, validate];
