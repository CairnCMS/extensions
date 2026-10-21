import { types } from 'node:util';
import { BOUNDS, type Bounds } from './bounds.js';
import { FormatterError, type FormatterErrorCode } from './errors.js';
import { isCanonicalArrayIndex } from './plain-array.js';

function jsonEncodedByteLength(s: string, budget = Number.POSITIVE_INFINITY): number {
	if (s.length > budget) return budget + 1;

	let bytes = 2;

	for (let i = 0; i < s.length; i += 1) {
		const c = s.charCodeAt(i);

		if (c === 0x22 || c === 0x5c) bytes += 2;
		else if (c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d) bytes += 2;
		else if (c < 0x20) bytes += 6;
		else if (c < 0x80) bytes += 1;
		else if (c < 0x800) bytes += 2;
		else if (c >= 0xd800 && c <= 0xdbff) {
			const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;

			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				i += 1;
			} else {
				bytes += 6;
			}
		} else if (c >= 0xdc00 && c <= 0xdfff) bytes += 6;
		else bytes += 3;

		if (bytes > budget) return bytes;
	}

	return bytes;
}

export function jsonValueByteLength(value: unknown): number {
	if (value === null) return 4;

	const kind = typeof value;

	if (kind === 'boolean') return 5;
	if (kind === 'number') return Number.isFinite(value) ? String(value).length : 0;
	if (kind === 'string') return jsonEncodedByteLength(value as string);

	if (Array.isArray(value)) {
		let total = 2;
		for (const element of value) total += 1 + jsonValueByteLength(element);
		return total;
	}

	if (kind === 'object') {
		let total = 2;

		for (const key of Object.getOwnPropertyNames(value)) {
			total += jsonEncodedByteLength(key) + 2 + jsonValueByteLength((value as Record<string, unknown>)[key]);
		}

		return total;
	}

	return 0;
}

interface WalkState {
	nodes: number;
	bytes: number;
	seen: Set<object>;
	bounds: Bounds;
	label: string;
	shapeCode: FormatterErrorCode;
}

export interface CloneAccount {
	value: unknown;
	bytes: number;
	nodes: number;
}

export function cloneSourceAccounted(
	source: unknown,
	bounds: Bounds = BOUNDS,
	label = 'source payload',
	shapeCode: FormatterErrorCode = 'SOURCE_SHAPE'
): CloneAccount {
	const state: WalkState = { nodes: 0, bytes: 0, seen: new Set(), bounds, label, shapeCode };
	const value = cloneValue(source, 0, state);
	return { value, bytes: state.bytes, nodes: state.nodes };
}

export function cloneSource(source: unknown, bounds: Bounds = BOUNDS): unknown {
	return cloneSourceAccounted(source, bounds).value;
}

function reject(state: WalkState, reason: string): never {
	throw new FormatterError(state.shapeCode, reason);
}

function accountBytes(bytes: number, state: WalkState): void {
	state.bytes += bytes;

	if (state.bytes > state.bounds.maxSerializedSizeBytes) {
		throw new FormatterError('BOUND_EXCEEDED', `${state.label} is too large`);
	}
}

function accountStringBytes(s: string, extra: number, state: WalkState): void {
	const allowance = state.bounds.maxSerializedSizeBytes - state.bytes - extra;
	const bytes = jsonEncodedByteLength(s, allowance);

	if (bytes > allowance) {
		throw new FormatterError('BOUND_EXCEEDED', `${state.label} is too large`);
	}

	state.bytes += bytes + extra;
}

function countNode(state: WalkState): void {
	state.nodes += 1;

	if (state.nodes > state.bounds.maxSourceNodeCount) {
		throw new FormatterError('BOUND_EXCEEDED', `${state.label} has too many nodes`);
	}
}

function cloneValue(value: unknown, depth: number, state: WalkState): unknown {
	countNode(state);

	if (depth > state.bounds.maxSourceDepth) {
		throw new FormatterError('BOUND_EXCEEDED', `${state.label} is too deeply nested`);
	}

	if (value === null) {
		accountBytes(4, state);
		return null;
	}

	const kind = typeof value;

	if (kind === 'string') {
		accountStringBytes(value as string, 0, state);
		return value;
	}

	if (kind === 'boolean') {
		accountBytes(5, state);
		return value;
	}

	if (kind === 'number') {
		if (!Number.isFinite(value)) reject(state, 'a non-finite number cannot cross the boundary');
		accountBytes(String(value).length, state);
		return value;
	}

	if (kind === 'undefined') reject(state, 'undefined cannot cross the boundary');
	if (kind === 'bigint') reject(state, 'a bigint cannot cross the boundary');
	if (kind === 'symbol') reject(state, 'a symbol cannot cross the boundary');
	if (kind === 'function') reject(state, 'a function cannot cross the boundary');

	if (types.isProxy(value)) reject(state, 'a proxy cannot cross the boundary');

	if (state.seen.has(value as object)) {
		reject(state, 'a cycle or repeated object reference cannot cross the boundary');
	}

	state.seen.add(value as object);

	return Array.isArray(value) ? cloneArray(value, depth, state) : cloneObject(value as object, depth, state);
}

function cloneArray(value: unknown[], depth: number, state: WalkState): unknown[] {
	if (Object.getOwnPropertySymbols(value).length > 0) {
		reject(state, 'a symbol-keyed property cannot cross the boundary');
	}

	for (const name of Object.getOwnPropertyNames(value)) {
		if (name === 'length') continue;

		if (!isCanonicalArrayIndex(name, value.length)) {
			reject(state, 'a non-index array property cannot cross the boundary');
		}
	}

	accountBytes(2, state);
	const out: unknown[] = [];

	for (let i = 0; i < value.length; i += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, i);

		if (descriptor === undefined) reject(state, 'a sparse array cannot cross the boundary');

		if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
			reject(state, 'an accessor property cannot cross the boundary');
		}

		if (!descriptor.enumerable) reject(state, 'a non-enumerable array element cannot cross the boundary');

		accountBytes(1, state);
		out.push(cloneValue(descriptor.value, depth + 1, state));
	}

	return out;
}

function cloneObject(value: object, depth: number, state: WalkState): Record<string, unknown> {
	const prototype = Object.getPrototypeOf(value);

	if (prototype !== Object.prototype && prototype !== null) {
		reject(state, 'an object with a non-plain prototype cannot cross the boundary');
	}

	if (Object.getOwnPropertySymbols(value).length > 0) {
		reject(state, 'a symbol-keyed property cannot cross the boundary');
	}

	accountBytes(2, state);
	const out: Record<string, unknown> = {};

	for (const key of Object.getOwnPropertyNames(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!;

		if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
			reject(state, 'an accessor property cannot cross the boundary');
		}

		if (!descriptor.enumerable) reject(state, 'a non-enumerable property cannot cross the boundary');

		accountStringBytes(key, 2, state);

		Object.defineProperty(out, key, {
			value: cloneValue(descriptor.value, depth + 1, state),
			writable: true,
			enumerable: true,
			configurable: true,
		});
	}

	return out;
}
