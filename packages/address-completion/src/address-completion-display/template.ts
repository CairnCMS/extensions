import { renderFn } from 'micromustache';

const TEMPLATE_MAX_LENGTH = 1024;
const PATH_PATTERN = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

function resolvePath(rawPath: string, value: Record<string, unknown>): string {
	const path = rawPath.trim();

	if (!PATH_PATTERN.test(path)) {
		throw new Error(`the template path "${path}" is not a dot path`);
	}

	let current: unknown = value;

	for (const part of path.split('.')) {
		if (typeof current !== 'object' || current === null || !Object.hasOwn(current, part)) return '';
		current = (current as Record<string, unknown>)[part];
	}

	return typeof current === 'string' || typeof current === 'number' ? String(current) : '';
}

export function renderTemplate(template: string, value: Record<string, unknown>): string | null {
	if (template.length === 0 || template.length > TEMPLATE_MAX_LENGTH) return null;

	try {
		return renderFn(template, (path) => resolvePath(String(path), value), value, { validateVarNames: true });
	} catch {
		return null;
	}
}
