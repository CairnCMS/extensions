// A type-only import. The SDK's runtime entry would bundle its app composables into the server build.
import type { defineOperationApi } from '@cairncms/extensions-sdk';
import type { FormatterOptions } from '../lib/contract.js';
import { FormatterError, isEndUserInputError } from '../lib/errors.js';
import { applyWithEmptyPolicy, coerceEmptyHandling } from '../lib/fallback.js';
import { defaultContext, registerBuiltins } from '../lib/index.js';
import { newBudget, parseValueOptions, readMode } from '../lib/options.js';
import { getTransform } from '../lib/registry.js';
import { cloneAndMeasureResult } from '../lib/result.js';
import { runStructured } from '../lib/structured.js';

registerBuiltins();

function runValueMode(options: FormatterOptions): unknown {
	const parsed = parseValueOptions(options, newBudget());
	const definition = getTransform(parsed.transformId);

	if (definition === undefined) {
		throw new FormatterError('UNKNOWN_TRANSFORM', 'the selected transform is unknown');
	}

	const apply = definition.prepare(parsed.transformOptions, defaultContext());
	const policy = coerceEmptyHandling(parsed.onEmpty, parsed.whenEmpty, parsed.transformId);

	const result = applyWithEmptyPolicy(parsed.value, policy, apply, parsed.transformId);
	return cloneAndMeasureResult(result).value;
}

const operation: ReturnType<typeof defineOperationApi<FormatterOptions>> = {
	id: 'formatter',
	handler: (options, context) => {
		try {
			if (readMode(options) === 'structured') {
				return runStructured(options, defaultContext());
			}

			return runValueMode(options);
		} catch (error) {
			if (error instanceof FormatterError && isEndUserInputError(error.code)) {
				const HostInvalidPayload = context.exceptions?.InvalidPayloadException as
					| (new (message: string) => Error)
					| undefined;

				if (HostInvalidPayload) throw new HostInvalidPayload(error.reason);
			}

			throw error;
		}
	},
};

export default operation;
