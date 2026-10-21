import { FormatterError, type FormatterErrorCode } from './errors.js';

export function isCanonicalArrayIndex(name: string, length: number): boolean {
	const index = Number(name);
	return Number.isInteger(index) && index >= 0 && index < length && String(index) === name;
}

export function assertDenseDataArray(
	value: unknown[],
	transform: string,
	code: FormatterErrorCode,
	reason: string
): void {
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new FormatterError(code, reason, { transform });
	}

	for (const name of Object.getOwnPropertyNames(value)) {
		if (name === 'length') continue;

		if (!isCanonicalArrayIndex(name, value.length)) {
			throw new FormatterError(code, reason, { transform });
		}
	}
}
