import Big from 'big.js';
import { BOUNDS } from '../bounds.js';
import { coerceInputNumber, coerceInteger, coerceOptionalString, coerceString, isAbsent } from '../coerce.js';
import { FormatterError } from '../errors.js';
import { requireCapability, requireValidLocale } from '../icu.js';
import type { TransformDefinition } from '../registry.js';

const ROUNDING: Record<string, 0 | 1 | 2 | 3> = {
	'toward-zero': 0,
	'half-up': 1,
	'half-even': 2,
	'away-from-zero': 3,
};

function assertNumericBounds(raw: string, transform: string): void {
	if (raw.length > BOUNDS.maxOptionStringLength) {
		throw new FormatterError('BOUND_EXCEEDED', 'number has too many digits', { transform });
	}

	const digits = raw.replace(/[^0-9]/g, '').length;

	if (digits > BOUNDS.maxNumberDigits) {
		throw new FormatterError('BOUND_EXCEEDED', 'number has too many digits', { transform });
	}

	const exponent = raw.match(/[eE]([+-]?\d+)/);

	if (exponent && Math.abs(Number(exponent[1])) > BOUNDS.maxExponentMagnitude) {
		throw new FormatterError('BOUND_EXCEEDED', 'number exponent is too large', { transform });
	}
}

const round: TransformDefinition = {
	id: 'number.round',
	category: 'number',
	optionKeys: ['scale', 'mode', 'output'],
	prepare(options, _ctx) {
		const id = this.id;
		const scale = coerceInteger(options['scale'], 'scale', id, { min: 0, max: 100 });
		const mode = coerceOptionalString(options['mode'], 'mode', id) ?? 'half-up';
		const roundingMode = ROUNDING[mode];

		if (roundingMode === undefined) {
			throw new FormatterError(
				'INVALID_OPTION',
				'option "mode" must be toward-zero, away-from-zero, half-up, or half-even',
				{
					transform: id,
				}
			);
		}

		const output = coerceOptionalString(options['output'], 'output', id) ?? 'string';

		if (output !== 'string' && output !== 'number') {
			throw new FormatterError('INVALID_OPTION', 'option "output" must be "string" or "number"', { transform: id });
		}

		return (value) => {
			if (typeof value === 'number' && !Number.isFinite(value)) {
				throw new FormatterError('INVALID_INPUT', 'expected a finite number', { transform: id });
			}

			if (typeof value !== 'number' && typeof value !== 'string') {
				throw new FormatterError('INVALID_INPUT', 'expected a number or a numeric string', { transform: id });
			}

			const raw = typeof value === 'number' ? String(value) : value;
			assertNumericBounds(raw, id);

			let big: InstanceType<typeof Big>;

			try {
				big = new Big(raw);
			} catch {
				throw new FormatterError('INVALID_INPUT', 'input is not a valid decimal number', { transform: id });
			}

			let fixed: string;

			try {
				fixed = big.toFixed(scale, roundingMode);
			} catch {
				throw new FormatterError('INTERNAL', 'the number could not be rounded', { transform: id });
			}

			return output === 'number' ? Number(fixed) : fixed;
		};
	},
};

const STYLES = new Set(['decimal', 'currency', 'percent', 'unit']);

const format: TransformDefinition = {
	id: 'number.format',
	category: 'number',
	optionKeys: [
		'locale',
		'style',
		'currency',
		'unit',
		'notation',
		'percentScale',
		'minimumFractionDigits',
		'maximumFractionDigits',
	],
	prepare(options, ctx) {
		const id = this.id;
		requireCapability(ctx.icu, 'formatting', id);

		const locale = coerceString(options['locale'], 'locale', id);
		requireValidLocale(locale, id);

		const style = coerceOptionalString(options['style'], 'style', id) ?? 'decimal';

		if (!STYLES.has(style)) {
			throw new FormatterError('INVALID_OPTION', 'option "style" must be decimal, currency, percent, or unit', {
				transform: id,
			});
		}

		const nfOptions: Intl.NumberFormatOptions = { style: style as Intl.NumberFormatOptions['style'] };

		if (style === 'currency') nfOptions.currency = coerceString(options['currency'], 'currency', id);
		if (style === 'unit') nfOptions.unit = coerceString(options['unit'], 'unit', id);

		const notation = coerceOptionalString(options['notation'], 'notation', id);

		if (notation !== undefined) {
			if (notation !== 'standard' && notation !== 'compact') {
				throw new FormatterError('INVALID_OPTION', 'option "notation" must be "standard" or "compact"', {
					transform: id,
				});
			}

			nfOptions.notation = notation;
		}

		if (!isAbsent(options['minimumFractionDigits'])) {
			nfOptions.minimumFractionDigits = coerceInteger(options['minimumFractionDigits'], 'minimumFractionDigits', id, {
				min: 0,
				max: 20,
			});
		}

		if (!isAbsent(options['maximumFractionDigits'])) {
			nfOptions.maximumFractionDigits = coerceInteger(options['maximumFractionDigits'], 'maximumFractionDigits', id, {
				min: 0,
				max: 20,
			});
		}

		let dividePercent = false;

		if (style === 'percent') {
			const scale = coerceString(options['percentScale'], 'percentScale', id);

			if (scale === 'points') dividePercent = true;
			else if (scale !== 'fraction') {
				throw new FormatterError('INVALID_OPTION', 'option "percentScale" must be "fraction" or "points"', {
					transform: id,
				});
			}
		}

		let formatter: Intl.NumberFormat;

		try {
			formatter = new Intl.NumberFormat(locale, nfOptions);
		} catch {
			throw new FormatterError('INVALID_OPTION', 'the number formatting options are invalid', { transform: id });
		}

		return (value) => {
			const num = coerceInputNumber(value, id);
			return formatter.format(dividePercent ? num / 100 : num);
		};
	},
};

export const numberTransforms: TransformDefinition[] = [round, format];
