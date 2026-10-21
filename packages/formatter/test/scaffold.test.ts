import { describe, expect, it } from 'vitest';
import app from '../src/app/index.js';
import api from '../src/api/index.js';
import { FIELDS } from '../src/lib/contract.js';
import { BOUNDS } from '../src/lib/bounds.js';
import { coerceEmptyHandling } from '../src/lib/fallback.js';
import { getTransform, listTransforms, registerTransform } from '../src/lib/registry.js';
import Joi from 'joi';
import { type RevealClause, TRANSFORM_MANIFEST, transportFieldName } from '../src/lib/transport.js';

type Condition = {
	name?: string;
	rule?: Record<string, Record<string, unknown>>;
	hidden?: boolean;
	required?: boolean;
};
type FieldMeta = {
	interface?: string;
	options?: {
		fields?: Field[];
		choices?: { value: unknown; text: string }[];
		language?: string;
		allowNone?: boolean;
		limit?: number;
	};
	conditions?: Condition[];
	hidden?: boolean;
	required?: boolean;
	note?: string;
};
type Field = { field: string; type?: string; meta?: FieldMeta; schema?: { default_value?: unknown } };

const appOptions = (app as { options: (values: Record<string, unknown>) => Field[] }).options;
const options = appOptions({});
const ruleFields = options.find((f) => f.field === FIELDS.rules)?.meta?.options?.fields ?? [];

function field(name: string): Field | undefined {
	return options.find((f) => f.field === name);
}

function ruleField(name: string): Field | undefined {
	return ruleFields.find((f) => f.field === name);
}

const optionFieldNames = TRANSFORM_MANIFEST.flatMap((entry) =>
	entry.options.map((option) => transportFieldName(entry.id, option.key))
);

function clauseToRules(transformId: string, clause: RevealClause): Record<string, unknown>[] {
	const field = transportFieldName(transformId, clause.option);
	if ('value' in clause) return [{ [field]: { _eq: clause.value } }];
	if ('oneOf' in clause) return [{ [field]: { _in: clause.oneOf } }];
	return [{ [field]: { _nnull: true } }, { [field]: { _nempty: true } }];
}

function revealRule(transformId: string, clauses: readonly RevealClause[]): Record<string, unknown> {
	const transformRule = { [FIELDS.transform]: { _eq: transformId } };
	if (clauses.length === 0) return transformRule;
	return { _and: [transformRule, ...clauses.flatMap((clause) => clauseToRules(transformId, clause))] };
}

function matchesRule(rule: Record<string, unknown>, values: Record<string, unknown>): boolean {
	const entries = Object.entries(rule);
	if (entries.length !== 1) return false;

	const [key, clause] = entries[0]!;
	if (key === '_and') return (clause as Record<string, unknown>[]).every((sub) => matchesRule(sub, values));
	if (key === '_or') return (clause as Record<string, unknown>[]).some((sub) => matchesRule(sub, values));

	const [operator, expected] = Object.entries(clause as Record<string, unknown>)[0]!;
	const actual = values[key];

	if (actual === undefined) return false;
	if (operator === '_eq') return actual === expected;
	if (operator === '_in') return (expected as unknown[]).includes(actual);
	if (operator === '_nnull') return actual !== null;
	if (operator === '_nempty') return actual !== '';

	throw new Error(`operator ${operator} is not modelled`);
}

function productionLeaf(operator: string, compareValue: unknown): Joi.AnySchema {
	let schema = Joi.any();
	if (operator === '_eq') schema = schema.valid(compareValue);
	else if (operator === '_in') schema = schema.valid(...(compareValue as unknown[]));
	else if (operator === '_nnull') schema = schema.invalid(null);
	else if (operator === '_nempty') schema = schema.invalid('');
	else throw new Error(`operator ${operator} is not modelled`);
	return schema.required();
}

function productionMatches(rule: Record<string, unknown>, values: Record<string, unknown>): boolean {
	const [key, clause] = Object.entries(rule)[0]!;
	if (key === '_and') return (clause as Record<string, unknown>[]).every((sub) => productionMatches(sub, values));
	if (key === '_or') return (clause as Record<string, unknown>[]).some((sub) => productionMatches(sub, values));

	const [operator, compareValue] = Object.entries(clause as Record<string, unknown>)[0]!;
	return productionLeaf(operator, compareValue).validate(values[key]).error === undefined;
}

