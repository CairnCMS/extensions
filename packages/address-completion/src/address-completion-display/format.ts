import { classifyValue } from '../shared/value.js';
import { renderTemplate } from './template.js';

export function displayText(value: unknown, template: unknown): string | null {
	const variant = classifyValue(value);
	if (variant !== 'selected' && variant !== 'manual') return null;

	const record = value as Record<string, unknown>;
	const fallback = record['formattedAddress'] as string;

	if (typeof template === 'string' && template.length > 0) {
		return renderTemplate(template, record) ?? fallback;
	}

	return fallback;
}
