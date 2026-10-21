export interface OptionChoice {
	value: string;
	text: string;
}

export type OptionType = 'string' | 'integer' | 'boolean' | 'json';

export type OptionInterface = 'input' | 'select-dropdown' | 'boolean' | 'input-code' | 'list';

export type RevealClause =
	| { option: string; value: string }
	| { option: string; oneOf: readonly string[] }
	| { option: string; filled: true };

export interface TransformOption {
	key: string;
	label: string;
	type: OptionType;
	interface: OptionInterface;
	choices?: readonly OptionChoice[];
	allowNone?: boolean;
	placeholder?: string;
	note?: string;
	defaultValue?: string | number | boolean;
	required?: boolean;
	revealWhen?: readonly RevealClause[];
	rowFields?: readonly TransformOption[];
}

export interface TransformManifestEntry {
	id: string;
	category: string;
	label: string;
	acceptsWhenEmpty: boolean;
	fieldEligible?: boolean;
	options: readonly TransformOption[];
}

export function transportFieldName(transformId: string, optionKey: string): string {
	return `${transformId.replace(/[.-]/g, '_')}__${optionKey}`;
}

export function manifestOptionKeys(entry: TransformManifestEntry): string[] {
	return entry.options.map((option) => option.key);
}

type Extra = Pick<TransformOption, 'placeholder' | 'note' | 'defaultValue' | 'required' | 'revealWhen'>;

function text(key: string, label: string, extra: Extra = {}): TransformOption {
	return { key, label, type: 'string', interface: 'input', ...extra };
}

function integer(key: string, label: string, extra: Extra = {}): TransformOption {
	return { key, label, type: 'integer', interface: 'input', ...extra };
}

function toggle(key: string, label: string, extra: Extra = {}): TransformOption {
	return { key, label, type: 'boolean', interface: 'boolean', ...extra };
}

const CHOICE_LABELS: Record<string, string> = {
	e164: 'E.164',
	rfc3966: 'RFC 3966',
	iso: 'ISO',
	'epoch-seconds': 'Epoch seconds',
	'epoch-milliseconds': 'Epoch milliseconds',
	'half-up': 'Half up',
	'half-even': 'Half even',
	'toward-zero': 'Toward zero',
	'away-from-zero': 'Away from zero',
	shortOffset: 'Short offset',
	longOffset: 'Long offset',
	shortGeneric: 'Short generic',
	longGeneric: 'Long generic',
};