function visible(candidate: Field, values: Record<string, unknown>): boolean {
	const conditions = [...(candidate.meta?.conditions ?? [])].reverse();
	const match = conditions.find((condition) => matchesRule(condition.rule ?? {}, values));
	return !(match?.hidden ?? candidate.meta?.hidden ?? false);
}

function visibleNames(fields: Field[], values: Record<string, unknown>): string[] {
	return fields.filter((f) => visible(f, values)).map((f) => f.field);
}

describe('operation identity', () => {
	it('app and api register the same operation id', () => {
		expect((app as { id: string }).id).toBe('formatter');
		expect((api as { id: string }).id).toBe('formatter');
		expect((app as { id: string }).id).toBe((api as { id: string }).id);
	});
});

describe('option contract agreement', () => {
	it('pins the persisted wire names so a FIELDS value cannot drift and silently break stored flows', () => {
		expect({ ...FIELDS }).toEqual({
			mode: 'mode',
			value: 'value',
			transform: 'transform',
			source: 'source',
			rules: 'rules',
			onEmpty: 'onEmpty',
			whenEmpty: 'whenEmpty',
			path: 'path',
			missingPath: 'missingPath',
		});
	});

	it('app exposes a top-level field for every top-level operation key, so it cannot drift from the api Options type', () => {
		const keys = [
			FIELDS.mode,
			FIELDS.value,
			FIELDS.transform,
			FIELDS.onEmpty,
			FIELDS.whenEmpty,
			FIELDS.source,
			FIELDS.rules,
		];

		for (const key of keys) {
			expect(field(key), `missing app field for FIELDS.${key}`).toBeDefined();
		}
	});

	it('rules carry every rule structural key as a sub-field', () => {
		for (const key of [FIELDS.path, FIELDS.transform, FIELDS.missingPath, FIELDS.onEmpty, FIELDS.whenEmpty]) {
			expect(ruleField(key), `missing rule sub-field for FIELDS.${key}`).toBeDefined();
		}
	});

	it('drops the note and validates the selection before the input-handling exclusion', () => {
		expect(field(FIELDS.onEmpty)?.meta?.note).toBeUndefined();
		expect(ruleField(FIELDS.onEmpty)?.meta?.note).toBeUndefined();

		const excluded = TRANSFORM_MANIFEST.filter((entry) => !entry.acceptsWhenEmpty).map((entry) => entry.id);
		expect([...excluded].sort()).toEqual(['date.now', 'lookup.table', 'phone.validate']);

		for (const entry of TRANSFORM_MANIFEST) {
			expect(() => coerceEmptyHandling('format', undefined, entry.id), entry.id).toThrow(/must be/);
			expect(() => coerceEmptyHandling('bogus', undefined, entry.id), entry.id).toThrow(/must be/);

			if (entry.acceptsWhenEmpty) {
				expect(coerceEmptyHandling(undefined, undefined, entry.id), entry.id).toEqual({ kind: 'skip' });
				expect(coerceEmptyHandling('fail', undefined, entry.id), entry.id).toEqual({ kind: 'fail' });
				expect(coerceEmptyHandling('set-null', undefined, entry.id), entry.id).toEqual({ kind: 'set-null' });
				expect(coerceEmptyHandling('replace', 'x', entry.id), entry.id).toEqual({ kind: 'replace', value: 'x' });
			} else {
				expect(coerceEmptyHandling(undefined, undefined, entry.id), entry.id).toEqual({ kind: 'run' });
				expect(coerceEmptyHandling('replace', 'x', entry.id), entry.id).toEqual({ kind: 'run' });
				expect(coerceEmptyHandling('set-null', undefined, entry.id), entry.id).toEqual({ kind: 'run' });
			}
		}
	});

	it('is a four-option selector defaulting to skip, hidden for input-handling transforms, revealing the replacement only for replace', () => {
		const states = ['skip', 'fail', 'replace', 'set-null'];
		const excludedIds = TRANSFORM_MANIFEST.filter((entry) => !entry.acceptsWhenEmpty).map((entry) => entry.id);
		const reveal = { rule: { [FIELDS.onEmpty]: { _eq: 'replace' } }, hidden: false };
		const structured = { rule: { [FIELDS.mode]: { _eq: 'structured' } }, hidden: true };
		const exclusion = { rule: { [FIELDS.transform]: { _in: excludedIds } }, hidden: true };

		for (const onEmpty of [field(FIELDS.onEmpty)!, ruleField(FIELDS.onEmpty)!]) {
			expect(onEmpty.meta?.interface).toBe('select-dropdown');
			expect(onEmpty.meta?.options?.choices?.map((c) => c.value)).toEqual(states);
			expect(onEmpty.schema?.default_value).toBe('skip');
		}

		expect(field(FIELDS.onEmpty)?.meta?.conditions).toMatchObject([structured, exclusion]);
		expect(ruleField(FIELDS.onEmpty)?.meta?.conditions).toMatchObject([exclusion]);

		const inValue = field(FIELDS.whenEmpty)!;
		expect(inValue.meta?.hidden).toBe(true);
		expect(inValue.meta?.conditions).toMatchObject([reveal, structured, exclusion]);

		const inRule = ruleField(FIELDS.whenEmpty)!;
		expect(inRule.meta?.hidden).toBe(true);
		expect(inRule.meta?.conditions).toMatchObject([reveal, exclusion]);
		expect(inRule.meta?.conditions).toHaveLength(2);
	});
});

