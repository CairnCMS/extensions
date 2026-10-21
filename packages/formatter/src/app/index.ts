import { defineOperationApp } from '@cairncms/extensions-sdk';
import { BOUNDS } from '../lib/bounds.js';
import { FIELDS } from '../lib/contract.js';
import {
	isFieldRuleEligible,
	type RevealClause,
	TRANSFORM_MANIFEST,
	transportFieldName,
	type TransformOption,
} from '../lib/transport.js';

type Scope = 'value' | 'rule';

interface Condition {
	name: string;
	rule: Record<string, unknown>;
	hidden: boolean;
	required?: boolean;
}

interface AppField {
	field: string;
	name: string;
	type: 'string' | 'integer' | 'boolean' | 'json';
	meta: {
		width: 'half' | 'full';
		interface: string;
		options?: Record<string, unknown>;
		note?: string;
		hidden?: boolean;
		required?: boolean;
		conditions?: Condition[];
	};
	schema?: { default_value: unknown };
}

const transformChoices = TRANSFORM_MANIFEST.map((entry) => ({ value: entry.id, text: entry.label }));

const ruleTransformChoices = TRANSFORM_MANIFEST.filter((entry) => isFieldRuleEligible(entry.id)).map((entry) => ({
	value: entry.id,
	text: entry.label,
}));

const noEmptyHandlingIds = TRANSFORM_MANIFEST.filter((entry) => !entry.acceptsWhenEmpty).map((entry) => entry.id);

const hiddenForInputHandling: Condition = {
	name: 'transform handles its own empty input',
	rule: { [FIELDS.transform]: { _in: noEmptyHandlingIds } },
	hidden: true,
};

const hiddenInStructured: Condition = {
	name: 'value mode only',
	rule: { [FIELDS.mode]: { _eq: 'structured' } },
	hidden: true,
};

const hiddenInValue: Condition = {
	name: 'structured mode only',
	rule: { [FIELDS.mode]: { _eq: 'value' } },
	hidden: true,
};

function shownWhen(fieldName: string, value: string, required = false): Condition {
	const condition: Condition = {
		name: `${fieldName} is ${value}`,
		rule: { [fieldName]: { _eq: value } },
		hidden: false,
	};

	if (required) condition.required = true;
	return condition;
}

function clauseRules(transformId: string, clause: RevealClause): Record<string, unknown>[] {
	const field = transportFieldName(transformId, clause.option);
	if ('value' in clause) return [{ [field]: { _eq: clause.value } }];
	if ('oneOf' in clause) return [{ [field]: { _in: clause.oneOf } }];
	return [{ [field]: { _nnull: true } }, { [field]: { _nempty: true } }];
}

function shownForClauses(transformId: string, clauses: readonly RevealClause[], required: boolean): Condition {
	const transformRule = { [FIELDS.transform]: { _eq: transformId } };

	if (clauses.length === 0) return shownWhen(FIELDS.transform, transformId, required);

	const condition: Condition = {
		name: `${transformId} with ${clauses.map((clause) => clause.option).join(', ')}`,
		rule: { _and: [transformRule, ...clauses.flatMap((clause) => clauseRules(transformId, clause))] },
		hidden: false,
	};

	if (required) condition.required = true;
	return condition;
}

function compact<T extends Record<string, unknown>>(object: T): T {
	return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;
}

function interfaceOptions(option: TransformOption): Record<string, unknown> {
	switch (option.interface) {
		case 'select-dropdown':
			return compact({ choices: option.choices, allowNone: option.allowNone, placeholder: option.placeholder });
		case 'input-code':
			return compact({ language: 'json', placeholder: option.placeholder });
		case 'list':
			return { fields: (option.rowFields ?? []).map(rowField) };
		default:
			return compact({ placeholder: option.placeholder });
	}
}

function rowField(option: TransformOption): AppField {
	return {
		field: option.key,
		name: option.label,
		type: option.type,
		meta: { width: 'half', interface: option.interface, options: interfaceOptions(option) },
	};
}

function optionField(transformId: string, option: TransformOption, scope: Scope): AppField {
	const reveal = shownForClauses(transformId, option.revealWhen ?? [], option.required ?? false);
	const conditions = scope === 'value' ? [reveal, hiddenInStructured] : [reveal];
	const wide = option.interface === 'list' || option.interface === 'input-code';

	const field: AppField = {
		field: transportFieldName(transformId, option.key),
		name: option.label,
		type: option.type,
		meta: compact({
			width: wide ? 'full' : 'half',
			interface: option.interface,
			options: interfaceOptions(option),
			note: option.note,
			hidden: true,
			conditions,
		}),
	};

	if (option.defaultValue !== undefined) field.schema = { default_value: option.defaultValue };

	return field;
}

function optionFields(scope: Scope): AppField[] {
	return TRANSFORM_MANIFEST.flatMap((entry) => entry.options.map((option) => optionField(entry.id, option, scope)));
}

