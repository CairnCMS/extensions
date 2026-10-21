import { BOUNDS, type Bounds } from './bounds.js';
import { describeType, FormatterError } from './errors.js';

export type PathSegment = { kind: 'key'; key: string } | { kind: 'wildcard' };

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function parsePath(path: unknown, transform?: string): PathSegment[] {
	if (typeof path !== 'string') {
		throw new FormatterError('INVALID_PATH', `path must be a string, got ${describeType(path)}`, { transform });
	}

	if (path.length === 0) {
		throw new FormatterError('INVALID_PATH', 'path must be a non-empty string', { transform });
	}

	if (path.length > BOUNDS.maxPathLength) {
		throw new FormatterError('INVALID_PATH', 'path is too long', { transform });
	}

	const segments: PathSegment[] = [];
	let wildcards = 0;

	for (const part of path.split('.')) {
		const match = part.match(/^([^[\]]*)(\[\*\])?$/);

		if (match === null) {
			throw new FormatterError('INVALID_PATH', 'path segment is malformed', { transform });
		}

		const key = match[1] ?? '';
		const wildcard = match[2] !== undefined;

		if (key.length > 0) {
			if (FORBIDDEN_KEYS.has(key)) {
				throw new FormatterError(
					'INVALID_PATH',
					'a path segment names a forbidden property (__proto__, prototype, or constructor)',
					{ transform }
				);
			}

			segments.push({ kind: 'key', key });
		} else if (!wildcard) {
			throw new FormatterError('INVALID_PATH', 'path has an empty segment', { transform });
		}

		if (wildcard) {
			wildcards += 1;

			if (wildcards > 1) {
				throw new FormatterError('INVALID_PATH', 'a path may contain at most one [*] wildcard', { transform });
			}

			segments.push({ kind: 'wildcard' });
		}
	}

	if (segments.length > BOUNDS.maxPathDepth) {
		throw new FormatterError('INVALID_PATH', 'path is too deep', { transform });
	}

	return segments;
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
	return value !== null && typeof value === 'object';
}

export interface ApplyResult {
	matched: boolean;
}

export function applyAtPath(
	root: unknown,
	segments: PathSegment[],
	apply: (leaf: unknown) => unknown,
	bounds: Bounds = BOUNDS
): ApplyResult {
	const state = { wildcardMatches: 0 };
	return walk(root, segments, 0, apply, bounds, state);
}

function walk(
	node: unknown,
	segments: PathSegment[],
	index: number,
	apply: (leaf: unknown) => unknown,
	bounds: Bounds,
	state: { wildcardMatches: number }
): ApplyResult {
	const segment = segments[index]!;
	const isLast = index === segments.length - 1;

	if (segment.kind === 'wildcard') {
		if (!Array.isArray(node)) return { matched: false };

		let matched = false;

		for (let i = 0; i < node.length; i += 1) {
			state.wildcardMatches += 1;

			if (state.wildcardMatches > bounds.maxWildcardMatches) {
				throw new FormatterError('BOUND_EXCEEDED', 'too many wildcard matches');
			}

			if (isLast) {
				node[i] = apply(node[i]);
				matched = true;
			} else if (isContainer(node[i])) {
				const result = walk(node[i], segments, index + 1, apply, bounds, state);
				matched = matched || result.matched;
			}
		}

		return { matched };
	}

	if (node === null || typeof node !== 'object' || Array.isArray(node)) {
		return { matched: false };
	}

	const record = node as Record<string, unknown>;

	if (!Object.prototype.hasOwnProperty.call(record, segment.key)) {
		return { matched: false };
	}

	if (isLast) {
		record[segment.key] = apply(record[segment.key]);
		return { matched: true };
	}

	if (!isContainer(record[segment.key])) {
		return { matched: false };
	}

	return walk(record[segment.key], segments, index + 1, apply, bounds, state);
}