function choiceLabel(value: string): string {
	return CHOICE_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

function select(
	key: string,
	label: string,
	values: readonly string[],
	extra: Extra & { allowNone?: boolean } = {}
): TransformOption {
	const { allowNone = true, ...rest } = extra;
	const choices = values.map((value) => ({ value, text: choiceLabel(value) }));
	return { key, label, type: 'string', interface: 'select-dropdown', choices, allowNone, ...rest };
}

function rows(key: string, label: string, rowFields: readonly TransformOption[], extra: Extra = {}): TransformOption {
	return { key, label, type: 'json', interface: 'list', rowFields, ...extra };
}

const LOCALE = text('locale', 'Locale', { placeholder: 'en-US', required: true });
const OPTIONAL_LOCALE = text('locale', 'Locale', { placeholder: 'en-US' });
const REGION = text('region', 'Default region', { placeholder: 'US', required: true });

const INPUT_KIND = select('inputKind', 'Input kind', ['instant', 'date', 'epoch-seconds', 'epoch-milliseconds'], {
	allowNone: false,
	required: true,
});

const NON_DATE_KINDS = ['instant', 'epoch-seconds', 'epoch-milliseconds'];

const DATE_STYLES = ['full', 'long', 'medium', 'short'];
const TEXT_WIDTHS = ['long', 'short', 'narrow'];
const NUMERIC_PARTS = ['numeric', '2-digit'];

function hourCycleOption(): TransformOption {
	return {
		key: 'hourCycle',
		label: 'Hour cycle',
		type: 'string',
		interface: 'select-dropdown',
		choices: [
			{ value: 'h12', text: 'h12 (1 to 12)' },
			{ value: 'h23', text: 'h23 (0 to 23)' },
			{ value: 'h11', text: 'h11 (0 to 11)' },
			{ value: 'h24', text: 'h24 (1 to 24)' },
		],
		allowNone: true,
		placeholder: 'Locale default',
	};
}

interface DateGate {
	always: readonly RevealClause[];
	time: readonly RevealClause[];
}

function withReveal(option: TransformOption, clauses: readonly RevealClause[]): TransformOption {
	return { ...option, revealWhen: clauses };
}

function dateFormattingOptions(gate: DateGate): readonly TransformOption[] {
	const presetGroup: RevealClause = { option: 'formatStyle', value: 'preset' };
	const componentGroup: RevealClause = { option: 'formatStyle', value: 'components' };

	const preset = (option: TransformOption, time: boolean) =>
		withReveal(option, [...gate.always, ...(time ? gate.time : []), presetGroup]);

	const component = (option: TransformOption, time: boolean) =>
		withReveal(option, [...gate.always, ...(time ? gate.time : []), componentGroup]);

	return [
		preset(select('dateStyle', 'Date style', DATE_STYLES), false),
		preset(select('timeStyle', 'Time style', DATE_STYLES), true),
		component(select('weekday', 'Weekday', TEXT_WIDTHS), false),
		component(select('era', 'Era', TEXT_WIDTHS), false),
		component(select('year', 'Year', NUMERIC_PARTS), false),
		component(select('month', 'Month', ['numeric', '2-digit', 'long', 'short', 'narrow']), false),
		component(select('day', 'Day', NUMERIC_PARTS), false),
		component(select('hour', 'Hour', NUMERIC_PARTS), true),
		component(select('minute', 'Minute', NUMERIC_PARTS), true),
		component(select('second', 'Second', NUMERIC_PARTS), true),
		component(
			select('timeZoneName', 'Time zone name', [
				'long',
				'short',
				'shortOffset',
				'longOffset',
				'shortGeneric',
				'longGeneric',
			]),
			true
		),
		withReveal(hourCycleOption(), [...gate.always, ...gate.time]),
	];
}

function formatStyleOption(always: readonly RevealClause[]): TransformOption {
	const option = select('formatStyle', 'Format style', ['preset', 'components'], {
		allowNone: false,
		defaultValue: 'preset',
	});

	return always.length > 0 ? withReveal(option, always) : option;
}

const DATE_FORMAT_GATE: DateGate = { always: [], time: [{ option: 'inputKind', oneOf: NON_DATE_KINDS }] };
const DATE_NOW_GATE: DateGate = { always: [{ option: 'locale', filled: true }], time: [] };

const DATE_FORMAT_OPTIONS: readonly TransformOption[] = [
	INPUT_KIND,
	LOCALE,
	text('timeZone', 'Time zone', {
		placeholder: 'UTC',
		note: 'IANA zone.',
		required: true,
		revealWhen: [{ option: 'inputKind', oneOf: NON_DATE_KINDS }],
	}),
	formatStyleOption([]),
	...dateFormattingOptions(DATE_FORMAT_GATE),
];

const DATE_NOW_OPTIONS: readonly TransformOption[] = [
	OPTIONAL_LOCALE,
	text('timeZone', 'Time zone', {
		placeholder: 'UTC',
		note: 'IANA zone.',
		required: true,
		revealWhen: [{ option: 'locale', filled: true }],
	}),
	formatStyleOption([{ option: 'locale', filled: true }]),
	...dateFormattingOptions(DATE_NOW_GATE),
];

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

const PLURAL_FORM_PLACEHOLDERS: Record<string, string> = { one: 'item', other: 'items' };

const PLURAL_FORM_OPTIONS: readonly TransformOption[] = PLURAL_CATEGORIES.map((category) => {
	const placeholder = PLURAL_FORM_PLACEHOLDERS[category];
	const label = category.charAt(0).toUpperCase() + category.slice(1);

	const note =
		category === 'other'
			? 'Word for the "other" category and the fallback when another category is left blank.'
			: `Word for the "${category}" plural category.`;

	return text(category, label, { note, required: category === 'other', ...(placeholder ? { placeholder } : {}) });
});

export const TRANSFORM_MANIFEST: readonly TransformManifestEntry[] = [
	{
		id: 'text.trim',
		category: 'text',
		label: 'Text: Trim',
		acceptsWhenEmpty: true,
		options: [toggle('collapse', 'Collapse internal whitespace')],
	},
	{ id: 'text.normalize', category: 'text', label: 'Text: Normalize', acceptsWhenEmpty: true, options: [] },
	{
		id: 'text.uppercase',
		category: 'text',
		label: 'Text: Uppercase',
		acceptsWhenEmpty: true,
		options: [OPTIONAL_LOCALE],
	},
	{
		id: 'text.lowercase',
		category: 'text',
		label: 'Text: Lowercase',
		acceptsWhenEmpty: true,
		options: [OPTIONAL_LOCALE],
	},
	{
		id: 'text.truncate',
		category: 'text',
		label: 'Text: Truncate',
		acceptsWhenEmpty: true,
		options: [integer('maxLength', 'Maximum length', { required: true }), toggle('ellipsis', 'Append ellipsis')],
	},
	{
		id: 'text.replace',
		category: 'text',
		label: 'Text: Replace',
		acceptsWhenEmpty: true,
		options: [text('find', 'Find', { required: true }), text('replaceWith', 'Replace with')],
	},
	{ id: 'text.slugify', category: 'text', label: 'Text: Slugify', acceptsWhenEmpty: true, options: [] },
	{
		id: 'phone.format',
		category: 'phone',
		label: 'Phone: Format',
		acceptsWhenEmpty: true,
		options: [
			REGION,
			select('format', 'Output format', ['e164', 'international', 'national', 'rfc3966'], {
				placeholder: 'Default: E.164',
			}),
		],
	},
	{
		id: 'phone.validate',
		category: 'phone',
		label: 'Phone: Validate',
		acceptsWhenEmpty: false,
		fieldEligible: false,
		options: [REGION],
	},
	{
		id: 'number.round',
		category: 'number',
		label: 'Number: Round',
		acceptsWhenEmpty: true,
		options: [
			integer('scale', 'Decimal places', { required: true }),
			select('mode', 'Rounding mode', ['half-up', 'half-even', 'toward-zero', 'away-from-zero'], {
				placeholder: 'Default: Half up',
			}),
			select('output', 'Output type', ['string', 'number'], { placeholder: 'Default: String' }),
		],
	},
	{
		id: 'number.format',
		category: 'number',
		label: 'Number: Format',
		acceptsWhenEmpty: true,
		options: [
			LOCALE,
			select('style', 'Style', ['decimal', 'currency', 'percent', 'unit'], { placeholder: 'Default: Decimal' }),
			text('currency', 'Currency code', {
				placeholder: 'USD',
				required: true,
				revealWhen: [{ option: 'style', value: 'currency' }],
			}),
			text('unit', 'Unit', {
				placeholder: 'kilometer',
				required: true,
				revealWhen: [{ option: 'style', value: 'unit' }],
			}),
			select('notation', 'Notation', ['standard', 'compact'], { placeholder: 'Default: Standard' }),
			select('percentScale', 'Percent input scale', ['fraction', 'points'], {
				note: 'fraction reads 0.25 as 25%. points reads 25 as 25%.',
				required: true,
				revealWhen: [{ option: 'style', value: 'percent' }],
			}),
			integer('minimumFractionDigits', 'Minimum decimal places'),
			integer('maximumFractionDigits', 'Maximum decimal places'),
		],
	},
	{ id: 'date.format', category: 'date', label: 'Date: Format', acceptsWhenEmpty: true, options: DATE_FORMAT_OPTIONS },
	{
		id: 'date.parse',
		category: 'date',
		label: 'Date: Convert',
		acceptsWhenEmpty: true,
		options: [
			INPUT_KIND,
			select('output', 'Output', ['iso', 'epoch-seconds', 'epoch-milliseconds'], {
				placeholder: 'Default: ISO',
				revealWhen: [{ option: 'inputKind', oneOf: NON_DATE_KINDS }],
			}),
		],
	},
	{ id: 'date.now', category: 'date', label: 'Date: Now', acceptsWhenEmpty: false, options: DATE_NOW_OPTIONS },
	{
		id: 'date.relative',
		category: 'date',
		label: 'Date: Relative',
		acceptsWhenEmpty: true,
		options: [
			LOCALE,
			select('unit', 'Unit', ['year', 'quarter', 'month', 'week', 'day', 'hour', 'minute', 'second'], {
				allowNone: false,
				required: true,
			}),
			select('numeric', 'Numeric', ['always', 'auto'], { placeholder: 'Default: Always' }),
			select('style', 'Style', TEXT_WIDTHS, { placeholder: 'Default: Long' }),
		],
	},
	{ id: 'date.range', category: 'date', label: 'Date: Range', acceptsWhenEmpty: true, options: DATE_FORMAT_OPTIONS },
	{
		id: 'locale.list',
		category: 'locale',
		label: 'Locale: List',
		acceptsWhenEmpty: true,
		options: [
			LOCALE,
			select('type', 'Type', ['conjunction', 'disjunction', 'unit'], { placeholder: 'Default: Conjunction' }),
			select('style', 'Style', TEXT_WIDTHS, { placeholder: 'Default: Long' }),
		],
	},
	{
		id: 'locale.display-name',
		category: 'locale',
		label: 'Locale: Display name',
		acceptsWhenEmpty: true,
		options: [
			LOCALE,
			select('type', 'Type', ['region', 'language', 'script', 'currency'], { allowNone: false, required: true }),
		],
	},
	{
		id: 'locale.plural',
		category: 'locale',
		label: 'Locale: Plural',
		acceptsWhenEmpty: true,
		options: [
			LOCALE,
			...PLURAL_FORM_OPTIONS,
			select('type', 'Type', ['cardinal', 'ordinal'], { placeholder: 'Default: Cardinal' }),
		],
	},
	{
		id: 'lookup.table',
		category: 'lookup',
		label: 'Lookup: Table',
		acceptsWhenEmpty: false,
		options: [
			rows('table', 'Lookup table', [text('key', 'Key'), text('value', 'Value')], { required: true }),
			text('fallback', 'Fallback', { note: 'Returned when no row matches. Without it an unmatched input fails.' }),
			toggle('caseSensitive', 'Case sensitive', { defaultValue: true }),
		],
	},
];

const FIELD_RULE_INELIGIBLE_IDS = new Set(
	TRANSFORM_MANIFEST.filter((entry) => entry.fieldEligible === false).map((entry) => entry.id)
);

export function isFieldRuleEligible(id: string): boolean {
	return !FIELD_RULE_INELIGIBLE_IDS.has(id);
}
