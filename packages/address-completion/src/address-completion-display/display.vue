<script setup lang="ts">
import { computed } from 'vue';
import { displayText } from './format.js';

const props = withDefaults(
	defineProps<{
		value?: Record<string, unknown> | null;
		template?: string | null;
	}>(),
	{ value: null, template: null }
);

const text = computed(() => displayText(props.value, props.template));
</script>

<template>
	<span v-if="text !== null" class="address-display">{{ text }}</span>
</template>