function transformField(scope: Scope): AppField {
	return {
		field: FIELDS.transform,
		name: 'Transform',
		type: 'string',
		meta: compact({
			width: 'full',
			interface: 'select-dropdown',
			options: { choices: scope === 'value' ? transformChoices : ruleTransformChoices },
			required: true,
			conditions: scope === 'value' ? [hiddenInStructured] : undefined,
		}),
	};
}

function onEmptyField(scope: Scope): AppField {
	return {
		field: FIELDS.onEmpty,
		name: 'When the input is empty',
		type: 'string',
		meta: {
			width: 'half',
			interface: 'select-dropdown',
			options: {
				choices: [
					{ value: 'skip', text: 'Skip formatting' },
					{ value: 'fail', text: 'Fail the operation' },
					{ value: 'replace', text: 'Use a replacement value' },
					{ value: 'set-null', text: 'Set to null' },
				],
			},
			conditions: scope === 'value' ? [hiddenInStructured, hiddenForInputHandling] : [hiddenForInputHandling],
		},
		schema: { default_value: 'skip' },
	};
}

function whenEmptyField(scope: Scope): AppField {
	const reveal = shownWhen(FIELDS.onEmpty, 'replace', true);

	return {
		field: FIELDS.whenEmpty,
		name: 'Replacement value',
		type: 'string',
		meta: {
			width: 'half',
			interface: 'input',
			options: { placeholder: 'Used when the input is empty' },
			hidden: true,
			conditions:
				scope === 'value' ? [reveal, hiddenInStructured, hiddenForInputHandling] : [reveal, hiddenForInputHandling],
		},
	};
}

const ruleFields: AppField[] = [
	{
		field: FIELDS.path,
		name: 'Field path',
		type: 'string',
		meta: {
			width: 'half',
			interface: 'input',
			options: { placeholder: 'customer.phone or items[*].price' },
			required: true,
		},
	},
	{
		field: FIELDS.missingPath,
		name: 'When no fields match',
		type: 'string',
		meta: {
			width: 'half',
			interface: 'select-dropdown',
			options: {
				choices: [
					{ value: 'skip', text: 'Skip formatting' },
					{ value: 'fail', text: 'Fail the operation' },
				],
			},
		},
		schema: { default_value: 'skip' },
	},
	transformField('rule'),
	...optionFields('rule'),
	onEmptyField('rule'),
	whenEmptyField('rule'),
];

function sourceField(values: Record<string, unknown>): AppField {
	const source = values[FIELDS.source];
	const isObject = source !== null && typeof source === 'object';

	return {
		field: FIELDS.source,
		name: 'Data to format',
		type: 'json',
		meta: {
			width: 'full',
			interface: isObject ? 'input-code' : 'input-multiline',
			options: isObject ? { language: 'json' } : { placeholder: '{{ $trigger.payload }}' },
			conditions: [hiddenInValue],
		},
	};
}

function buildOptions(values: Record<string, unknown>): AppField[] {
	return [
		{
			field: FIELDS.mode,
			name: 'Mode',
			type: 'string',
			meta: {
				width: 'full',
				interface: 'select-radio',
				options: {
					choices: [
						{ value: 'value', text: 'Format a value' },
						{ value: 'structured', text: 'Format fields' },
					],
				},
			},
			schema: { default_value: 'value' },
		},
		{
			field: FIELDS.value,
			name: 'Value',
			type: 'string',
			meta: {
				width: 'full',
				interface: 'input',
				options: { placeholder: '{{ $trigger.payload.field }}' },
				conditions: [hiddenInStructured],
			},
		},
		transformField('value'),
		...optionFields('value'),
		onEmptyField('value'),
		whenEmptyField('value'),
		sourceField(values),
		{
			field: FIELDS.rules,
			name: 'Formatting rules',
			type: 'json',
			meta: {
				width: 'full',
				interface: 'list',
				options: {
					fields: ruleFields,
					template: `{{${FIELDS.path}}}: {{${FIELDS.transform}}}`,
					limit: BOUNDS.maxRulesPerOperation,
				},
				conditions: [hiddenInValue],
			},
		},
	];
}

export default defineOperationApp({
	id: 'formatter',
	name: 'Formatter',
	icon: 'transform',
	description: 'Normalize and format field values',
	overview: (stored) => {
		if (stored[FIELDS.mode] === 'structured') {
			const rules = stored[FIELDS.rules];
			const count = Array.isArray(rules) ? rules.length : 0;
			return [
				{ label: 'Mode', text: 'Format fields' },
				{ label: 'Rules', text: String(count) },
			];
		}

		const selected = TRANSFORM_MANIFEST.find((entry) => entry.id === stored[FIELDS.transform]);

		return [
			{ label: 'Mode', text: 'Format a value' },
			{ label: 'Transform', text: selected?.label ?? 'Not selected' },
		];
	},
	options: buildOptions,
});
