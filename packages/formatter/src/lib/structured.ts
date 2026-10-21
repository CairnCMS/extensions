import { types } from 'node:util';
import { BOUNDS } from './bounds.js';
import { cloneSourceAccounted, jsonValueByteLength } from './clone.js';
import { FormatterError, withRuleContext } from './errors.js';
import { applyWithEmptyPolicy, coerceEmptyHandling, type EmptyPolicy } from './fallback.js';
import { classifyStructuredContainer, newBudget, type OptionGraphBudget, parseRuleOptions } from './options.js';
import { applyAtPath, parsePath } from './paths.js';
import { isCanonicalArrayIndex } from './plain-array.js';
import { getTransform, type TransformApplier, type TransformContext } from './registry.js';
import { cloneAndMeasureResult } from './result.js';
import { isFieldRuleEligible } from './transport.js';

interface OperationState {
	budget: OptionGraphBudget;
	invocations: number;
	outputBytes: number;
	processedBytes: number;
}

function requireRuleArray(rules: unknown): unknown[] {
	if (types.isProxy(rules) || !Array.isArray(rules)) {
		throw new FormatterError('INVALID_OPTION', 'the rules option must be an array');
	}

	if (rules.length > BOUNDS.maxRulesPerOperation) {
		throw new FormatterError('BOUND_EXCEEDED', 'the operation has too many rules');
	}

	if (Object.getOwnPropertySymbols(rules).length > 0) {
		throw new FormatterError('INVALID_OPTION', 'the rules option must be a dense array of rule objects');
	}

	for (const name of Object.getOwnPropertyNames(rules)) {
		if (name === 'length') continue;

		if (!isCanonicalArrayIndex(name, rules.length)) {
			throw new FormatterError('INVALID_OPTION', 'the rules option must be a dense array of rule objects');
		}
	}

	return rules;
}

function readRule(rules: unknown[], index: number): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(rules, index);

	if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
		throw new FormatterError('INVALID_OPTION', 'each rule must be a plain object');
	}

	return descriptor.value;
}

function applyLeaf(
	leaf: unknown,
	apply: TransformApplier,
	policy: EmptyPolicy,
	transformId: string,
	state: OperationState
): unknown {
	state.invocations += 1;

	if (state.invocations > BOUNDS.maxInvocationsPerOperation) {
		throw new FormatterError('BOUND_EXCEEDED', 'the operation processed too many field values');
	}

	state.processedBytes += jsonValueByteLength(leaf);

	if (state.processedBytes > BOUNDS.maxProcessedInputBytes) {
		throw new FormatterError('BOUND_EXCEEDED', 'the operation processed too much field content');
	}

	const result = applyWithEmptyPolicy(leaf, policy, apply, transformId);
	const cloned = cloneAndMeasureResult(result);
	state.outputBytes += cloned.bytes - jsonValueByteLength(leaf);

	if (state.outputBytes > BOUNDS.maxAggregateOutputBytes) {
		throw new FormatterError('BOUND_EXCEEDED', 'the output payload is too large');
	}

	return cloned.value;
}

export function runStructured(rawContainer: unknown, ctx: TransformContext): unknown {
	const { source, rules: rulesRaw } = classifyStructuredContainer(rawContainer);

	if (source === null || typeof source !== 'object' || types.isProxy(source)) {
		throw new FormatterError('INVALID_OPTION', 'a source object or array is required');
	}

	const cloned = cloneSourceAccounted(source);
	const payload = cloned.value;
	const rules = requireRuleArray(rulesRaw);

	const state: OperationState = { budget: newBudget(), invocations: 0, outputBytes: cloned.bytes, processedBytes: 0 };

	for (let index = 0; index < rules.length; index += 1) {
		let resolvedTransformId: string | undefined;

		try {
			const rule = parseRuleOptions(readRule(rules, index), state.budget);
			const missingPath = rule.missingPath === undefined ? 'skip' : rule.missingPath;

			if (missingPath !== 'skip' && missingPath !== 'fail') {
				throw new FormatterError('INVALID_OPTION', 'a rule missing-path behavior must be "skip" or "fail"');
			}

			const definition = getTransform(rule.transformId);

			if (definition === undefined) {
				throw new FormatterError('UNKNOWN_TRANSFORM', 'the selected transform is unknown');
			}

			resolvedTransformId = rule.transformId;

			if (!isFieldRuleEligible(rule.transformId)) {
				throw new FormatterError(
					'INVALID_OPTION',
					'this transform returns a diagnostic result and cannot format a field; use it in Format a value mode'
				);
			}

			const apply = definition.prepare(rule.transformOptions, ctx);
			const policy = coerceEmptyHandling(rule.onEmpty, rule.whenEmpty, rule.transformId);
			const segments = parsePath(rule.path);

			const result = applyAtPath(payload, segments, (leaf) => applyLeaf(leaf, apply, policy, rule.transformId, state));

			if (!result.matched && missingPath === 'fail') {
				throw new FormatterError('INVALID_INPUT', 'a rule set to fail on a missing path matched no field');
			}
		} catch (error) {
			throw withRuleContext(error, index, resolvedTransformId);
		}
	}

	return payload;
}
