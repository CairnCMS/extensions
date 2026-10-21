import { BOUNDS } from './bounds.js';
import { FormatterError } from './errors.js';

export type IcuCapability = 'normalize' | 'casing' | 'formatting';

export interface IcuCapabilities {
	normalize: boolean;
	casing: boolean;
	formatting: boolean;
}

function guard(probe: () => boolean): boolean {
	try {
		return probe();
	} catch {
		return false;
	}
}

function probeNormalize(): boolean {
	return 'é'.normalize('NFC') === 'é';
}

function probeCasing(): boolean {
	return 'i'.toLocaleUpperCase('tr') === 'İ';
}

function probeFormatting(): boolean {
	return new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' }).format(new Date(9e8)) === 'enero';
}

let cached: IcuCapabilities | undefined;

export function detectIcuCapabilities(): IcuCapabilities {
	if (cached === undefined) {
		cached = {
			normalize: guard(probeNormalize),
			casing: guard(probeCasing),
			formatting: guard(probeFormatting),
		};
	}

	return cached;
}

export function resetIcuCapabilitiesCache(): void {
	cached = undefined;
}

const CAPABILITY_REASON: Record<IcuCapability, string> = {
	normalize:
		'Unicode normalization is unavailable in this Node build (built without Intl). Use an Intl-enabled Node build.',
	casing:
		'locale-sensitive casing is unavailable in this Node build (built without Intl). Use an Intl-enabled Node build.',
	formatting:
		'locale-aware formatting requires full ICU, which this Node build does not provide. Use a full-ICU Node build.',
};

export function requireCapability(caps: IcuCapabilities, capability: IcuCapability, transform: string): void {
	if (caps[capability] !== true) {
		throw new FormatterError('ICU_UNAVAILABLE', CAPABILITY_REASON[capability], { transform });
	}
}

export function requireValidLocale(locale: string, transform: string): void {
	if (locale.length > BOUNDS.maxLocaleIdentifierLength) {
		throw new FormatterError('INVALID_OPTION', 'locale identifier is too long', { transform });
	}

	try {
		Intl.getCanonicalLocales(locale);
	} catch {
		throw new FormatterError('INVALID_OPTION', 'locale is not a valid BCP 47 tag', { transform });
	}
}

export function requireValidTimeZone(timeZone: string, transform: string): void {
	if (timeZone.length > BOUNDS.maxLocaleIdentifierLength) {
		throw new FormatterError('INVALID_OPTION', 'time zone identifier is too long', { transform });
	}

	try {
		new Intl.DateTimeFormat('en', { timeZone });
	} catch {
		throw new FormatterError('INVALID_OPTION', 'time zone is not a valid IANA identifier', { transform });
	}
}