describe('value mode contract', () => {
	it('hides value-mode fields when mode is structured', () => {
		for (const name of [FIELDS.value, FIELDS.transform, FIELDS.onEmpty, FIELDS.whenEmpty]) {
			const conditions = field(name)?.meta?.conditions ?? [];
			expect(conditions.some((c) => c.rule?.['mode']?.['_eq'] === 'structured' && c.hidden === true)).toBe(true);
		}
	});
});

describe('structured mode contract', () => {
	it('hides source and rules in value mode', () => {
		for (const name of [FIELDS.source, FIELDS.rules]) {
			const conditions = field(name)?.meta?.conditions ?? [];
			expect(conditions.some((c) => c.rule?.['mode']?.['_eq'] === 'value' && c.hidden === true)).toBe(true);
		}
	});

	it('caps the rules list at the server rule bound so the UI cannot build an operation the handler will reject', () => {
		expect(field(FIELDS.rules)?.meta?.options?.limit).toBe(BOUNDS.maxRulesPerOperation);
	});

	it('renders the source as an expression editor by default and a JSON editor once the source is an object', () => {
		const empty = appOptions({}).find((f) => f.field === FIELDS.source);
		expect(empty?.type).toBe('json');
		expect(empty?.meta?.interface).toBe('input-multiline');
		expect(empty?.meta?.options?.language).toBeUndefined();

		const expression = appOptions({ source: '{{ $trigger.payload }}' }).find((f) => f.field === FIELDS.source);
		expect(expression?.meta?.interface).toBe('input-multiline');

		const cleared = appOptions({ source: null }).find((f) => f.field === FIELDS.source);
		expect(cleared?.meta?.interface).toBe('input-multiline');

		const object = appOptions({ source: { phone: '{{ read.phone }}' } }).find((f) => f.field === FIELDS.source);
		expect(object?.meta?.interface).toBe('input-code');
		expect(object?.meta?.options?.language).toBe('json');
		expect(object?.type).toBe('json');

		const array = appOptions({ source: [{ phone: '{{ read.phone }}' }] }).find((f) => f.field === FIELDS.source);
		expect(array?.meta?.interface).toBe('input-code');
		expect(array?.meta?.options?.language).toBe('json');
	});

	it('missingPath is a skip-or-fail selector defaulting to skip', () => {
		const missingPath = ruleField(FIELDS.missingPath);
		expect(missingPath?.meta?.interface).toBe('select-dropdown');
		expect(missingPath?.meta?.options?.choices?.map((c) => c.value)).toEqual(['skip', 'fail']);
		expect(missingPath?.schema?.default_value).toBe('skip');
	});

	it('never marks a hidden-by-default rule sub-field statically required, since the list save gate reads static required across every rule', () => {
		for (const f of ruleFields) {
			if (f.meta?.hidden === true) expect(f.meta?.required, f.field).toBeFalsy();
		}
	});

	it('marks path and transform statically required and drives option requiredness through the reveal condition', () => {
		expect(ruleField(FIELDS.path)?.meta?.required).toBe(true);
		expect(ruleField(FIELDS.transform)?.meta?.required).toBe(true);
		expect(field(FIELDS.transform)?.meta?.required).toBe(true);

		const maxLength = ruleField(transportFieldName('text.truncate', 'maxLength'))!;
		expect(maxLength.meta?.required).toBeFalsy();
		expect(maxLength.meta?.conditions?.some((c) => c.required === true)).toBe(true);

		const ellipsis = ruleField(transportFieldName('text.truncate', 'ellipsis'))!;
		expect(ellipsis.meta?.required).toBeFalsy();
		expect(ellipsis.meta?.conditions?.some((c) => c.required === true)).toBeFalsy();

		const whenEmpty = ruleField(FIELDS.whenEmpty)!;
		expect(whenEmpty.meta?.required).toBeFalsy();
		const revealReplace = whenEmpty.meta?.conditions?.find((c) => c.rule?.[FIELDS.onEmpty]?.['_eq'] === 'replace');
		expect(revealReplace?.required).toBe(true);
	});

	it('reveals and requires the number.format style-dependent options only under their own style', () => {
		const style = transportFieldName('number.format', 'style');
		const currency = transportFieldName('number.format', 'currency');
		const unit = transportFieldName('number.format', 'unit');
		const percentScale = transportFieldName('number.format', 'percentScale');
		const base = { mode: 'value', transform: 'number.format' };

		expect(visible(field(currency)!, { ...base, [style]: 'currency' })).toBe(true);
		expect(visible(field(currency)!, { ...base, [style]: 'decimal' })).toBe(false);
		expect(visible(field(unit)!, { ...base, [style]: 'unit' })).toBe(true);
		expect(visible(field(unit)!, { ...base, [style]: 'percent' })).toBe(false);
		expect(visible(field(percentScale)!, { ...base, [style]: 'percent' })).toBe(true);
		expect(visible(field(percentScale)!, { ...base, [style]: 'currency' })).toBe(false);

		// Hidden option values survive transform switches.
		expect(visible(field(currency)!, { mode: 'value', transform: 'text.trim', [style]: 'currency' })).toBe(false);

		for (const name of [currency, unit, percentScale]) {
			const reveal = field(name)!.meta?.conditions?.find((c) => Object.keys(c.rule ?? {})[0] === '_and');
			expect(reveal?.required, name).toBe(true);
		}
	});

	it('reveals the plural form slots only under locale.plural and requires only the "other" fallback', () => {
		const base = { mode: 'value', transform: 'locale.plural' };

		for (const category of ['zero', 'one', 'two', 'few', 'many', 'other']) {
			const slot = field(transportFieldName('locale.plural', category))!;
			expect(slot.type, category).toBe('string');
			expect(slot.meta?.interface, category).toBe('input');
			expect(visible(slot, base), category).toBe(true);
			expect(visible(slot, { mode: 'value', transform: 'text.trim' }), category).toBe(false);

			const requiredByCondition = slot.meta?.conditions?.some((c) => c.required === true) ?? false;
			expect(requiredByCondition, category).toBe(category === 'other');
			expect(slot.meta?.required, category).toBeFalsy();
		}
	});
});

