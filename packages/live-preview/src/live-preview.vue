<template>
	<div ref="livePreviewEl" class="live-preview" :class="{ fullscreen }">
		<div class="header">
			<v-button
				v-tooltip.bottom.end="'Open in new tab'"
				x-small
				rounded
				icon
				secondary
				:disabled="!url"
				@click="openWindow"
			>
				<v-icon small name="open_in_new" outline />
			</v-button>
			<v-button
				v-tooltip.bottom.end="'Refresh'"
				x-small
				icon
				rounded
				secondary
				:disabled="isRefreshing"
				@click="refresh"
			>
				<v-progress-circular v-if="isRefreshing" indeterminate x-small />
				<v-icon v-else small name="refresh" />
			</v-button>
			<span class="url">
				<v-text-overflow :text="url ?? ''" placement="bottom" />
			</span>
			<div class="spacer" />
			<div class="dimensions" :class="{ disabled: fullscreen }">
				<input
					:value="displayWidth"
					class="width"
					:disabled="fullscreen"
					@input="width = Number($event.target.value)"
				/>
				<v-icon x-small name="close" />
				<input
					:value="displayHeight"
					class="height"
					:disabled="fullscreen"
					@input="height = Number($event.target.value)"
				/>
				<v-select
					v-model="zoom"
					inline
					:items="[
						{ text: '25%', value: 0.25 },
						{ text: '50%', value: 0.5 },
						{ text: '75%', value: 0.75 },
						{ text: '100%', value: 1 },
						{ text: '150%', value: 1.5 },
						{ text: '200%', value: 2 },
					]"
					:disabled="fullscreen"
				/>
			</div>
			<v-button
				v-tooltip.bottom.start="'Change size'"
				x-small
				icon
				rounded
				:secondary="fullscreen"
				@click="toggleFullscreen"
			>
				<v-icon small name="devices" />
			</v-button>
		</div>
		<div class="container">
			<div v-if="!url" class="empty-state">
				<v-icon x-large name="visibility_off" />
				<p>
					{{ failed ? 'Preview settings failed to load. Refresh to retry.' : 'No preview is available for this item.' }}
				</p>
			</div>
			<div v-else class="iframe-view" :style="iframeViewStyle">
				<div
					ref="resizeHandle"
					class="resize-handle"
					:style="{
						width: width ? `${width}px` : '100%',
						height: height ? `${height}px` : '100%',
						resize: fullscreen ? 'none' : 'both',
						transform: `scale(${zoom})`,
						transformOrigin: zoom >= 1 ? 'top left' : 'center center',
					}"
				>
					<iframe
						id="frame"
						ref="frameEl"
						:src="url"
						sandbox="allow-scripts allow-same-origin allow-forms"
						referrerpolicy="no-referrer"
						@load="onIframeLoad"
					/>
				</div>
			</div>
		</div>
	</div>
</template>

<script>
import { useApi, useItemViewContext } from '@cairncms/extensions-sdk';
import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createLoader } from './loader.js';
import { fieldsInTemplate, renderPreviewUrl } from './url.js';

