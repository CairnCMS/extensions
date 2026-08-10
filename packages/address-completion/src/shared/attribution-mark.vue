<script setup lang="ts">
import { ATTRIBUTION_HEIGHT, ATTRIBUTION_ON_DARK, ATTRIBUTION_ON_LIGHT, ATTRIBUTION_WIDTH } from './attribution.js';
</script>

<template>
	<span class="attribution-mark" translate="no">
		<img
			class="on-light"
			:src="ATTRIBUTION_ON_LIGHT"
			alt="Google Maps"
			:width="ATTRIBUTION_WIDTH"
			:height="ATTRIBUTION_HEIGHT"
		/>
		<img
			class="on-dark"
			:src="ATTRIBUTION_ON_DARK"
			alt="Google Maps"
			:width="ATTRIBUTION_WIDTH"
			:height="ATTRIBUTION_HEIGHT"
		/>
	</span>
</template>

<style lang="scss" scoped>
.attribution-mark {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	padding: 0.625rem 0.625rem 0.3125rem;

	img {
		display: block;
	}

	.on-dark {
		display: none;
	}
}

:global(body.dark .attribution-mark .on-light) {
	display: none;
}

:global(body.dark .attribution-mark .on-dark) {
	display: block;
}

@media (prefers-color-scheme: dark) {
	:global(body.auto .attribution-mark .on-light) {
		display: none;
	}

	:global(body.auto .attribution-mark .on-dark) {
		display: block;
	}
}
</style>
