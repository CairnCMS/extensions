import { describe, expect, it, vi } from 'vitest';

vi.mock('big.js', () => ({
	default: class {
		toFixed(): string {
			throw new Error('rounding exploded');
		}
	},
}));

import { FormatterError } from '../src/lib/errors.js';
import type { TransformContext } from '../src/lib/registry.js';
import { numberTransforms } from '../src/lib/transforms/number.js';

const ctx: TransformContext = { icu: { normalize: true, casing: true, formatting: true } };

function round() {
	const def = numberTransforms.find((transform) => transform.id === 'number.round');
	if (!def) throw new Error('no number.round transform');
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

describe('number.round classifies an unexpected rounding failure as internal, not bad input', () => {
	it('an unexpected toFixed failure on a valid number is INTERNAL', () => {
		expect(caught(() => round().prepare({ scale: 2 }, ctx)('1.5')).code).toBe('INTERNAL');
	});
});