describe('transform option catalog', () => {
	it('lists every transform in the value panel and every field-eligible transform in the rule drawer', () => {
		const all = TRANSFORM_MANIFEST.map((entry) => ({ value: entry.id, text: entry.label }));

		const ruleEligible = TRANSFORM_MANIFEST.filter((entry) => entry.fieldEligible !== false).map((entry) => ({
			value: entry.id,
			text: entry.label,
		}));

		expect(field(FIELDS.transform)?.meta?.options?.choices).toEqual(all);
		expect(ruleField(FIELDS.transform)?.meta?.options?.choices).toEqual(ruleEligible);
		expect(all).toContainEqual({ value: 'phone.validate', text: 'Phone: Validate' });
		expect(ruleEligible).not.toContainEqual({ value: 'phone.validate', text: 'Phone: Validate' });
	});

	it('exposes every manifest option under its transport name in the value panel and the rule drawer', () => {
		for (const name of optionFieldNames) {
			expect(field(name), `value panel is missing ${name}`).toBeDefined();
			expect(ruleField(name), `rule drawer is missing ${name}`).toBeDefined();
		}
	});

	it('no two fields collide in the value panel or the rule drawer', () => {
		const topLevel = options.map((f) => f.field);
		const inRule = ruleFields.map((f) => f.field);
		expect(new Set(topLevel).size).toBe(topLevel.length);
		expect(new Set(inRule).size).toBe(inRule.length);
	});

	it('hides every option field by default and reveals it only for its own transform', () => {
		for (const entry of TRANSFORM_MANIFEST) {
			for (const option of entry.options) {
				const name = transportFieldName(entry.id, option.key);
				const reveal = { rule: revealRule(entry.id, option.revealWhen ?? []), hidden: false };
				const structured = { rule: { [FIELDS.mode]: { _eq: 'structured' } }, hidden: true };

				const inValue = field(name)!;
				expect(inValue.meta?.hidden, name).toBe(true);
				expect(inValue.meta?.conditions, name).toMatchObject([reveal, structured]);

				const inRule = ruleField(name)!;
				expect(inRule.meta?.hidden, name).toBe(true);
				expect(inRule.meta?.conditions, name).toMatchObject([reveal]);
				expect(inRule.meta?.conditions, name).toHaveLength(1);
			}
		}
	});

	it('carries the manifest storage type and interface onto each field', () => {
		for (const entry of TRANSFORM_MANIFEST) {
			for (const option of entry.options) {
				const name = transportFieldName(entry.id, option.key);

				for (const candidate of [field(name)!, ruleField(name)!]) {
					expect(candidate.type, name).toBe(option.type);
					expect(candidate.meta?.interface, name).toBe(option.interface);
				}
			}
		}
	});

	it('renders enum options as dropdowns, counts as number inputs, and the lookup table as key-value rows', () => {
		const format = field(transportFieldName('phone.format', 'format'));

		expect(format?.meta?.options?.choices?.map((c) => c.value)).toEqual([
			'e164',
			'international',
			'national',
			'rfc3966',
		]);

		const scale = field(transportFieldName('number.round', 'scale'));
		expect(scale?.type).toBe('integer');
		expect(scale?.meta?.interface).toBe('input');

		const otherForm = field(transportFieldName('locale.plural', 'other'));
		expect(otherForm?.type).toBe('string');
		expect(otherForm?.meta?.interface).toBe('input');

		const oneForm = field(transportFieldName('locale.plural', 'one'));
		expect(oneForm?.type).toBe('string');
		expect(oneForm?.meta?.interface).toBe('input');

		const table = ruleField(transportFieldName('lookup.table', 'table'));
		expect(table?.meta?.interface).toBe('list');
		expect(table?.meta?.options?.fields?.map((f) => f.field)).toEqual(['key', 'value']);

		const caseSensitive = ruleField(transportFieldName('lookup.table', 'caseSensitive'));
		expect(caseSensitive?.type).toBe('boolean');
		expect(caseSensitive?.schema?.default_value).toBe(true);
	});

	it('renders hourCycle as a deselectable string dropdown so the locale default stays reachable after a choice', () => {
		for (const transformId of ['date.format', 'date.now', 'date.range']) {
			const hourCycle = field(transportFieldName(transformId, 'hourCycle'));
			expect(hourCycle?.type, transformId).toBe('string');
			expect(hourCycle?.meta?.interface, transformId).toBe('select-dropdown');

			expect(
				hourCycle?.meta?.options?.choices?.map((c) => c.value),
				transformId
			).toEqual(['h12', 'h23', 'h11', 'h24']);

			expect(hourCycle?.meta?.options?.allowNone, transformId).toBe(true);
		}
	});

	it('resolves visibility like the app form: nothing before a transform is chosen, only the chosen transform after', () => {
		const structural = [FIELDS.mode, FIELDS.value, FIELDS.transform, FIELDS.onEmpty];

		expect(visibleNames(options, { mode: 'value', onEmpty: 'skip' })).toEqual(structural);

		expect(visibleNames(options, { mode: 'value', onEmpty: 'skip', transform: 'text.truncate' })).toEqual([
			FIELDS.mode,
			FIELDS.value,
			FIELDS.transform,
			transportFieldName('text.truncate', 'maxLength'),
			transportFieldName('text.truncate', 'ellipsis'),
			FIELDS.onEmpty,
		]);

		expect(visibleNames(options, { mode: 'value', onEmpty: 'replace', transform: 'text.truncate' })).toEqual([
			FIELDS.mode,
			FIELDS.value,
			FIELDS.transform,
			transportFieldName('text.truncate', 'maxLength'),
			transportFieldName('text.truncate', 'ellipsis'),
			FIELDS.onEmpty,
			FIELDS.whenEmpty,
		]);

		expect(visibleNames(options, { mode: 'structured', onEmpty: 'replace', transform: 'text.truncate' })).toEqual([
			FIELDS.mode,
			FIELDS.source,
			FIELDS.rules,
		]);
	});

	it('resolves rule drawer visibility from the row transform and empty handling alone', () => {
		const structural = [FIELDS.path, FIELDS.missingPath, FIELDS.transform, FIELDS.onEmpty];
		const inputKind = transportFieldName('date.parse', 'inputKind');

		expect(visibleNames(ruleFields, { missingPath: 'skip', onEmpty: 'skip' })).toEqual(structural);

		expect(
			visibleNames(ruleFields, {
				missingPath: 'skip',
				onEmpty: 'set-null',
				transform: 'date.parse',
				[inputKind]: 'instant',
			})
		).toEqual([
			FIELDS.path,
			FIELDS.missingPath,
			FIELDS.transform,
			transportFieldName('date.parse', 'inputKind'),
			transportFieldName('date.parse', 'output'),
			FIELDS.onEmpty,
		]);

		expect(
			visibleNames(ruleFields, {
				missingPath: 'skip',
				onEmpty: 'set-null',
				transform: 'date.parse',
				[inputKind]: 'date',
			})
		).toEqual([
			FIELDS.path,
			FIELDS.missingPath,
			FIELDS.transform,
			transportFieldName('date.parse', 'inputKind'),
			FIELDS.onEmpty,
		]);

		expect(
			visibleNames(ruleFields, {
				missingPath: 'skip',
				onEmpty: 'replace',
				transform: 'date.parse',
				[inputKind]: 'instant',
			})
		).toEqual([
			FIELDS.path,
			FIELDS.missingPath,
			FIELDS.transform,
			transportFieldName('date.parse', 'inputKind'),
			transportFieldName('date.parse', 'output'),
			FIELDS.onEmpty,
			FIELDS.whenEmpty,
		]);
	});
});

