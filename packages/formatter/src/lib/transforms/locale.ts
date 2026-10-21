import { types } from 'node:util';
import { BOUNDS } from '../bounds.js';
import { coerceInputNumber, coerceInputString, coerceOptionalString, coerceString } from '../coerce.js';
import { FormatterError } from '../errors.js';
import { requireCapability, requireValidLocale } from '../icu.js';
import { assertDenseDataArray } from '../plain-array.js';
import type { TransformDefinition } from '../registry.js';

const LIST_TYPES = new Set(['conjunction', 'disjunction', 'unit']);
const LIST_STYLES = new Set(['long', 'short', 'narrow']);
const DISPLAY_TYPES = new Set(['region', 'language', 'script', 'currency']);
const PLURAL_TYPES = new Set(['cardinal', 'ordinal']);
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

const list: TransformDefinition = {
	id: 'locale.list',
	category: 'locale',
	optionKeys: ['locale', 'type', 'style'],
	prepare(options, ctx) {
		const id = this.id;
		requireCapability(ctx.icu, 'formatting', id);
		const locale = coerceString(options['locale'], 'locale', id);
		requireValidLocale(locale, id);

		const listOptions: Intl.ListFormatOptions = {};
		const type = coerceOptionalString(options['type'], 'type', id);

		if (type !== undefined) {
			if (!LIST_TYPES.has(type)) {
				throw new FormatterError('INVALID_OPTION', 'option "type" must be conjunction, disjunction, or unit', {
					transform: id,
				});
			}

			listOptions.type = type as Intl.ListFormatType;
		}

		const style = coerceOptionalString(options['style'], 'style', id);

		if (style !== undefined) {
			if (!LIST_STYLES.has(style)) {
				throw new FormatterError('INVALID_OPTION', 'option "style" must be "long", "short", or "narrow"', {
					transform: id,
				});
			}

			listOptions.style = style as Intl.ListFormatStyle;
		}

		let formatter: Intl.ListFormat;

		try {
			formatter = new Intl.ListFormat(locale, listOptions);
		} catch {
			throw new FormatterError('INVALID_OPTION', 'the list formatting options are invalid', { transform: id });
		}

		return (value) => {
			if (types.isProxy(value) || !Array.isArray(value)) {
				throw new FormatterError('INVALID_INPUT', 'expected an array of strings', { transform: id });
			}

			if (value.length > BOUNDS.maxListItems) {
				throw new FormatterError('BOUND_EXCEEDED', 'the list has too many items', { transform: id });
			}

			assertDenseDataArray(value, id, 'INVALID_INPUT', 'expected an array of strings');

			const items: string[] = [];
			let totalLength = 0;

			for (let index = 0; index < value.length; index += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(value, index);

				if (
					descriptor === undefined ||
					!('value' in descriptor) ||
					!descriptor.enumerable ||
					typeof descriptor.value !== 'string'
				) {
					throw new FormatterError('INVALID_INPUT', 'every list item must be a string', { transform: id, index });
				}

				totalLength += descriptor.value.length;

				if (totalLength > BOUNDS.maxInputStringLength) {
					throw new FormatterError('BOUND_EXCEEDED', 'the list content is too long', { transform: id });
				}

				items.push(descriptor.value);
			}

			return formatter.format(items);
		};
	},
};

const displayName: TransformDefinition = {
	id: 'locale.display-name',
	category: 'locale',
	optionKeys: ['locale', 'type'],
	prepare(options, ctx) {
		const id = this.id;
		requireCapability(ctx.icu, 'formatting', id);
		const locale = coerceString(options['locale'], 'locale', id);
		requireValidLocale(locale, id);
		const type = coerceString(options['type'], 'type', id);

		if (!DISPLAY_TYPES.has(type)) {
			throw new FormatterError('INVALID_OPTION', 'option "type" must be region, language, script, or currency', {
				transform: id,
			});
		}

		let display: Intl.DisplayNames;

		try {
			display = new Intl.DisplayNames(locale, { type: type as Intl.DisplayNamesType, fallback: 'none' });
		} catch {
			throw new FormatterError('INVALID_OPTION', 'the display-name options are invalid', { transform: id });
		}

		return (value) => {
			const code = coerceInputString(value, id);

			let name: string | undefined;

			try {
				name = display.of(code);
			} catch {
				throw new FormatterError('INVALID_INPUT', `the value is not a valid ${type} code`, { transform: id });
			}

			if (name === undefined) {
				throw new FormatterError('INVALID_INPUT', `no ${type} display name exists for the value`, { transform: id });
			}

			return name;
		};
	},
};

const plural: TransformDefinition = {
	id: 'locale.plural',
	category: 'locale',
	optionKeys: ['locale', ...PLURAL_CATEGORIES, 'type'],
	prepare(options, ctx) {
		const id = this.id;
		requireCapability(ctx.icu, 'formatting', id);
		const locale = coerceString(options['locale'], 'locale', id);
		requireValidLocale(locale, id);

		const snapshot = new Map<string, string>();

		for (const category of PLURAL_CATEGORIES) {
			const raw = options[category];
			if (raw === undefined || raw === null || raw === '') continue;
			snapshot.set(category, coerceString(raw, category, id));
		}

		const pluralOptions: Intl.PluralRulesOptions = {};
		const type = coerceOptionalString(options['type'], 'type', id);

		if (type !== undefined) {
			if (!PLURAL_TYPES.has(type)) {
				throw new FormatterError('INVALID_OPTION', 'option "type" must be cardinal or ordinal', { transform: id });
			}

			pluralOptions.type = type as Intl.PluralRuleType;
		}

		let rules: Intl.PluralRules;

		try {
			rules = new Intl.PluralRules(locale, pluralOptions);
		} catch {
			throw new FormatterError('INVALID_OPTION', 'the plural-rule options are invalid', { transform: id });
		}

		if (!snapshot.has('other')) {
			for (const category of rules.resolvedOptions().pluralCategories) {
				if (!snapshot.has(category)) {
					throw new FormatterError(
						'INVALID_OPTION',
						`the "${category}" plural form is missing and there is no "other" fallback`,
						{ transform: id }
					);
				}
			}
		}

		return (value) => {
			const count = coerceInputNumber(value, id);
			const category = rules.select(count);
			const chosen = snapshot.get(category) ?? snapshot.get('other');

			if (chosen === undefined) {
				throw new FormatterError('INVALID_OPTION', `no plural form "${category}" and no "other" fallback`, {
					transform: id,
				});
			}

			return chosen;
		};
	},
};

export const localeTransforms: TransformDefinition[] = [list, displayName, plural];
