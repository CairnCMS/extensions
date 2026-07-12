const FIELD_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

// The scheme and host must be literal, i.e. only path, query, and fragment may interpolate
// item values, so a value can never move the frame off the configured origin.
export function templateOrigin(template) {
	if (typeof template !== 'string') return null;

	const match = /^(https?):\/\/([^/?#]+)/.exec(template);
	if (!match) return null;
	if (match[2].includes('{{')) return null;
	if (match[2].includes('@')) return null;

	try {
		return new URL(`${match[1]}://${match[2]}`).origin;
	} catch {
		return null;
	}
}

export function isValidTemplate(template) {
	return typeof template === 'string' && templateOrigin(template) !== null;
}

export function fieldsInTemplate(template) {
	if (typeof template !== 'string') return [];

	const fields = new Set();
	let match;

	FIELD_PATTERN.lastIndex = 0;

	while ((match = FIELD_PATTERN.exec(template)) !== null) {
		fields.add(match[1].trim());
	}

	return [...fields];
}

function valueAt(values, path) {
	let current = values;

	for (const part of path.split('.')) {
		if (current === null || current === undefined || typeof current !== 'object') return undefined;

		// Inherited keys (constructor, a polluted prototype) never resolve into a URL.
		if (Object.prototype.hasOwnProperty.call(current, part) === false) return undefined;

		current = current[part];
	}

	return current;
}

export function renderPreviewUrl(template, values) {
	const origin = templateOrigin(template);
	if (origin === null) return null;

	const rendered = template.replace(FIELD_PATTERN, (_, field) => {
		const value = valueAt(values ?? {}, field.trim());
		if (value === null || value === undefined) return '';
		return encodeURIComponent(typeof value === 'object' ? JSON.stringify(value) : String(value));
	});

	let url;

	try {
		url = new URL(rendered);
	} catch {
		return null;
	}

	if (url.origin !== origin) return null;
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (url.username !== '' || url.password !== '') return null;

	return url.toString();
}
