<script setup lang="ts">
import { useApi, useStores } from '@cairncms/extensions-sdk';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import AttributionMark from '../shared/attribution-mark.vue';
import { classifyValue, mapPlaceDetails, type SelectedAddress } from '../shared/value.js';
import { resolveLanguage } from './language.js';
import { loadGoogleMaps } from './maps-loader.js';

const SUBJECT = '@cairncms/extension-address-completion';
const ENDPOINT_BASE = '/address-completion-api';
const DEBOUNCE_MS = 300;

type Suggestion = { placeId: string; text: string };
type Notice = { type: 'warning' | 'danger'; message: string; retryable: boolean };

const props = withDefaults(
	defineProps<{
		value?: Record<string, unknown> | null;
		disabled?: boolean;
		primaryKey?: string | number | null;
		countries?: string[] | null;
		scope?: string | null;
		biasLatitude?: number | null;
		biasLongitude?: number | null;
		biasRadiusMeters?: number | null;
		showMap?: boolean;
	}>(),
	{
		value: null,
		disabled: false,
		primaryKey: null,
		countries: null,
		scope: null,
		biasLatitude: null,
		biasLongitude: null,
		biasRadiusMeters: null,
		showMap: false,
	}
);

const emit = defineEmits<{
	input: [value: Record<string, unknown> | null];
}>();

const api = useApi();
const { useUserStore, useServerStore } = useStores();
const userStore = useUserStore();
const serverStore = useServerStore();

const searchText = ref('');
const suggestions = ref<Suggestion[]>([]);
const searching = ref(false);
const busy = ref(false);
const notice = ref<Notice | null>(null);
const sessionToken = ref(crypto.randomUUID());
const browserKey = ref<string | null>(null);
const mapId = ref<string | null>(null);
const settingsLoaded = ref(false);
const settingsLoadFailed = ref(false);
const mapContainer = ref<HTMLElement | null>(null);
const mapLoadFailed = ref(false);

let generation = 0;
let operationCounter = 0;
let currentOperation = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryAction: (() => void) | null = null;
let map: google.maps.Map | null = null;
let marker: google.maps.marker.AdvancedMarkerElement | null = null;

const variant = computed(() => classifyValue(props.value));
const selectedValue = computed(() => (variant.value === 'selected' ? (props.value as SelectedAddress) : null));

const languageCode = computed(() =>
	resolveLanguage(userStore.currentUser?.language, serverStore.info?.project?.default_language)
);

const coordinatesText = computed(() => {
	const location = selectedValue.value?.location;
	if (!location) return '';
	return `${location.latitude}, ${location.longitude}`;
});

const observedAtText = computed(() => {
	const observedAt = selectedValue.value?.location.observedAt;
	if (!observedAt) return '';
	return new Date(observedAt).toLocaleString();
});

