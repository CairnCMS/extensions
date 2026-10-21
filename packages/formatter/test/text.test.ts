import { describe, expect, it } from 'vitest';
import { BOUNDS } from '../src/lib/bounds.js';
import { FormatterError } from '../src/lib/errors.js';
import type { IcuCapabilities } from '../src/lib/icu.js';
import { getTransform, type TransformContext } from '../src/lib/registry.js';
import { registerBuiltins } from '../src/lib/index.js';

registerBuiltins();

const full: IcuCapabilities = { normalize: true, casing: true, formatting: true };
const none: IcuCapabilities = { normalize: false, casing: false, formatting: false };

function run(id: string, value: unknown, options: Record<string, unknown> = {}, icu: IcuCapabilities = full): unknown {
	const def = getTransform(id);
	if (!def) throw new Error(`no transform ${id}`);
	const ctx: TransformContext = { icu };
	return def.prepare(options, ctx)(value);
}

function prepare(id: string, options: Record<string, unknown>): (value: unknown) => unknown {
	return getTransform(id)!.prepare(options, { icu: full });
}

function caught(fn: () => unknown): FormatterError {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(FormatterError);
		return error as FormatterError;
	}

	throw new Error('expected a rejection');
}

describe('text transforms happy paths', () => {
	it('trim, with optional collapse', () => {
		expect(run('text.trim', '  a  ')).toBe('a');
		expect(run('text.trim', ' a   b ', { collapse: true })).toBe('a b');
	});

	it('uppercase and lowercase, plain and locale-sensitive', () => {
		expect(run('text.uppercase', 'aB')).toBe('AB');
		expect(run('text.lowercase', 'aB')).toBe('ab');
		expect(run('text.uppercase', 'istanbul', { locale: 'tr' })).toBe('İSTANBUL');
	});

	it('normalize collapses a decomposed sequence', () => {
		expect(run('text.normalize', 'é')).toBe('é');
	});

	it('truncate, with and without ellipsis', () => {
		expect(run('text.truncate', 'abcdef', { maxLength: 3 })).toBe('abc');
		expect(run('text.truncate', 'abcdef', { maxLength: 3, ellipsis: true })).toBe('ab…');
		expect(run('text.truncate', 'ab', { maxLength: 5 })).toBe('ab');
	});

	it('replace is literal, not regex', () => {
		expect(run('text.replace', 'a.b.c', { find: '.', replaceWith: '-' })).toBe('a-b-c');
	});

	it('slugify', () => {
		expect(run('text.slugify', 'Hello, World!')).toBe('hello-world');
	});
});

describe('text transforms are idempotent where the doctrine requires it', () => {
	const cases: Array<[string, string, Record<string, unknown>]> = [
		['text.trim', '  a b  ', { collapse: true }],
		['text.normalize', 'é', {}],
		['text.uppercase', 'abc', {}],
		['text.lowercase', 'ABC', {}],
		['text.slugify', 'Hello World', {}],
	];

	for (const [id, input, opts] of cases) {
		it(`${id} f(f(x)) === f(x)`, () => {
			const once = run(id, input, opts) as string;
			const twice = run(id, once, opts) as string;
			expect(twice).toBe(once);
		});
	}
});

describe('text transforms fail loudly', () => {
	it('rejects non-string input', () => {
		expect(() => run('text.trim', 42)).toThrow(FormatterError);
	});

	it('rejects an empty find', () => {
		expect(() => run('text.replace', 'x', { find: '' })).toThrow(/must not be empty/);
	});

	it('rejects a non-integer maxLength', () => {
		expect(() => run('text.truncate', 'x', { maxLength: 1.5 })).toThrow(/integer/);
	});

	it('never leaks the input value into the error message and never coerces it', () => {
		let toStringInvoked = false;

		const hostile = {
			toString: () => {
				toStringInvoked = true;
				return 'do-not-leak';
			},
		};

		let caught: unknown;

		try {
			run('text.trim', hostile);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(FormatterError);
		expect((caught as FormatterError).code).toBe('INVALID_INPUT');
		expect((caught as Error).message).not.toContain('do-not-leak');
		expect(toStringInvoked).toBe(false);
	});

	it('rejects an input string over the length bound', () => {
		expect(() => run('text.trim', 'x'.repeat(100_001))).toThrow(/too long/);
	});

	it('rejects a revoked-proxy input with a typed FormatterError', () => {
		const { proxy, revoke } = Proxy.revocable({}, {});
		revoke();
		expect(() => run('text.trim', proxy)).toThrow(FormatterError);
	});

	it('refuses a replacement whose projected output would exceed the bound, before allocating it', () => {
		const input = 'a'.repeat(50_000);
		const split = String.prototype.split;

		String.prototype.split = function (): never {
			throw new Error('SPLIT_CALLED');
		} as unknown as typeof split;

		try {
			expect(() => run('text.replace', input, { find: 'a', replaceWith: 'b'.repeat(1000) })).toThrow(
				/output is too long/
			);
		} finally {
			String.prototype.split = split;
		}
	});

	it('truncate never exceeds max and never splits a surrogate pair', () => {
		expect(run('text.truncate', 'abc', { maxLength: 0, ellipsis: true })).toBe('');
		const emoji = '👍👍👍';
		const out = run('text.truncate', emoji, { maxLength: 3 }) as string;
		expect(out.length).toBeLessThanOrEqual(3);
		expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false);
	});
});

