import { BOUNDS } from './bounds.js';
import { describeType, FormatterError } from './errors.js';

export function coerceInputString(value: unknown, transform: string): string {
	if (typeof value !== 'string') {
		throw new FormatterError('INVALID_INPUT', `expected a string, got ${describeType(value)}`, { transform });
	}

	if (value.length > BOUNDS.maxInputStringLength) {
		throw new FormatterError('BOUND_EXCEEDED', 'input string is too long', { transform });
	}

	return value;
}

export function coerceInputNumber(value: unknown, transform: string): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;

	if (typeof value === 'string') {
		if (value.length > BOUNDS.maxOptionStringLength) {
			throw new FormatterError('BOUND_EXCEEDED', 'numeric input string is too long', { transform });
		}

		if (value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
	}

	throw new FormatterError('INVALID_INPUT', `expected a number, got ${describeType(value)}`, { transform });
}

export function isAbsent(value: unknown): boolean {
	return value === undefined || value === null;
}

export function coerceString(
	value: unknown,
	name: string,
	transform: string,
	maxLength: number = BOUNDS.maxOptionStringLength
): string {
	if (typeof value !== 'string') {
		throw new FormatterError('INVALID_OPTION', `option "${name}" must be a string`, { transform });
	}

	if (value.length > maxLength) {
		throw new FormatterError('BOUND_EXCEEDED', `option "${name}" is too long`, { transform });
	}

	return value;
}

export function coerceOptionalString(
	value: unknown,
	name: string,
	transform: string,
	maxLength: number = BOUNDS.maxOptionStringLength
): string | undefined {
	if (isAbsent(value)) return undefined;
	return coerceString(value, name, transform, maxLength);
}

export function coerceOptionalBoolean(value: unknown, name: string, transform: string): boolean | undefined {
	if (isAbsent(value)) return undefined;
	if (typeof value === 'boolean') return value;
	throw new FormatterError('INVALID_OPTION', `option "${name}" must be a boolean`, { transform });
}

export function coerceInteger(
	value: unknown,
	name: string,
	transform: string,
	range: { min?: number; max?: number } = {}
): number {
	let n: number;

	if (typeof value === 'number') n = value;
	else if (typeof value === 'string') {
		if (value.length > BOUNDS.maxOptionStringLength) {
			throw new FormatterError('BOUND_EXCEEDED', `option "${name}" is too long`, { transform });
		}

		if (value.trim() === '')
			throw new FormatterError('INVALID_OPTION', `option "${name}" must be an integer`, { transform });
		n = Number(value);
	} else throw new FormatterError('INVALID_OPTION', `option "${name}" must be an integer`, { transform });

	if (!Number.isInteger(n)) {
		throw new FormatterError('INVALID_OPTION', `option "${name}" must be an integer`, { transform });
	}

	if (range.min !== undefined && n < range.min) {
		throw new FormatterError('INVALID_OPTION', `option "${name}" must be at least ${range.min}`, { transform });
	}

	if (range.max !== undefined && n > range.max) {
		throw new FormatterError('INVALID_OPTION', `option "${name}" must be at most ${range.max}`, { transform });
	}

	return n;
}

export function assertOutputLength(length: number, transform: string): void {
	if (length > BOUNDS.maxOutputLength) {
		throw new FormatterError('BOUND_EXCEEDED', 'output is too long', { transform });
	}
}
