import type { IcuCapabilities } from './icu.js';

export interface TransformContext {
	icu: IcuCapabilities;
}

export type TransformApplier = (value: unknown) => unknown;

export interface TransformDefinition {
	id: string;
	category: string;
	optionKeys: readonly string[];
	prepare(options: Record<string, unknown>, ctx: TransformContext): TransformApplier;
}

const transforms = new Map<string, TransformDefinition>();

export function registerTransform(definition: TransformDefinition): void {
	if (transforms.has(definition.id)) {
		throw new Error(`duplicate transform id: ${definition.id}`);
	}

	transforms.set(definition.id, definition);
}

export function getTransform(id: string): TransformDefinition | undefined {
	return transforms.get(id);
}

export function listTransforms(): TransformDefinition[] {
	return [...transforms.values()];
}

export function knownOptionKeys(): Set<string> {
	const keys = new Set<string>();

	for (const definition of transforms.values()) {
		for (const key of definition.optionKeys) keys.add(key);
	}

	return keys;
}