describe('text limits hold one below, at, and one above their ceilings', () => {
	it('accepts a text input one below and at the input length limit', () => {
		const limit = BOUNDS.maxInputStringLength;

		expect(run('text.trim', 'x'.repeat(limit - 1))).toHaveLength(limit - 1);
		expect(run('text.trim', 'x'.repeat(limit))).toHaveLength(limit);
	});

	it('accepts a Text: Replace output one below and at the output limit and refuses one more character', () => {
		const limit = BOUNDS.maxOutputLength;
		const apply = prepare('text.replace', { find: 'a', replaceWith: 'b'.repeat(1000) });
		const copies = Math.floor(limit / 1000) - 1;
		const input = (outputLength: number): string => 'a'.repeat(copies) + 'c'.repeat(outputLength - copies * 1000);

		expect(apply(input(limit - 1))).toHaveLength(limit - 1);
		expect(apply(input(limit))).toHaveLength(limit);

		const error = caught(() => apply(input(limit + 1)));
		expect(error.code).toBe('BOUND_EXCEEDED');
		expect(error.message).toMatch(/output is too long/);
	});

	it('accepts a Text: Truncate maximum length one below and at the output limit and refuses one more', () => {
		const limit = BOUNDS.maxOutputLength;

		expect(prepare('text.truncate', { maxLength: limit - 1 })('abc')).toBe('abc');
		expect(prepare('text.truncate', { maxLength: limit })('abc')).toBe('abc');

		const error = caught(() => prepare('text.truncate', { maxLength: limit + 1 }));
		expect(error.code).toBe('INVALID_OPTION');
		expect(error.message).toMatch(`option "maxLength" must be at most ${limit}`);
	});

	it('accepts a maximum length written as text one below and at the setting length limit and refuses one more character', () => {
		const limit = BOUNDS.maxOptionStringLength;
		const padded = (length: number): string => '1'.padStart(length, '0');

		expect(prepare('text.truncate', { maxLength: padded(limit - 1) })('abc')).toBe('a');
		expect(prepare('text.truncate', { maxLength: padded(limit) })('abc')).toBe('a');

		const error = caught(() => prepare('text.truncate', { maxLength: padded(limit + 1) }));
		expect(error.code).toBe('BOUND_EXCEEDED');
		expect(error.message).toMatch(/option "maxLength" is too long/);
	});

	it('accepts Find and Replace with one below and at their length limit and refuses one more character', () => {
		const limit = BOUNDS.maxReplacementInputLength;

		for (const option of ['find', 'replaceWith']) {
			const options = (length: number): Record<string, unknown> => ({ find: 'a', [option]: 'b'.repeat(length) });

			expect(() => prepare('text.replace', options(limit - 1)), option).not.toThrow();
			expect(() => prepare('text.replace', options(limit)), option).not.toThrow();

			const error = caught(() => prepare('text.replace', options(limit + 1)));
			expect(error.code, option).toBe('BOUND_EXCEEDED');
			expect(error.message, option).toMatch(`option "${option}" is too long`);
		}
	});
});

describe('text transforms gate on measured ICU capability', () => {
	it('normalize is refused when the capability is absent', () => {
		expect(() => run('text.normalize', 'é', {}, none)).toThrow(/normalization is unavailable/);
	});

	it('locale casing is refused when the capability is absent, plain casing still works', () => {
		expect(() => run('text.uppercase', 'istanbul', { locale: 'tr' }, none)).toThrow(/casing is unavailable/);
		expect(run('text.uppercase', 'abc', {}, none)).toBe('ABC');
	});

	it('slugify is refused at prepare when normalization is absent', () => {
		const def = getTransform('text.slugify');
		if (!def) throw new Error('no transform text.slugify');

		let caught: unknown;

		try {
			def.prepare({}, { icu: none });
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(FormatterError);
		expect((caught as FormatterError).code).toBe('ICU_UNAVAILABLE');
		expect((caught as Error).message).toMatch(/normalization is unavailable/);
	});

	it('slugify needs only normalization, not full locale formatting', () => {
		const normalizeOnly: IcuCapabilities = { normalize: true, casing: true, formatting: false };
		expect(run('text.slugify', 'Ǻngström Ṁṻṡĩç', {}, normalizeOnly)).toBe('angstroem-music');
	});
});