export default defineComponent({
	setup() {
		const api = useApi();
		const context = useItemViewContext();

		const template = ref(null);
		const values = ref({});
		const failed = ref(false);

		const url = computed(() => (template.value ? renderPreviewUrl(template.value, values.value) : null));

		const load = createLoader({
			loadTemplate: () => context.settings.get('preview_url'),
			loadValues: fetchValues,
			onResult(result) {
				template.value = result.template;
				values.value = result.values;
				failed.value = false;
			},
			onError() {
				template.value = null;
				values.value = {};
				failed.value = true;
			},
		});

		async function fetchValues(currentTemplate, { collection, primaryKey, isNew }) {
			const fields = fieldsInTemplate(currentTemplate);

			if (fields.length === 0 || isNew) return {};

			const endpoint = collection.startsWith('directus_') ? `/${collection.substring(9)}` : `/items/${collection}`;

			try {
				const response =
					primaryKey === null
						? await api.get(endpoint, { params: { fields: fields.join(',') } })
						: await api.get(`${endpoint}/${encodeURIComponent(primaryKey)}`, {
								params: { fields: fields.join(',') },
						  });

				return response.data.data ?? {};
			} catch {
				return {};
			}
		}

		function loadContext() {
			return {
				collection: context.collection.value,
				primaryKey: context.primaryKey.value,
				isNew: context.isNew.value,
			};
		}

		watch([context.collection, context.primaryKey], () => load(loadContext()), { immediate: true });

		context.onSaved(async () => {
			const applied = await load(loadContext());
			if (applied) reloadFrame();
		});

		const frameEl = ref(null);
		const isRefreshing = ref(false);

		// A frame blocked by the CSP frame-src directive fires no load event, so the
		// spinner clears on a fallback timer.
		let spinnerFallback = null;

		function reloadFrame() {
			if (!frameEl.value || !url.value) return;
			isRefreshing.value = true;
			clearTimeout(spinnerFallback);
			spinnerFallback = setTimeout(() => (isRefreshing.value = false), 10000);
			frameEl.value.src = url.value;
		}

		function refresh() {
			load(loadContext()).then((applied) => {
				if (applied) reloadFrame();
			});
		}

		function onIframeLoad() {
			clearTimeout(spinnerFallback);
			isRefreshing.value = false;
		}

		function openWindow() {
			if (url.value) window.open(url.value, '_blank', 'noopener,noreferrer');
		}

		const width = ref(undefined);
		const height = ref(undefined);
		const zoom = ref(1);
		const displayWidth = ref(undefined);
		const displayHeight = ref(undefined);

		const resizeHandle = ref(null);
		const livePreviewEl = ref(null);
		const paneWidth = ref(0);
		const paneHeight = ref(0);

		const observers = [];

		onMounted(() => {
			if (livePreviewEl.value) {
				const paneObserver = new ResizeObserver(() => {
					if (!livePreviewEl.value) return;
					paneWidth.value = livePreviewEl.value.offsetWidth;
					paneHeight.value = livePreviewEl.value.offsetHeight;
				});

				paneObserver.observe(livePreviewEl.value);
				observers.push(paneObserver);
			}

			if (resizeHandle.value) {
				const handleObserver = new ResizeObserver(() => {
					if (!resizeHandle.value) return;

					displayWidth.value = resizeHandle.value.offsetWidth;
					displayHeight.value = resizeHandle.value.offsetHeight;

					if (width.value === undefined && height.value === undefined) return;

					width.value = resizeHandle.value.offsetWidth;
					height.value = resizeHandle.value.offsetHeight;
				});

				handleObserver.observe(resizeHandle.value);
				observers.push(handleObserver);
			}
		});

		onBeforeUnmount(() => {
			clearTimeout(spinnerFallback);
			for (const observer of observers) observer.disconnect();
		});

		const fullscreen = computed(() => width.value === undefined && height.value === undefined);

		function toggleFullscreen() {
			if (fullscreen.value) {
				width.value = 400;
				height.value = 600;
			} else {
				width.value = undefined;
				height.value = undefined;
				zoom.value = 1;
			}
		}

		const iframeViewStyle = computed(() => {
			const style = {};

			if (zoom.value <= 1) {
				style.placeItems = 'center';
			}

			if (zoom.value > 1 && width.value && height.value) {
				const paddingWidth = (paneWidth.value - width.value * zoom.value) / 2;
				const paddingLeft = Math.max(paddingWidth, 48);
				style.paddingLeft = `${paddingLeft}px`;

				if (paddingWidth < 48) {
					style.width = `${48 + width.value * zoom.value + 48}px`;
				}

				const paddingHeight = (paneHeight.value - 44 - height.value * zoom.value) / 2;
				style.paddingTop = `${Math.max(paddingHeight, 48)}px`;

				if (paddingHeight < 48) {
					style.height = `${48 + height.value * zoom.value + 48}px`;
				}
			}

			return style;
		});

		return {
			url,
			failed,
			isRefreshing,
			refresh,
			openWindow,
			onIframeLoad,
			frameEl,
			resizeHandle,
			livePreviewEl,
			width,
			height,
			zoom,
			displayWidth,
			displayHeight,
			fullscreen,
			toggleFullscreen,
			iframeViewStyle,
		};
	},
});
</script>

<style scoped>
.live-preview {
	width: 100%;
	height: 100%;
}

.header {
	width: 100%;
	height: 2.75rem;
	display: flex;
	align-items: center;
	z-index: 10;
	gap: 0.5rem;
	padding: 0 0.5rem;
	color: var(--foreground-inverted);
	background-color: var(--background-inverted);
}

.header .url {
	color: var(--foreground-subdued);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.header .spacer {
	flex: 1;
}

.header .dimensions {
	display: flex;
	align-items: center;
}

.header .dimensions.disabled {
	color: var(--foreground-subdued);
}

.header input {
	border: none;
	width: 3.125rem;
	color: var(--foreground-inverted);
	background-color: var(--background-inverted);
}

.header input:first-child {
	text-align: right;
}

.container {
	width: 100%;
	height: calc(100% - 2.75rem);
	overflow: auto;
	background-color: var(--background-subdued);
}

.iframe-view {
	width: 100%;
	height: 100%;
	overflow: auto;
	display: grid;
	padding: 3rem;
}

.empty-state {
	height: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.75rem;
	padding: 2rem;
	color: var(--foreground-subdued);
	text-align: center;
}

.iframe-view #frame {
	width: 100%;
	height: 100%;
	border: 0;
	background-color: #ffffff;
}

.resize-handle {
	overflow: hidden;
	box-shadow: 0 0.25rem 0.75rem -0.25rem rgb(0 0 0 / 0.2);
}

.fullscreen .iframe-view {
	padding: 0;
}
</style>
