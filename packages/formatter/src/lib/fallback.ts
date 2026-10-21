import { BOUNDS } from './bounds.js';
import type { EmptyHandling } from './contract.js';
import { FormatterError } from './errors.js';
import { TRANSFORM_MANIFEST } from './transport.js';

const INPUT_HANDLING = new Set(TRANSFORM_MANIFEST.filter((entry) => !entry.acceptsWhenEmpty).map((entry) => entry.id));

export type EmptyPolicy =
	| { kind: 'run' }
	| { kind: 'skip' }
	| { kind: 'fail' }
	| { kind: 'replace'; value: string | number | boolean }
	| { kind: 'set-null' };

function readEmptyHandling(raw: unknown, transformId: string): EmptyHandling {
	if (raw === undefined || raw === null || raw === '') return 'skip';

	if (raw === 'skip' || raw === 'fail' || raw === 'replace' || raw === 'set-null') return raw;

	throw new FormatterError('INVALID_OPTION', 'option "onEmpty" must be "skip", "fail", "replace", or "set-null"', {
		transform: transformId,
	});
}

function coerceReplacement(raw: unknown, transformId: string): string | number | boolean {
	if (raw === undefined || raw === null) {
		throw new FormatterError(
			'INVALID_OPTION',
			'option "whenEmpty" must hold a replacement value when "onEmpty" is "replace"',
			{
				transform: transformId,
			}
		);
	}

	if (typeof raw === 'boolean') return raw;

	if (typeof raw === 'number') {
		if (!Number.isFinite(raw)) {
			throw new FormatterError('INVALID_OPTION', 'option "whenEmpty" must be a finite number, string, or boolean', {
				transform: transformId,
			});
		}

		return raw;
	}

	if (typeof raw === 'string') {
		if (raw.length > BOUNDS.maxOptionStringLength) {
			throw new FormatterError('BOUND_EXCEEDED', 'option "whenEmpty" string is too long', { transform: transformId });
		}

		return raw;
	}

	throw new FormatterError('INVALID_OPTION', 'option "whenEmpty" must be a finite number, string, or boolean', {
		transform: transformId,
	});
}

export function coerceEmptyHandling(onEmptyRaw: unknown, whenEmptyRaw: unknown, transformId: string): EmptyPolicy {
	const handling = readEmptyHandling(onEmptyRaw, transformId);

	if (INPUT_HANDLING.has(transformId)) return { kind: 'run' };

	if (handling === 'skip') return { kind: 'skip' };
	if (handling === 'fail') return { kind: 'fail' };
	if (handling === 'set-null') return { kind: 'set-null' };

	return { kind: 'replace', value: coerceReplacement(whenEmptyRaw, transformId) };
}

export function isEmptyInput(value: unknown): boolean {
	return value === null || value === '';
}

export function applyWithEmptyPolicy(
	value: unknown,
	policy: EmptyPolicy,
	apply: (value: unknown) => unknown,
	transformId?: string
): unknown {
	if (isEmptyInput(value)) {
		switch (policy.kind) {
			case 'skip':
				return value;
			case 'fail':
				throw new FormatterError('INVALID_INPUT', 'the input is empty and empty handling is set to fail', {
					transform: transformId,
				});
			case 'replace':
				return policy.value;
			case 'set-null':
				return null;
			case 'run':
				return apply(value);
		}
	}

	return apply(value);
}
