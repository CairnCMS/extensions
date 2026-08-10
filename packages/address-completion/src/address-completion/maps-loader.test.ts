// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const READY_CALLBACK = '__cairncmsAddressCompletionMapsReady';

let appended: HTMLScriptElement[] = [];

function fireReady() {
	const holder = window as unknown as Record<string, () => void>;
	holder[READY_CALLBACK]!();
}

async function freshLoader() {
	vi.resetModules();
	const module = await import('./maps-loader.js');
	return module.loadGoogleMaps;
}

beforeEach(() => {
	appended = [];

	vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
		appended.push(node as HTMLScriptElement);
		return node;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('loadGoogleMaps', () => {
	it('injects one script with the pinned channel and libraries, resolving on the ready callback', async () => {
		const loadGoogleMaps = await freshLoader();

		const first = loadGoogleMaps('browser-key-1');
		const second = loadGoogleMaps('browser-key-1');

		expect(appended).toHaveLength(1);
		const url = new URL(appended[0]!.src);
		expect(url.origin).toBe('https://maps.googleapis.com');
		expect(url.pathname).toBe('/maps/api/js');
		expect(url.searchParams.get('key')).toBe('browser-key-1');
		expect(url.searchParams.get('v')).toBe('quarterly');
		expect(url.searchParams.get('libraries')).toBe('maps,marker');
		expect(url.searchParams.get('loading')).toBe('async');
		expect(url.searchParams.get('callback')).toBe(READY_CALLBACK);

		fireReady();
		await expect(first).resolves.toBeUndefined();
		await expect(second).resolves.toBeUndefined();
		expect((window as unknown as Record<string, unknown>)[READY_CALLBACK]).toBeUndefined();
	});

	it('clears a rejected load so retry injects a fresh script', async () => {
		const loadGoogleMaps = await freshLoader();

		const failed = loadGoogleMaps('browser-key-1');
		appended[0]!.onerror!(new Event('error'));
		await expect(failed).rejects.toThrow('the Google Maps script failed to load');

		const retried = loadGoogleMaps('browser-key-1');
		expect(appended).toHaveLength(2);

		fireReady();
		await expect(retried).resolves.toBeUndefined();
	});
});
