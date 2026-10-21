import { describe, expect, it } from 'vitest';
import operation from '../src/api/index.js';
import { FormatterError } from '../src/lib/errors.js';
import { registerTransform } from '../src/lib/registry.js';

class FakeInvalidPayload extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FakeInvalidPayload';
	}
}

const hostContext = { exceptions: { InvalidPayloadException: FakeInvalidPayload } };

function throwingTransform(id: string, error: unknown): void {
	registerTransform({
		id,
		category: 'test',
		optionKeys: [],
		prepare: () => () => {
			throw error;
		},
	});
}

function thrownBy(transform: string, context: unknown = hostContext): unknown {
	try {
		operation.handler({ mode: 'value', value: 'x', transform } as never, context as never);
	} catch (error) {
		return error;
	}

	throw new Error('expected a rejection');
}

describe('operation error adapter', () => {
	it('maps a genuine INVALID_INPUT to the host InvalidPayloadException with the clean reason', () => {
		throwingTransform('test.err_input', new FormatterError('INVALID_INPUT', 'the value is not acceptable'));

		const error = thrownBy('test.err_input');
		expect(error).toBeInstanceOf(FakeInvalidPayload);
		expect(error).not.toBeInstanceOf(FormatterError);
		expect((error as Error).message).toBe('the value is not acceptable');
	});

	it('rethrows a configuration error (INVALID_OPTION) as the same instance', () => {
		const original = new FormatterError('INVALID_OPTION', 'misconfigured');
		throwingTransform('test.err_config', original);

		expect(thrownBy('test.err_config')).toBe(original);
	});

	it('rethrows an unexpected internal fault (INTERNAL) as the same instance', () => {
		const original = new FormatterError('INTERNAL', 'boom');
		throwingTransform('test.err_internal', original);

		expect(thrownBy('test.err_internal')).toBe(original);
	});

	it('rethrows a non-Formatter error as the same instance', () => {
		const original = new Error('raw failure');
		throwingTransform('test.err_raw', original);

		expect(thrownBy('test.err_raw')).toBe(original);
	});

	it('rethrows the original error when no host exceptions are available', () => {
		const original = new FormatterError('INVALID_INPUT', 'still bad');
		throwingTransform('test.err_nocontext', original);

		expect(thrownBy('test.err_nocontext', {})).toBe(original);
	});
});
