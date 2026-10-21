import { types } from 'node:util';
import { coerceInputNumber, coerceInputString, coerceOptionalString, coerceString, isAbsent } from '../coerce.js';
import { FormatterError } from '../errors.js';
import { requireCapability, requireValidLocale, requireValidTimeZone } from '../icu.js';
import type { TransformDefinition } from '../registry.js';

type InputKind = 'instant' | 'date' | 'epoch-seconds' | 'epoch-milliseconds';

type ParsedDate = { kind: 'date'; iso: string } | { kind: 'instant'; date: Date };

const INPUT_KINDS = new Set<InputKind>(['instant', 'date', 'epoch-seconds', 'epoch-milliseconds']);
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRealCalendarDate(year: number, month: number, day: number): boolean {
	const probe = new Date(0);
	probe.setUTCFullYear(year, month - 1, day);
	return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

const DATE_TIME_OPTION_KEYS = [
	'dateStyle',
	'timeStyle',
	'weekday',
	'era',
	'year',
	'month',
	'day',
	'hour',
	'minute',
	'second',
	'timeZoneName',
	'hourCycle',
] as const;

const PRESET_KEYS = ['dateStyle', 'timeStyle'] as const;
const COMPONENT_KEYS = ['weekday', 'era', 'year', 'month', 'day', 'hour', 'minute', 'second', 'timeZoneName'] as const;
const MODIFIER_KEYS = ['hourCycle'] as const;
const TIME_CONTROL_KEYS = new Set<string>(['timeStyle', 'hour', 'minute', 'second', 'timeZoneName', 'hourCycle']);

type FormatStyle = 'preset' | 'components';

function resolveFormatStyle(options: Record<string, unknown>, transform: string): FormatStyle {
	const style = coerceOptionalString(options['formatStyle'], 'formatStyle', transform) ?? 'preset';

	if (style !== 'preset' && style !== 'components') {
		throw new FormatterError('INVALID_OPTION', 'option "formatStyle" must be "preset" or "components"', { transform });
	}

	return style;
}

function coerceInputKind(options: Record<string, unknown>, transform: string): InputKind {
	const kind = coerceString(options['inputKind'], 'inputKind', transform);

	if (!INPUT_KINDS.has(kind as InputKind)) {
		throw new FormatterError(
			'INVALID_OPTION',
			'option "inputKind" must be instant, date, epoch-seconds, or epoch-milliseconds',
			{ transform }
		);
	}

	return kind as InputKind;
}

function parseDateInput(value: unknown, kind: InputKind, transform: string): ParsedDate {
	if (kind === 'date') {
		const input = coerceInputString(value, transform);

		const match = DATE_ONLY.exec(input);

		if (match === null) {
			throw new FormatterError('INVALID_INPUT', 'a date-only value must be formatted YYYY-MM-DD', { transform });
		}

		if (!isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
			throw new FormatterError('INVALID_INPUT', 'the value is not a real calendar date', { transform });
		}

		return { kind: 'date', iso: input };
	}

	if (kind === 'instant') {
		const input = coerceInputString(value, transform);
		const match = INSTANT.exec(input);

		if (match === null) {
			throw new FormatterError('INVALID_INPUT', 'an instant must carry a Z or an explicit offset', { transform });
		}

		const year = Number(match[1]);
		const month = Number(match[2]);
		const day = Number(match[3]);
		const hour = Number(match[4]);
		const minute = Number(match[5]);
		const second = match[6] === undefined ? 0 : Number(match[6]);

		if (hour > 23 || minute > 59 || second > 59 || !isRealCalendarDate(year, month, day)) {
			throw new FormatterError('INVALID_INPUT', 'the value is not a real date and time', { transform });
		}

		const date = new Date(input);

		if (Number.isNaN(date.getTime())) {
			throw new FormatterError('INVALID_INPUT', 'the value is not a valid instant', { transform });
		}

		return { kind: 'instant', date };
	}

	const epoch = coerceInputNumber(value, transform);

	if (!Number.isInteger(epoch)) {
		throw new FormatterError('INVALID_INPUT', 'an epoch value must be an integer', { transform });
	}

	const date = new Date(kind === 'epoch-seconds' ? epoch * 1000 : epoch);

	if (Number.isNaN(date.getTime())) {
		throw new FormatterError('INVALID_INPUT', 'the epoch value is out of range', { transform });
	}

	return { kind: 'instant', date };
}

function asFormattable(parsed: ParsedDate): Date {
	return parsed.kind === 'date' ? new Date(`${parsed.iso}T00:00:00Z`) : parsed.date;
}

function resolveTimeZoneForKind(kind: InputKind, options: Record<string, unknown>, transform: string): string {
	if (kind === 'date') {
		return 'UTC';
	}

	const timeZone = coerceString(options['timeZone'], 'timeZone', transform);
	requireValidTimeZone(timeZone, transform);
	return timeZone;
}

function buildDateTimeOptions(
	options: Record<string, unknown>,
	formatStyle: FormatStyle,
	dateOnly: boolean,
	transform: string
): Intl.DateTimeFormatOptions {
	const groupKeys = formatStyle === 'preset' ? PRESET_KEYS : COMPONENT_KEYS;
	const built: Record<string, unknown> = {};

	for (const key of [...groupKeys, ...MODIFIER_KEYS]) {
		if (dateOnly && TIME_CONTROL_KEYS.has(key)) continue;
		if (!isAbsent(options[key])) built[key] = coerceString(options[key], key, transform);
	}

	return built as Intl.DateTimeFormatOptions;
}

function readMember(container: object, key: string, transform: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(container, key);

	if (descriptor === undefined || !('value' in descriptor)) {
		throw new FormatterError('INVALID_INPUT', `range input must have a "${key}" value`, { transform });
	}

	return descriptor.value;
}

const format: TransformDefinition = {
	id: 'date.format',
	category: 'date',
	optionKeys: ['inputKind', 'locale', 'timeZone', 'formatStyle', ...DATE_TIME_OPTION_KEYS],
	prepare(options, ctx) {
		const id = this.id;
		requireCapability(ctx.icu, 'formatting', id);
		const kind = coerceInputKind(options, id);
		const locale = coerceString(options['locale'], 'locale', id);
		requireValidLocale(locale, id);
		const timeZone = resolveTimeZoneForKind(kind, options, id);
		const dateTimeOptions = buildDateTimeOptions(options, resolveFormatStyle(options, id), kind === 'date', id);

		let formatter: Intl.DateTimeFormat;

		try {
			formatter = new Intl.DateTimeFormat(locale, { ...dateTimeOptions, timeZone });
		} catch {
			throw new FormatterError('INVALID_OPTION', 'the date formatting options are invalid', { transform: id });
		}

		return (value) => formatter.format(asFormattable(parseDateInput(value, kind, id)));
	},
};

const parse: TransformDefinition = {
	id: 'date.parse',
	category: 'date',
	optionKeys: ['inputKind', 'output'],
	prepare(options, _ctx) {
		const id = this.id;
		const kind = coerceInputKind(options, id);

		if (kind === 'date') {
			return (value) => {
				const parsed = parseDateInput(value, kind, id);
				return parsed.kind === 'date' ? parsed.iso : parsed.date.toISOString();
			};
		}

		const output = coerceOptionalString(options['output'], 'output', id) ?? 'iso';

		if (output !== 'iso' && output !== 'epoch-seconds' && output !== 'epoch-milliseconds') {
			throw new FormatterError('INVALID_OPTION', 'option "output" must be iso, epoch-seconds, or epoch-milliseconds', {
				transform: id,
			});
		}

		return (value) => {
			const parsed = parseDateInput(value, kind, id);
			if (parsed.kind === 'date') return parsed.iso;
			if (output === 'iso') return parsed.date.toISOString();
			if (output === 'epoch-seconds') return Math.floor(parsed.date.getTime() / 1000);
			return parsed.date.getTime();
		};
	},
};

const now: TransformDefinition = {
	id: 'date.now',
	category: 'date',
	optionKeys: ['locale', 'timeZone', 'formatStyle', ...DATE_TIME_OPTION_KEYS],
	prepare(options, ctx) {
		const id = this.id;
		const locale = coerceOptionalString(options['locale'], 'locale', id);

		if (locale === undefined) {
			return () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
		}

		requireCapability(ctx.icu, 'formatting', id);
		requireValidLocale(locale, id);
		const timeZone = coerceString(options['timeZone'], 'timeZone', id);
		requireValidTimeZone(timeZone, id);
		const dateTimeOptions = buildDateTimeOptions(options, resolveFormatStyle(options, id), false, id);

		let formatter: Intl.DateTimeFormat;

		try {
			formatter = new Intl.DateTimeFormat(locale, { ...dateTimeOptions, timeZone });
		} catch {
			throw new FormatterError('INVALID_OPTION', 'the date formatting options are invalid', { transform: id });
		}

		return () => formatter.format(new Date());
	},
};

const RELATIVE_UNITS = new Set(['year', 'quarter', 'month', 'week', 'day', 'hour', 'minute', 'second']);

const relative: TransformDefinition = {
	id: 'date.relative',
	category: 'date',
	optionKeys: ['locale', 'unit', 'numeric', 'style'],
	prepare(options, ctx) {
		const id = this.id;
		requireCapability(ctx.icu, 'formatting', id);
		const locale = coerceString(options['locale'], 'locale', id);
		requireValidLocale(locale, id);
		const unit = coerceString(options['unit'], 'unit', id);

		if (!RELATIVE_UNITS.has(unit)) {
			throw new FormatterError(
				'INVALID_OPTION',
				'option "unit" must be year, quarter, month, week, day, hour, minute, or second',
				{ transform: id }
			);
		}

		const relativeOptions: Intl.RelativeTimeFormatOptions = {};
		const numeric = coerceOptionalString(options['numeric'], 'numeric', id);

		if (numeric !== undefined) {
			if (numeric !== 'always' && numeric !== 'auto') {
				throw new FormatterError('INVALID_OPTION', 'option "numeric" must be "always" or "auto"', { transform: id });
			}

			relativeOptions.numeric = numeric;
		}

		const style = coerceOptionalString(options['style'], 'style', id);

		if (style !== undefined) {
			if (style !== 'long' && style !== 'short' && style !== 'narrow') {
				throw new FormatterError('INVALID_OPTION', 'option "style" must be "long", "short", or "narrow"', {
					transform: id,
				});
			}

			relativeOptions.style = style;
		}

		let formatter: Intl.RelativeTimeFormat;

		try {
			formatter = new Intl.RelativeTimeFormat(locale, relativeOptions);
		} catch {
			throw new FormatterError('INVALID_OPTION', 'the relative-time options are invalid', { transform: id });
		}

		return (value) => formatter.format(coerceInputNumber(value, id), unit as Intl.RelativeTimeFormatUnit);
	},
};

const range: TransformDefinition = {
	id: 'date.range',
	category: 'date',
	optionKeys: ['inputKind', 'locale', 'timeZone', 'formatStyle', ...DATE_TIME_OPTION_KEYS],
	prepare(options, ctx) {
		const id = this.id;
		requireCapability(ctx.icu, 'formatting', id);
		const kind = coerceInputKind(options, id);
		const locale = coerceString(options['locale'], 'locale', id);
		requireValidLocale(locale, id);
		const timeZone = resolveTimeZoneForKind(kind, options, id);
		const dateTimeOptions = buildDateTimeOptions(options, resolveFormatStyle(options, id), kind === 'date', id);

		let formatter: Intl.DateTimeFormat;

		try {
			formatter = new Intl.DateTimeFormat(locale, { ...dateTimeOptions, timeZone });
		} catch {
			throw new FormatterError('INVALID_OPTION', 'the date formatting options are invalid', { transform: id });
		}

		return (value) => {
			if (value === null || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) {
				throw new FormatterError('INVALID_INPUT', 'expected an object shaped { start, end }', { transform: id });
			}

			const start = asFormattable(parseDateInput(readMember(value, 'start', id), kind, id));
			const end = asFormattable(parseDateInput(readMember(value, 'end', id), kind, id));

			if (start.getTime() > end.getTime()) {
				throw new FormatterError('INVALID_INPUT', 'the range start is after its end', { transform: id });
			}

			try {
				return formatter.formatRange(start, end);
			} catch {
				throw new FormatterError('INVALID_OPTION', 'the date range could not be formatted', { transform: id });
			}
		};
	},
};

export const dateTransforms: TransformDefinition[] = [format, parse, now, relative, range];
