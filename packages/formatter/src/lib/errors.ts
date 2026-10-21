export type FormatterErrorCode =
	| 'INVALID_OPTION'
	| 'INVALID_INPUT'
	| 'UNKNOWN_OPTION'
	| 'SOURCE_SHAPE'
	| 'RESULT_SHAPE'
	| 'BOUND_EXCEEDED'
	| 'INVALID_PATH'
	| 'ICU_UNAVAILABLE'
	| 'UNKNOWN_TRANSFORM'
	| 'INTERNAL';

export interface ErrorLocation {
	transform?: string;
	index?: number;
}

export class FormatterError extends Error {
	readonly code: FormatterErrorCode;
	readonly reason: string;
	readonly location: ErrorLocation;

	constructor(code: FormatterErrorCode, reason: string, location: ErrorLocation = {}) {
		const safe: ErrorLocation = {};
		if (typeof location.transform === 'string') safe.transform = location.transform.slice(0, 64);
		if (typeof location.index === 'number' && Number.isInteger(location.index)) safe.index = location.index;

		const where = [
			safe.transform !== undefined ? `[${safe.transform}]` : undefined,
			safe.index !== undefined ? `at index ${safe.index}` : undefined,
		]
			.filter(Boolean)
			.join(' ');

		super(where ? `formatter ${where}: ${reason}` : `formatter: ${reason}`);
		this.name = 'FormatterError';
		this.code = code;
		this.reason = reason;
		this.location = safe;
	}
}

export function withRuleContext(error: unknown, index: number, transformId?: string): unknown {
	if (!(error instanceof FormatterError)) return error;

	const location: ErrorLocation = { ...error.location };
	let enriched = false;

	if (location.index === undefined) {
		location.index = index;
		enriched = true;
	}

	if (location.transform === undefined && transformId !== undefined) {
		location.transform = transformId;
		enriched = true;
	}

	return enriched ? new FormatterError(error.code, error.reason, location) : error;
}

export function isEndUserInputError(code: FormatterErrorCode): boolean {
	return code === 'INVALID_INPUT';
}

export function describeType(value: unknown): string {
	if (value === null) return 'null';

	const kind = typeof value;

	if (kind === 'number' && !Number.isFinite(value)) return 'non-finite number';
	if (kind !== 'object') return kind;

	try {
		if (Array.isArray(value)) return 'array';
	} catch {
		return 'object';
	}

	return 'object';
}
