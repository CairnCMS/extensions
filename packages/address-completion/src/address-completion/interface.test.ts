// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const api = {
	get: vi.fn(),
	post: vi.fn(),
};

vi.mock('@cairncms/extensions-sdk', () => ({
	useApi: () => api,
	useStores: () => ({
		useUserStore: () => ({ currentUser: { language: 'en-US' } }),
		useServerStore: () => ({ info: { project: { default_language: 'de-DE' } } }),
	}),
}));

const loadGoogleMaps = vi.fn();

vi.mock('./maps-loader.js', () => ({
	loadGoogleMaps: (key: string) => loadGoogleMaps(key),
}));

import Interface from './interface.vue';

class MapMock {
	static instances: MapMock[] = [];
	options: Record<string, unknown>;
	setCenter = vi.fn();
	setZoom = vi.fn();

	constructor(_element: unknown, options: Record<string, unknown>) {
		this.options = options;
		MapMock.instances.push(this);
	}
}

class MarkerMock {
	static instances: MarkerMock[] = [];
	map: unknown;
	position: unknown = undefined;

	constructor(options: { map: unknown }) {
		this.map = options.map;
		MarkerMock.instances.push(this);
	}
}

const SELECTED = {
	version: 1,
	formattedAddress: '12345 College Blvd, Overland Park, KS 66210, USA',
	placeId: 'ChIJgU60wNLqwIcRzYBIZgwf1io',
	location: { latitude: 38.9249484, longitude: -94.7269431, observedAt: '2026-08-09T14:22:24.388Z' },
	components: { locality: 'Overland Park', region: 'KS', postalCode: '66210', countryCode: 'US' },
};

const GOOGLE_PLACE = {
	id: 'ChIJnew',
	formattedAddress: '10 Downing St, London SW1A 2AA, UK',
	location: { latitude: 51.5033635, longitude: -0.1276248 },
	addressComponents: [{ types: ['postal_town'], longText: 'London', shortText: 'London' }],
};

const OBSERVED_AT = '2026-08-09T16:00:00.000Z';

const VInput = defineComponent({
	props: ['modelValue', 'disabled', 'maxlength', 'placeholder'],
	emits: ['update:model-value', 'focus'],
	template:
		'<div class="v-input" :data-model-value="modelValue ?? \'\'"><slot name="prepend" /><slot name="append" /></div>',
});

const VMenu = defineComponent({
	props: ['attached', 'disabled'],
	setup: () => ({ activate: () => undefined }),
	template: '<div class="v-menu"><slot name="activator" :activate="activate" /><slot /></div>',
});

const stubs = {
	'v-input': VInput,
	'v-menu': VMenu,
	'v-list': defineComponent({ template: '<div class="v-list"><slot /></div>' }),
	'v-list-item': defineComponent({
		props: ['clickable'],
		emits: ['click'],
		template: '<div class="v-list-item" @click="$emit(\'click\', $event)"><slot /></div>',
	}),
	'v-list-item-content': defineComponent({ template: '<div><slot /></div>' }),
	'v-notice': defineComponent({ props: ['type'], template: '<div class="v-notice" :data-type="type"><slot /></div>' }),
	'v-icon': defineComponent({
		props: ['name', 'small', 'clickable'],
		emits: ['click'],
		template: '<span class="v-icon" :data-name="name" @click="$emit(\'click\', $event)"></span>',
	}),
	'v-button': defineComponent({
		props: ['xSmall', 'secondary'],
		emits: ['click'],
		template: '<button class="v-button" @click="$emit(\'click\', $event)"><slot /></button>',
	}),
	'v-progress-circular': defineComponent({ props: ['indeterminate'], template: '<span class="v-progress"></span>' }),
};

let appSettings: Record<string, unknown> = {};
let settingsFailure = false;

