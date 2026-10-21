import { detectIcuCapabilities } from './icu.js';
import { registerTransform, type TransformContext } from './registry.js';
import { dateTransforms } from './transforms/date.js';
import { localeTransforms } from './transforms/locale.js';
import { lookupTransforms } from './transforms/lookup.js';
import { numberTransforms } from './transforms/number.js';
import { phoneTransforms } from './transforms/phone.js';
import { textTransforms } from './transforms/text.js';

export const builtinTransforms = [
	...textTransforms,
	...phoneTransforms,
	...numberTransforms,
	...dateTransforms,
	...localeTransforms,
	...lookupTransforms,
];

let registered = false;

export function registerBuiltins(): void {
	if (registered) return;

	for (const transform of builtinTransforms) {
		registerTransform(transform);
	}

	registered = true;
}

export function defaultContext(): TransformContext {
	return { icu: detectIcuCapabilities() };
}