const mapsHref = computed(() => {
	const selected = selectedValue.value;
	if (!selected) return null;
	const query = encodeURIComponent(`${selected.location.latitude},${selected.location.longitude}`);
	const placeId = encodeURIComponent(selected.placeId);
	return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${placeId}`;
});

const mapReason = computed(() => {
	if (!props.showMap) return null;
	if (!settingsLoaded.value) return null;
	if (settingsLoadFailed.value) return 'The extension settings could not be loaded, so the map is unavailable.';
	if (!browserKey.value) return 'The map needs the browser key setting under Settings > Extensions.';
	if (!mapId.value) return 'The map needs the Map ID setting under Settings > Extensions.';
	if (mapLoadFailed.value) return 'The Google Maps script failed to load.';
	return null;
});

const mapActive = computed(
	() => props.showMap && settingsLoaded.value && !!browserKey.value && !!mapId.value && !mapLoadFailed.value
);

const configError = computed(() => {
	if (props.countries && props.countries.length > 15) {
		return 'This field restricts more than 15 countries, and Google allows at most 15. Remove countries in the field settings.';
	}

	const biasFields = [props.biasLatitude, props.biasLongitude, props.biasRadiusMeters];
	const biasSet = biasFields.filter((entry) => typeof entry === 'number');

	if (biasSet.length === 0) return null;

	if (biasSet.length < 3) {
		return 'The location bias needs latitude, longitude, and radius together. Complete or clear the bias in the field settings.';
	}

	const [latitude, longitude, radius] = biasFields as [number, number, number];

	if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
		return 'The bias latitude must be between -90 and 90. Fix it in the field settings.';
	}

	if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
		return 'The bias longitude must be between -180 and 180. Fix it in the field settings.';
	}

	if (!Number.isInteger(radius) || radius < 100 || radius > 50000) {
		return 'The bias radius must be an integer between 100 and 50000 meters. Fix it in the field settings.';
	}

	return null;
});

function syncTextFromValue() {
	if (variant.value === 'selected' || variant.value === 'manual') {
		searchText.value = (props.value as Record<string, unknown>)['formattedAddress'] as string;
	} else if (variant.value === 'empty') {
		searchText.value = '';
	}
}

let lastEmitted = '__never__';

function emitValue(value: Record<string, unknown> | null) {
	lastEmitted = JSON.stringify(value);
	emit('input', value);
}

function invalidatePending() {
	generation += 1;
	searching.value = false;

	if (debounceTimer !== null) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
}

function startOperation(): number {
	operationCounter += 1;
	currentOperation = operationCounter;
	busy.value = true;
	return currentOperation;
}

function endOperation(operation: number) {
	if (operation === currentOperation) {
		busy.value = false;
		currentOperation = 0;
	}
}

function invalidateOperation() {
	currentOperation = 0;
	busy.value = false;
}

function resetTransientState() {
	invalidatePending();
	invalidateOperation();
	suggestions.value = [];
	notice.value = null;
	retryAction = null;
}

watch(
	() => props.value,
	(incoming) => {
		const incomingKey = JSON.stringify(incoming ?? null);
		if (incomingKey === lastEmitted) return;
		lastEmitted = incomingKey;
		resetTransientState();
		syncTextFromValue();
	},
	{ immediate: true }
);

watch(
	() => props.primaryKey,
	(next, previous) => {
		if (next === previous) return;
		resetTransientState();
		sessionToken.value = crypto.randomUUID();
	}
);

watch(
	() => props.disabled,
	(disabled) => {
		if (disabled) resetTransientState();
	}
);

function endpointNotice(code: string, message: string): Notice {
	if (code === 'MISSING_KEY') {
		return {
			type: 'warning',
			message: 'The Google key is not configured. Set google_maps_api_key under Settings > Extensions.',
			retryable: false,
		};
	}

	if (code === 'UPSTREAM_AUTH') {
		return {
			type: 'danger',
			message:
				'Google rejected the configured API key. Check the key and its restrictions under Settings > Extensions.',
			retryable: false,
		};
	}

	if (code === 'UPSTREAM_RATE_LIMITED') {
		return { type: 'danger', message: 'Google rate-limited the request.', retryable: true };
	}

	return { type: 'danger', message: message || 'The search could not be completed.', retryable: true };
}

function noticeFromError(error: unknown, retry: () => void) {
	const response = (error as { response?: { data?: { error?: { code?: string; message?: string } } } }).response;
	const code = response?.data?.error?.code ?? 'UPSTREAM_FAILED';
	const message = response?.data?.error?.message ?? '';
	notice.value = endpointNotice(code, message);
	retryAction = notice.value.retryable ? retry : null;
}

function onInput(text: string | null) {
	if (props.disabled) return;

	const raw = typeof text === 'string' ? text : '';
	searchText.value = raw;
	const trimmed = raw.trim();
	emitValue(trimmed.length === 0 ? null : { version: 1, formattedAddress: trimmed });

	invalidatePending();
	invalidateOperation();
	suggestions.value = [];
	notice.value = null;
	retryAction = null;

	if (trimmed.length === 0 || configError.value !== null) return;

	debounceTimer = setTimeout(() => runAutocomplete(trimmed), DEBOUNCE_MS);
}

async function runAutocomplete(input: string) {
	generation += 1;
	const requestGeneration = generation;
	searching.value = true;
	notice.value = null;
	retryAction = null;

	const body: Record<string, unknown> = { input, sessionToken: sessionToken.value, languageCode: languageCode.value };

	if (props.countries && props.countries.length > 0) body['countries'] = props.countries;
	if (props.scope && props.scope !== 'all') body['scope'] = props.scope;

	if (
		typeof props.biasLatitude === 'number' &&
		typeof props.biasLongitude === 'number' &&
		typeof props.biasRadiusMeters === 'number'
	) {
		body['bias'] = {
			latitude: props.biasLatitude,
			longitude: props.biasLongitude,
			radiusMeters: props.biasRadiusMeters,
		};
	}

	try {
		const response = await api.post(`${ENDPOINT_BASE}/autocomplete`, body);
		if (requestGeneration !== generation) return;
		searching.value = false;
		suggestions.value = (response.data?.suggestions ?? []) as Suggestion[];
	} catch (error) {
		if (requestGeneration !== generation) return;
		searching.value = false;
		suggestions.value = [];
		noticeFromError(error, () => runAutocomplete(input));
	}
}

async function fetchDetails(placeId: string, token: string | null): Promise<Record<string, unknown> | null> {
	generation += 1;
	const requestGeneration = generation;

	const params: Record<string, string> = { languageCode: languageCode.value };
	if (token !== null) params['sessionToken'] = token;

	try {
		const response = await api.get(`${ENDPOINT_BASE}/place/${encodeURIComponent(placeId)}`, { params });
		if (requestGeneration !== generation) return null;
		return response.data as Record<string, unknown>;
	} catch (error) {
		if (requestGeneration !== generation) return null;
		throw error;
	}
}

async function onSelect(suggestion: Suggestion) {
	if (props.disabled || busy.value) return;

	const operation = startOperation();
	suggestions.value = [];
	notice.value = null;
	retryAction = null;

	const token = sessionToken.value;
	sessionToken.value = crypto.randomUUID();

	try {
		const data = await fetchDetails(suggestion.placeId, token);
		if (data === null) return;

		const mapped = mapPlaceDetails(data['place'], data['observedAt']);

		if (!mapped.ok) {
			notice.value = {
				type: 'danger',
				message: 'Google returned an incomplete place, so the selection was not saved. The typed text was kept.',
				retryable: false,
			};

			return;
		}

		emitValue(mapped.value);
		searchText.value = mapped.value.formattedAddress;
	} catch (error) {
		noticeFromError(error, () => onSelect(suggestion));
	} finally {
		endOperation(operation);
	}
}

async function refresh() {
	const selected = selectedValue.value;
	if (!selected || props.disabled || busy.value) return;

	const operation = startOperation();
	notice.value = null;
	retryAction = null;

	try {
		const data = await fetchDetails(selected.placeId, null);
		if (data === null) return;

		const mapped = mapPlaceDetails(data['place'], data['observedAt']);

		if (!mapped.ok) {
			notice.value = {
				type: 'danger',
				message: 'Google returned an incomplete place, so the stored record was kept unchanged.',
				retryable: false,
			};

			return;
		}

		emitValue(mapped.value);
		searchText.value = mapped.value.formattedAddress;
	} catch (error) {
		noticeFromError(error, () => refresh());
	} finally {
		endOperation(operation);
	}
}

function clearValue() {
	if (props.disabled) return;
	resetTransientState();
	searchText.value = '';
	emitValue(null);
}

function retry() {
	const action = retryAction;
	retryAction = null;
	if (action) action();
}

function retryMap() {
	mapLoadFailed.value = false;
	void initMap();
}

let mapInitializing = false;

function destroyMap() {
	if (marker) {
		marker.map = null;
		marker = null;
	}

	map = null;
}

async function initMap() {
	if (!mapContainer.value || !browserKey.value || !mapId.value || map !== null || mapInitializing) return;

	mapInitializing = true;

	try {
		await loadGoogleMaps(browserKey.value);
		const mapsLibrary = (await google.maps.importLibrary('maps')) as google.maps.MapsLibrary;
		const markerLibrary = (await google.maps.importLibrary('marker')) as google.maps.MarkerLibrary;
		if (!mapContainer.value) return;

		map = new mapsLibrary.Map(mapContainer.value, {
			mapId: mapId.value,
			center: { lat: 0, lng: 0 },
			zoom: 1,
			disableDefaultUI: true,
			zoomControl: true,
			mapTypeControl: true,
			fullscreenControl: true,
		});

		marker = new markerLibrary.AdvancedMarkerElement({ map });
		updateMarker();
	} catch {
		destroyMap();
		mapLoadFailed.value = true;
	} finally {
		mapInitializing = false;
	}
}

function updateMarker() {
	if (!map || !marker) return;
	const selected = selectedValue.value;

	if (!selected) {
		marker.position = null;
		return;
	}

	const position = { lat: selected.location.latitude, lng: selected.location.longitude };
	marker.position = position;
	map.setCenter(position);
	map.setZoom(15);
}

watch(selectedValue, updateMarker);

watch(mapActive, (active) => {
	if (active) void initMap();
	else destroyMap();
});

watch(mapContainer, (element) => {
	if (element && mapActive.value) void initMap();
	else if (!element) destroyMap();
});

onMounted(async () => {
	try {
		const response = await api.get('/extension-settings/app', { params: { subject: SUBJECT } });
		const settings = (response.data?.data ?? {}) as Record<string, unknown>;

		browserKey.value =
			typeof settings['google_maps_browser_key'] === 'string' ? settings['google_maps_browser_key'] : null;

		mapId.value = typeof settings['google_maps_map_id'] === 'string' ? settings['google_maps_map_id'] : null;
	} catch {
		settingsLoadFailed.value = true;
	} finally {
		settingsLoaded.value = true;
	}
});

onUnmounted(() => {
	invalidatePending();
	destroyMap();
});
</script>

<template>
	<div class="address-completion">
		<v-notice v-if="variant === 'foreign'" type="warning">
			<div class="foreign-notice">
				<span>The stored value does not match the address format and was left unchanged.</span>
				<v-button v-if="!disabled" x-small secondary @click="clearValue">Clear</v-button>
			</div>
		</v-notice>

		<template v-else>
			<v-menu attached :disabled="disabled">
				<template #activator="{ activate }">
					<v-input
						:model-value="searchText"
						:disabled="disabled"
						:maxlength="255"
						placeholder="Search for an address or place"
						@update:model-value="onInput"
						@focus="activate"
					>
						<template #prepend>
							<v-icon name="location_on" />
						</template>
						<template #append>
							<v-progress-circular v-if="searching || busy" indeterminate />
							<v-icon
								v-else-if="searchText && !disabled"
								v-tooltip="'Clear'"
								name="close"
								clickable
								@click.stop="clearValue"
							/>
						</template>
					</v-input>
				</template>

				<v-list v-if="suggestions.length > 0">
					<v-list-item
						v-for="suggestion of suggestions"
						:key="suggestion.placeId"
						clickable
						@click="onSelect(suggestion)"
					>
						<v-list-item-content>{{ suggestion.text }}</v-list-item-content>
					</v-list-item>

					<div class="attribution-row">
						<attribution-mark />
					</div>
				</v-list>
			</v-menu>

			<v-notice v-if="configError" type="warning">{{ configError }}</v-notice>

			<v-notice v-if="notice" :type="notice.type">
				<div class="notice-body">
					<span>{{ notice.message }}</span>
					<v-button v-if="notice.retryable" x-small secondary @click="retry">Retry</v-button>
				</div>
			</v-notice>

			<div v-if="variant === 'selected'" class="summary">
				<span class="coordinates">{{ coordinatesText }}</span>
				<span class="observed">{{ observedAtText }}</span>
				<attribution-mark />
				<span class="actions">
					<v-icon
						v-if="!disabled"
						v-tooltip="'Refresh from Google'"
						name="autorenew"
						small
						clickable
						@click="refresh"
					/>
					<a
						v-if="mapsHref"
						v-tooltip="'Open in Google Maps'"
						:href="mapsHref"
						target="_blank"
						rel="noopener noreferrer"
					>
						<v-icon name="open_in_new" small />
					</a>
				</span>
			</div>

			<div v-if="showMap" class="map-area">
				<v-notice v-if="mapReason" type="info">
					<div class="notice-body">
						<span>{{ mapReason }}</span>
						<v-button v-if="mapLoadFailed && !disabled" x-small secondary @click="retryMap">Retry</v-button>
					</div>
				</v-notice>
				<div v-else-if="mapActive" ref="mapContainer" class="map-container" />
			</div>
		</template>
	</div>
</template>

<style lang="scss" scoped>
.address-completion {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.foreign-notice,
.notice-body {
	display: flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;
	gap: 0.5rem;
}

.attribution-row {
	display: flex;
	justify-content: flex-end;
	padding: 0.25rem 1rem 0.5rem;
}

.summary {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	color: var(--foreground-subdued);
	font-size: 0.875rem;

	.actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;

		a {
			display: flex;
			color: var(--foreground-subdued);

			&:hover {
				color: var(--foreground-normal);
			}
		}
	}
}

.map-container {
	width: 100%;
	height: 25rem;
	border: var(--border-width) solid var(--border-normal);
	border-radius: var(--border-radius);
}
</style>
