import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

function compiledSiblings(dir: string): string[] {
	const found: string[] = [];

	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);

		if (entry.isDirectory()) {
			found.push(...compiledSiblings(full));
		} else if (entry.name.endsWith('.js') || entry.name.endsWith('.js.map') || entry.name.endsWith('.d.ts')) {
			found.push(full);
		}
	}

	return found;
}

describe('the working tree carries no compiled output that could shadow TypeScript sources', () => {
	it('has no emitted .js, .js.map, or .d.ts siblings under src/ or test/', () => {
		expect([...compiledSiblings(join(root, 'src')), ...compiledSiblings(join(root, 'test'))]).toEqual([]);
	});
});
