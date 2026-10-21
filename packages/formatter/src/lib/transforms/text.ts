import slugify from '@sindresorhus/slugify';
import { BOUNDS } from '../bounds.js';
import {
	assertOutputLength,
	coerceInputString,
	coerceInteger,
	coerceOptionalBoolean,
	coerceOptionalString,
	coerceString,
} from '../coerce.js';
import { FormatterError } from '../errors.js';
import { requireCapability, requireValidLocale } from '../icu.js';
import type { TransformDefinition } from '../registry.js';

function sliceWithoutSplittingSurrogate(input: string, length: number): string {
	if (length >= input.length) return input;
	let cut = length;
	const last = input.charCodeAt(cut - 1);
	if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
	return input.slice(0, cut);
}

const trim: TransformDefinition = {
	id: 'text.trim',
	category: 'text',
	optionKeys: ['collapse'],
	prepare(options, _ctx) {
		const id = this.id;
		const collapse = coerceOptionalBoolean(options['collapse'], 'collapse', id) ?? false;

		return (value) => {
			const trimmed = coerceInputString(value, id).trim();
			return collapse ? trimmed.replace(/\s+/g, ' ') : trimmed;
		};
	},
};

const normalize: TransformDefinition = {
	id: 'text.normalize',
	category: 'text',
	optionKeys: [],
	prepare(_options, ctx) {
		const id = this.id;
		requireCapability(ctx.icu, 'normalize', id);

		return (value) => coerceInputString(value, id).normalize('NFC');
	},
};

const uppercase: TransformDefinition = {
	id: 'text.uppercase',
	category: 'text',
	optionKeys: ['locale'],
	prepare(options, ctx) {
		const id = this.id;
		const locale = coerceOptionalString(options['locale'], 'locale', id);

		if (locale === undefined) return (value) => coerceInputString(value, id).toUpperCase();

		requireCapability(ctx.icu, 'casing', id);
		requireValidLocale(locale, id);
		return (value) => coerceInputString(value, id).toLocaleUpperCase(locale);
	},
};

const lowercase: TransformDefinition = {
	id: 'text.lowercase',
	category: 'text',
	optionKeys: ['locale'],
	prepare(options, ctx) {
		const id = this.id;
		const locale = coerceOptionalString(options['locale'], 'locale', id);

		if (locale === undefined) return (value) => coerceInputString(value, id).toLowerCase();

		requireCapability(ctx.icu, 'casing', id);
		requireValidLocale(locale, id);
		return (value) => coerceInputString(value, id).toLocaleLowerCase(locale);
	},
};

const truncate: TransformDefinition = {
	id: 'text.truncate',
	category: 'text',
	optionKeys: ['maxLength', 'ellipsis'],
	prepare(options, _ctx) {
		const id = this.id;
		const maxLength = coerceInteger(options['maxLength'], 'maxLength', id, { min: 0, max: BOUNDS.maxOutputLength });
		const ellipsis = coerceOptionalBoolean(options['ellipsis'], 'ellipsis', id) ?? false;

		return (value) => {
			const input = coerceInputString(value, id);
			if (input.length <= maxLength) return input;
			if (maxLength === 0) return '';
			if (!ellipsis) return sliceWithoutSplittingSurrogate(input, maxLength);
			return sliceWithoutSplittingSurrogate(input, maxLength - 1) + '…';
		};
	},
};

const replace: TransformDefinition = {
	id: 'text.replace',
	category: 'text',
	optionKeys: ['find', 'replaceWith'],
	prepare(options, _ctx) {
		const id = this.id;
		const find = coerceString(options['find'], 'find', id, BOUNDS.maxReplacementInputLength);

		if (find === '') {
			throw new FormatterError('INVALID_OPTION', 'option "find" must not be empty', { transform: id });
		}

		const replaceWith =
			coerceOptionalString(options['replaceWith'], 'replaceWith', id, BOUNDS.maxReplacementInputLength) ?? '';

		return (value) => {
			const input = coerceInputString(value, id);

			let occurrences = 0;
			let cursor = input.indexOf(find);

			while (cursor !== -1) {
				occurrences += 1;
				cursor = input.indexOf(find, cursor + find.length);
			}

			assertOutputLength(input.length + occurrences * (replaceWith.length - find.length), id);

			return input.split(find).join(replaceWith);
		};
	},
};

const slug: TransformDefinition = {
	id: 'text.slugify',
	category: 'text',
	optionKeys: [],
	prepare(_options, ctx) {
		const id = this.id;
		requireCapability(ctx.icu, 'normalize', id);

		return (value) => slugify(coerceInputString(value, id));
	},
};

export const textTransforms: TransformDefinition[] = [trim, normalize, uppercase, lowercase, truncate, replace, slug];