function defaultApiGet(url: string) {
	if (url.startsWith('/extension-settings/app')) {
		if (settingsFailure) return Promise.reject(new Error('offline'));
		return Promise.resolve({ data: { data: appSettings } });
	}

	return Promise.resolve({ data: { place: GOOGLE_PLACE, observedAt: OBSERVED_AT } });
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;

	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

async function mountInterface(props: Record<string, unknown> = {}) {
	const wrapper = mount(Interface, {
		props,
		global: { stubs, directives: { tooltip: {} } },
	});

	await flushPromises();
	return wrapper;
}

function typeText(wrapper: Awaited<ReturnType<typeof mountInterface>>, text: string | null) {
	const stub = wrapper.findComponent<InstanceType<typeof VInput>>('.v-input');
	stub.vm.$emit('update:model-value', text);
}

function lastEmitted(wrapper: Awaited<ReturnType<typeof mountInterface>>) {
	const events = wrapper.emitted('input');
	return events ? events[events.length - 1]![0] : undefined;
}

function suggestionBody(index = 0): Record<string, unknown> {
	return JSON.parse(JSON.stringify(api.post.mock.calls[index]![1]));
}

beforeEach(() => {
	vi.clearAllMocks();
	appSettings = {};
	settingsFailure = false;
	MapMock.instances = [];
	MarkerMock.instances = [];
	api.get.mockImplementation(defaultApiGet);
	api.post.mockResolvedValue({ data: { suggestions: [{ placeId: 'ChIJnew', text: '10 Downing St, London' }] } });
	loadGoogleMaps.mockResolvedValue(undefined);

	(globalThis as Record<string, unknown>)['google'] = {
		maps: {
			importLibrary: vi.fn(async (name: string) =>
				name === 'maps' ? { Map: MapMock } : { AdvancedMarkerElement: MarkerMock }
			),
		},
	};
});

afterEach(() => {
	vi.useRealTimers();
});

async function typeAndSettle(wrapper: Awaited<ReturnType<typeof mountInterface>>, text: string) {
	typeText(wrapper, text);
	await vi.advanceTimersByTimeAsync(300);
	await flushPromises();
}

describe('value synchronization', () => {
	it('mounts with a stored value without emitting and shows its address', async () => {
		const wrapper = await mountInterface({ value: SELECTED });
		expect(wrapper.emitted('input')).toBeUndefined();
		expect(wrapper.find('.v-input').attributes('data-model-value')).toBe(SELECTED.formattedAddress);
	});

	it('syncs an external value update without emitting', async () => {
		const wrapper = await mountInterface({ value: SELECTED });
		await wrapper.setProps({ value: { version: 1, formattedAddress: 'Elsewhere' } });
		expect(wrapper.emitted('input')).toBeUndefined();
		expect(wrapper.find('.v-input').attributes('data-model-value')).toBe('Elsewhere');
	});

	it('emits the trimmed Manual record on typing and null on emptying', async () => {
		const wrapper = await mountInterface();
		typeText(wrapper, ' Warehouse dock 3 ');
		expect(lastEmitted(wrapper)).toEqual({ version: 1, formattedAddress: 'Warehouse dock 3' });

		typeText(wrapper, null);
		expect(lastEmitted(wrapper)).toBeNull();
	});

	it('keeps a trailing space when the form echoes the manual emission back', async () => {
		const wrapper = await mountInterface();
		typeText(wrapper, '10 ');
		expect(lastEmitted(wrapper)).toEqual({ version: 1, formattedAddress: '10' });

		await wrapper.setProps({ value: { version: 1, formattedAddress: '10' } });
		expect(wrapper.find('.v-input').attributes('data-model-value')).toBe('10 ');
	});
});

describe('autocomplete', () => {
	it('sends the pinned request body after the debounce', async () => {
		vi.useFakeTimers();

		const wrapper = await mountInterface({
			countries: ['GB'],
			scope: 'cities',
			biasLatitude: 44,
			biasLongitude: -70,
			biasRadiusMeters: 50000,
		});

		await typeAndSettle(wrapper, 'Cambridge');

		expect(api.post).toHaveBeenCalledTimes(1);
		expect(api.post.mock.calls[0]![0]).toBe('/address-completion-api/autocomplete');

		const body = suggestionBody();
		expect(body['input']).toBe('Cambridge');
		expect(body['languageCode']).toBe('en-US');
		expect(body['countries']).toEqual(['GB']);
		expect(body['scope']).toBe('cities');
		expect(body['bias']).toEqual({ latitude: 44, longitude: -70, radiusMeters: 50000 });
		expect(body['sessionToken']).toMatch(/^[A-Za-z0-9-]{36}$/);

		expect(wrapper.findAll('.v-list-item')).toHaveLength(1);
	});

	it('clears prior suggestions the moment typing resumes', async () => {
		vi.useFakeTimers();
		const wrapper = await mountInterface();
		await typeAndSettle(wrapper, 'Cambridge');
		expect(wrapper.findAll('.v-list-item')).toHaveLength(1);

		typeText(wrapper, 'Cambridge M');
		await flushPromises();
		expect(wrapper.findAll('.v-list-item')).toHaveLength(0);
	});

	it('discards a stale autocomplete response', async () => {
		vi.useFakeTimers();
		const wrapper = await mountInterface();

		const slow = deferred<{ data: { suggestions: unknown[] } }>();
		const fast = deferred<{ data: { suggestions: unknown[] } }>();
		api.post.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

		await typeAndSettle(wrapper, 'first');
		await typeAndSettle(wrapper, 'second');

		fast.resolve({ data: { suggestions: [{ placeId: 'ChIJb', text: 'second result' }] } });
		await flushPromises();
		slow.resolve({ data: { suggestions: [{ placeId: 'ChIJa', text: 'first result' }] } });
		await flushPromises();

		const items = wrapper.findAll('.v-list-item');
		expect(items).toHaveLength(1);
		expect(items[0]!.text()).toBe('second result');
	});

	it('does not search when the field configuration is invalid', async () => {
		vi.useFakeTimers();
		const wrapper = await mountInterface({ countries: Array(16).fill('GB') });
		expect(wrapper.find('.v-notice').text()).toContain('at most 15');

		await typeAndSettle(wrapper, 'Cambridge');
		expect(api.post).not.toHaveBeenCalled();
	});

	it('rejects a partial bias configuration', async () => {
		const wrapper = await mountInterface({ biasLatitude: 44 });
		expect(wrapper.find('.v-notice').text()).toContain('latitude, longitude, and radius together');
	});
});

describe('selection and session tokens', () => {
	it('resolves details with the captured token, emits the Selected record, and rotates the token', async () => {
		vi.useFakeTimers();
		const wrapper = await mountInterface();
		await typeAndSettle(wrapper, 'Downing');
		const firstToken = suggestionBody()['sessionToken'];

		const emissionsBeforeSelect = (wrapper.emitted('input') ?? []).length;

		await wrapper.find('.v-list-item').trigger('click');
		await flushPromises();

		expect(api.get).toHaveBeenLastCalledWith(
			'/address-completion-api/place/ChIJnew',
			expect.objectContaining({ params: expect.objectContaining({ sessionToken: firstToken }) })
		);

		expect(wrapper.emitted('input')).toHaveLength(emissionsBeforeSelect + 1);

		expect(lastEmitted(wrapper)).toEqual({
			version: 1,
			formattedAddress: GOOGLE_PLACE.formattedAddress,
			placeId: GOOGLE_PLACE.id,
			location: { latitude: 51.5033635, longitude: -0.1276248, observedAt: OBSERVED_AT },
			components: { locality: 'London' },
		});

		await typeAndSettle(wrapper, 'next search');
		expect(suggestionBody(1)['sessionToken']).not.toBe(firstToken);
	});

	it('rotates the live token before the pending details request settles', async () => {
		vi.useFakeTimers();
		const wrapper = await mountInterface();
		await typeAndSettle(wrapper, 'Downing');
		const firstToken = suggestionBody(0)['sessionToken'];

		const pending = deferred<{ data: { place: unknown; observedAt: string } }>();

		api.get.mockImplementation((url: string) =>
			url.startsWith('/extension-settings/app') ? defaultApiGet(url) : pending.promise
		);

		await wrapper.find('.v-list-item').trigger('click');
		await typeAndSettle(wrapper, 'next search');

		expect(suggestionBody(1)['sessionToken']).not.toBe(firstToken);

		pending.resolve({ data: { place: GOOGLE_PLACE, observedAt: OBSERVED_AT } });
		await flushPromises();
		expect(lastEmitted(wrapper)).toEqual({ version: 1, formattedAddress: 'next search' });
	});

	it('keeps a newer operation busy when a stale request settles', async () => {
		vi.useFakeTimers();
		const wrapper = await mountInterface();
		await typeAndSettle(wrapper, 'first');

		const staleDetails = deferred<{ data: { place: unknown; observedAt: string } }>();
		const activeDetails = deferred<{ data: { place: unknown; observedAt: string } }>();
		let detailsCalls = 0;

		api.get.mockImplementation((url: string) => {
			if (url.startsWith('/extension-settings/app')) return defaultApiGet(url);
			detailsCalls += 1;
			return detailsCalls === 1 ? staleDetails.promise : activeDetails.promise;
		});

		await wrapper.find('.v-list-item').trigger('click');
		await typeAndSettle(wrapper, 'second');
		await wrapper.find('.v-list-item').trigger('click');
		expect(wrapper.find('.v-progress').exists()).toBe(true);

		staleDetails.resolve({ data: { place: GOOGLE_PLACE, observedAt: OBSERVED_AT } });
		await flushPromises();
		expect(wrapper.find('.v-progress').exists()).toBe(true);

		activeDetails.resolve({ data: { place: GOOGLE_PLACE, observedAt: OBSERVED_AT } });
		await flushPromises();
		expect(wrapper.find('.v-progress').exists()).toBe(false);
		expect((lastEmitted(wrapper) as Record<string, unknown>)['placeId']).toBe(GOOGLE_PLACE.id);
	});

	it('reports a rejected details request without emitting and retries it once asked', async () => {
		vi.useFakeTimers();
		const wrapper = await mountInterface();
		await typeAndSettle(wrapper, 'Downing');

		let detailsCalls = 0;

		api.get.mockImplementation((url: string) => {
			if (url.startsWith('/extension-settings/app')) return defaultApiGet(url);
			detailsCalls += 1;
			return Promise.reject({ response: { data: { error: { code: 'UPSTREAM_RATE_LIMITED', message: 'slow down' } } } });
		});

		const emissionsBefore = (wrapper.emitted('input') ?? []).length;
		await wrapper.find('.v-list-item').trigger('click');
		await flushPromises();

		expect((wrapper.emitted('input') ?? []).length).toBe(emissionsBefore);
		expect(wrapper.find('.v-notice').text()).toContain('rate-limited');

		await wrapper.find('.v-button').trigger('click');
		await flushPromises();
		expect(detailsCalls).toBe(2);
	});

	it('discards a late details response after typing resumed and frees the busy state', async () => {
		vi.useFakeTimers();
		const wrapper = await mountInterface();
		await typeAndSettle(wrapper, 'Downing');

		const pending = deferred<{ data: { place: unknown; observedAt: string } }>();

		api.get.mockImplementation((url: string) =>
			url.startsWith('/extension-settings/app') ? defaultApiGet(url) : pending.promise
		);

		await wrapper.find('.v-list-item').trigger('click');
		expect(wrapper.find('.v-progress').exists()).toBe(true);

		typeText(wrapper, 'changed my mind');
		await flushPromises();
		expect(wrapper.find('.v-progress').exists()).toBe(false);

		pending.resolve({ data: { place: GOOGLE_PLACE, observedAt: OBSERVED_AT } });
		await flushPromises();

		expect(lastEmitted(wrapper)).toEqual({ version: 1, formattedAddress: 'changed my mind' });
	});

	it('keeps the Manual record and explains when details come back incomplete', async () => {
		vi.useFakeTimers();
		const wrapper = await mountInterface();
		await typeAndSettle(wrapper, 'Downing');

		api.get.mockImplementation((url: string) =>
			url.startsWith('/extension-settings/app')
				? defaultApiGet(url)
				: Promise.resolve({ data: { place: { id: 'ChIJnew', formattedAddress: 'x' }, observedAt: OBSERVED_AT } })
		);

		await wrapper.find('.v-list-item').trigger('click');
		await flushPromises();

		expect(lastEmitted(wrapper)).toEqual({ version: 1, formattedAddress: 'Downing' });
		expect(wrapper.find('.v-notice').text()).toContain('incomplete place');
	});

	it('resets pending work and the session on an identity change', async () => {
		vi.useFakeTimers();
		const wrapper = await mountInterface({ primaryKey: 1 });
		await typeAndSettle(wrapper, 'Downing');
		const firstToken = suggestionBody()['sessionToken'];

		const pending = deferred<{ data: { place: unknown; observedAt: string } }>();

		api.get.mockImplementation((url: string) =>
			url.startsWith('/extension-settings/app') ? defaultApiGet(url) : pending.promise
		);

		await wrapper.find('.v-list-item').trigger('click');
		await wrapper.setProps({ primaryKey: 2 });

		pending.resolve({ data: { place: GOOGLE_PLACE, observedAt: OBSERVED_AT } });
		await flushPromises();

		const emissions = wrapper.emitted('input') ?? [];
		expect(emissions[emissions.length - 1]![0]).toEqual({ version: 1, formattedAddress: 'Downing' });

		await typeAndSettle(wrapper, 'after navigation');
		expect(suggestionBody(1)['sessionToken']).not.toBe(firstToken);
	});
});

describe('refresh', () => {
	it('re-resolves the stored place without a session token and emits exactly one fresh record', async () => {
		const wrapper = await mountInterface({ value: SELECTED });

		await wrapper.find('.v-icon[data-name="autorenew"]').trigger('click');
		await flushPromises();

		expect(api.get).toHaveBeenLastCalledWith(`/address-completion-api/place/${SELECTED.placeId}`, {
			params: { languageCode: 'en-US' },
		});

		const emissions = wrapper.emitted('input') ?? [];
		expect(emissions).toHaveLength(1);

		expect(emissions[0]![0]).toEqual({
			version: 1,
			formattedAddress: GOOGLE_PLACE.formattedAddress,
			placeId: GOOGLE_PLACE.id,
			location: { latitude: 51.5033635, longitude: -0.1276248, observedAt: OBSERVED_AT },
			components: { locality: 'London' },
		});
	});

	it('keeps the stored record and explains when the refreshed place is incomplete', async () => {
		api.get.mockImplementation((url: string) =>
			url.startsWith('/extension-settings/app')
				? defaultApiGet(url)
				: Promise.resolve({ data: { place: { id: 'ChIJnew' }, observedAt: OBSERVED_AT } })
		);

		const wrapper = await mountInterface({ value: SELECTED });
		await wrapper.find('.v-icon[data-name="autorenew"]').trigger('click');
		await flushPromises();

		expect(wrapper.emitted('input')).toBeUndefined();
		expect(wrapper.find('.v-notice').text()).toContain('kept unchanged');
	});

	it('offers retry when the refresh request fails', async () => {
		let detailsCalls = 0;

		api.get.mockImplementation((url: string) => {
			if (url.startsWith('/extension-settings/app')) return defaultApiGet(url);
			detailsCalls += 1;
			return Promise.reject({ response: { data: { error: { code: 'UPSTREAM_FAILED', message: 'x' } } } });
		});

		const wrapper = await mountInterface({ value: SELECTED });
		await wrapper.find('.v-icon[data-name="autorenew"]').trigger('click');
		await flushPromises();

		expect(wrapper.emitted('input')).toBeUndefined();
		const retryButton = wrapper.find('.v-button');
		expect(retryButton.exists()).toBe(true);

		await retryButton.trigger('click');
		await flushPromises();
		expect(detailsCalls).toBe(2);
	});
});

describe('failures and notices', () => {
	function failWith(code: string) {
		api.post.mockRejectedValue({ response: { data: { error: { code, message: 'from upstream' } } } });
	}

	it('maps the missing key and auth codes to setting-specific notices', async () => {
		vi.useFakeTimers();

		for (const [code, fragment] of [
			['MISSING_KEY', 'google_maps_api_key'],
			['UPSTREAM_AUTH', 'rejected the configured API key'],
		] as const) {
			failWith(code);
			const wrapper = await mountInterface();
			await typeAndSettle(wrapper, 'anything');
			expect(wrapper.find('.v-notice').text()).toContain(fragment);
			expect(wrapper.find('.v-button').exists()).toBe(false);
		}
	});

	it('offers a single-shot retry that cannot fan out while the retry is in flight', async () => {
		vi.useFakeTimers();

		api.post.mockRejectedValueOnce({
			response: { data: { error: { code: 'UPSTREAM_RATE_LIMITED', message: 'slow down' } } },
		});

		const wrapper = await mountInterface();
		await typeAndSettle(wrapper, 'anything');

		const retryButton = wrapper.find('.v-button');
		expect(retryButton.text()).toBe('Retry');

		// Hold the retry request pending and fire both clicks before any re-render,
		// so the second click meets a consumed retry action rather than a re-installed one.
		const pending = deferred<{ data: { suggestions: unknown[] } }>();
		api.post.mockReturnValue(pending.promise);

		retryButton.trigger('click');
		retryButton.trigger('click');
		await flushPromises();

		expect(api.post).toHaveBeenCalledTimes(2);

		pending.resolve({ data: { suggestions: [] } });
		await flushPromises();
	});

	it('ignores input while disabled', async () => {
		const wrapper = await mountInterface({ disabled: true });
		typeText(wrapper, 'nope');
		expect(wrapper.emitted('input')).toBeUndefined();
	});

	it('guards a foreign value and clears it explicitly', async () => {
		const wrapper = await mountInterface({ value: { type: 'Feature', properties: {} } });
		expect(wrapper.find('.v-notice').text()).toContain('does not match the address format');

		await wrapper.find('.v-button').trigger('click');
		expect(lastEmitted(wrapper)).toBeNull();
	});
});

describe('clearing and isolation', () => {
	it('the clear icon empties the value', async () => {
		const wrapper = await mountInterface({ value: { version: 1, formattedAddress: 'Warehouse dock 3' } });
		await wrapper.find('.v-icon[data-name="close"]').trigger('click');
		expect(lastEmitted(wrapper)).toBeNull();
		expect(wrapper.find('.v-input').attributes('data-model-value')).toBe('');
	});

	it('keeps transient state isolated between instances', async () => {
		vi.useFakeTimers();
		const first = await mountInterface();
		const second = await mountInterface();

		await typeAndSettle(first, 'Downing');

		expect(first.findAll('.v-list-item')).toHaveLength(1);
		expect(second.findAll('.v-list-item')).toHaveLength(0);
		expect(second.emitted('input')).toBeUndefined();
	});
});

describe('the map layer', () => {
	it('states which setting is missing', async () => {
		const noKey = await mountInterface({ showMap: true });
		expect(noKey.find('.v-notice').text()).toContain('browser key');

		appSettings = { google_maps_browser_key: 'browser-key' };
		const noMapId = await mountInterface({ showMap: true });
		expect(noMapId.find('.v-notice').text()).toContain('Map ID');
	});

	it('reports a settings fetch failure as a map-only problem', async () => {
		settingsFailure = true;
		const wrapper = await mountInterface({ showMap: true });
		expect(wrapper.find('.v-notice').text()).toContain('settings could not be loaded');

		typeText(wrapper, 'still works');
		expect(lastEmitted(wrapper)).toEqual({ version: 1, formattedAddress: 'still works' });
	});

	it('builds the map with the enumerated controls and tracks the selection marker', async () => {
		appSettings = { google_maps_browser_key: 'browser-key', google_maps_map_id: 'map-id' };
		const wrapper = await mountInterface({ showMap: true, value: SELECTED });
		await flushPromises();

		expect(loadGoogleMaps).toHaveBeenCalledWith('browser-key');
		expect(MapMock.instances).toHaveLength(1);

		expect(MapMock.instances[0]!.options).toEqual({
			mapId: 'map-id',
			center: { lat: 0, lng: 0 },
			zoom: 1,
			disableDefaultUI: true,
			zoomControl: true,
			mapTypeControl: true,
			fullscreenControl: true,
		});

		expect(MarkerMock.instances[0]!.position).toEqual({
			lat: SELECTED.location.latitude,
			lng: SELECTED.location.longitude,
		});

		wrapper.unmount();
		expect(MarkerMock.instances[0]!.map).toBeNull();
	});

	it('rebuilds the map after the toggle turns off and on', async () => {
		appSettings = { google_maps_browser_key: 'browser-key', google_maps_map_id: 'map-id' };
		const wrapper = await mountInterface({ showMap: true });
		await flushPromises();
		expect(MapMock.instances).toHaveLength(1);

		await wrapper.setProps({ showMap: false });
		expect(MarkerMock.instances[0]!.map).toBeNull();

		await wrapper.setProps({ showMap: true });
		await flushPromises();
		expect(MapMock.instances).toHaveLength(2);
	});

	it('offers retry after a loader failure and loads on the second attempt', async () => {
		appSettings = { google_maps_browser_key: 'browser-key', google_maps_map_id: 'map-id' };
		loadGoogleMaps.mockRejectedValueOnce(new Error('blocked'));

		const wrapper = await mountInterface({ showMap: true });
		await flushPromises();

		expect(wrapper.find('.v-notice').text()).toContain('script failed to load');

		await wrapper.find('.v-button').trigger('click');
		await flushPromises();

		expect(loadGoogleMaps).toHaveBeenCalledTimes(2);
		expect(MapMock.instances).toHaveLength(1);
	});
});