describe('date restructuring visibility and requiredness', () => {
	const fmt = (key: string) => transportFieldName('date.format', key);
	const nowKey = (key: string) => transportFieldName('date.now', key);
	const parseKey = (key: string) => transportFieldName('date.parse', key);
	const baseFmt = { mode: 'value', transform: 'date.format' };

	it('reveals the preset group under preset and the component group under components', () => {
		expect(visible(field(fmt('dateStyle'))!, { ...baseFmt, [fmt('formatStyle')]: 'preset' })).toBe(true);
		expect(visible(field(fmt('dateStyle'))!, { ...baseFmt, [fmt('formatStyle')]: 'components' })).toBe(false);
		expect(visible(field(fmt('year'))!, { ...baseFmt, [fmt('formatStyle')]: 'components' })).toBe(true);
		expect(visible(field(fmt('year'))!, { ...baseFmt, [fmt('formatStyle')]: 'preset' })).toBe(false);
	});

	it('hides time controls and Time zone on date-only input and shows them otherwise', () => {
		const instant = { ...baseFmt, [fmt('inputKind')]: 'instant', [fmt('formatStyle')]: 'components' };
		const dateOnly = { ...baseFmt, [fmt('inputKind')]: 'date', [fmt('formatStyle')]: 'components' };

		expect(visible(field(fmt('hour'))!, instant)).toBe(true);
		expect(visible(field(fmt('hour'))!, dateOnly)).toBe(false);
		expect(visible(field(fmt('timeZone'))!, instant)).toBe(true);
		expect(visible(field(fmt('timeZone'))!, dateOnly)).toBe(false);

		expect(
			visible(field(fmt('hourCycle'))!, { ...baseFmt, [fmt('inputKind')]: 'instant', [fmt('formatStyle')]: 'preset' })
		).toBe(true);

		expect(visible(field(fmt('hourCycle'))!, dateOnly)).toBe(false);
	});

	it('requires Time zone for instant and epoch input through the reveal condition, not statically, in both scopes', () => {
		for (const tz of [field(fmt('timeZone'))!, ruleField(fmt('timeZone'))!]) {
			expect(tz.meta?.required).toBeFalsy();
			expect(tz.meta?.conditions?.some((c) => c.required === true)).toBe(true);
		}
	});

	it('gates Date: Now formatting on a set locale, treating absent, null, and empty alike as unset', () => {
		const fs = field(nowKey('formatStyle'))!;
		const tz = field(nowKey('timeZone'))!;
		const locale = nowKey('locale');
		const absent = { mode: 'value', transform: 'date.now' };
		const nulled = { mode: 'value', transform: 'date.now', [locale]: null };
		const empty = { mode: 'value', transform: 'date.now', [locale]: '' };
		const set = { mode: 'value', transform: 'date.now', [locale]: 'en-US' };

		for (const unset of [absent, nulled, empty]) {
			expect(visible(fs, unset)).toBe(false);
			expect(visible(tz, unset)).toBe(false);
		}

		expect(visible(fs, set)).toBe(true);
		expect(visible(tz, set)).toBe(true);
		expect(tz.meta?.conditions?.some((c) => c.required === true)).toBe(true);
	});

	it('confirms the Date: Now locale gate against the production Joi validator, in both scopes', () => {
		const locale = nowKey('locale');

		for (const makeField of [field, ruleField]) {
			for (const key of ['formatStyle', 'timeZone']) {
				const reveal = makeField(nowKey(key))!.meta?.conditions?.find((c) => c.hidden === false);
				if (!reveal) throw new Error(`no reveal condition for ${key}`);
				expect(productionMatches(reveal.rule!, { transform: 'date.now' }), key).toBe(false);
				expect(productionMatches(reveal.rule!, { transform: 'date.now', [locale]: null }), key).toBe(false);
				expect(productionMatches(reveal.rule!, { transform: 'date.now', [locale]: '' }), key).toBe(false);
				expect(productionMatches(reveal.rule!, { transform: 'date.now', [locale]: 'en-US' }), key).toBe(true);
			}
		}
	});

	it('hides Date: Convert Output on date-only input and shows it otherwise, in both scopes', () => {
		expect(
			visible(field(parseKey('output'))!, {
				mode: 'value',
				transform: 'date.parse',
				[parseKey('inputKind')]: 'instant',
			})
		).toBe(true);

		expect(
			visible(field(parseKey('output'))!, { mode: 'value', transform: 'date.parse', [parseKey('inputKind')]: 'date' })
		).toBe(false);

		expect(
			visible(ruleField(parseKey('output'))!, { transform: 'date.parse', [parseKey('inputKind')]: 'instant' })
		).toBe(true);

		expect(visible(ruleField(parseKey('output'))!, { transform: 'date.parse', [parseKey('inputKind')]: 'date' })).toBe(
			false
		);
	});
});

describe('registry', () => {
	it('registers and looks up a transform through the public api', () => {
		const def = { id: 'test.only', category: 'test', optionKeys: [] as string[], prepare: () => (v: unknown) => v };
		registerTransform(def);
		expect(getTransform('test.only')).toBe(def);
		expect(listTransforms().some((t) => t.id === 'test.only')).toBe(true);
	});

	it('rejects a duplicate transform id loudly', () => {
		const def = { id: 'test.dup', category: 'test', optionKeys: [] as string[], prepare: () => (v: unknown) => v };
		registerTransform(def);
		expect(() => registerTransform(def)).toThrow(/duplicate/);
	});
});
