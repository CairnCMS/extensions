import { computed, ref } from 'vue';
import { isValidTemplate } from './url.js';

// Returned as a ref so the toggle tracks isNew across the first save, which a
// one-shot promise return would miss.
export function enabled(context) {
	const configured = ref(false);

	context.settings
		.get('preview_url')
		.then((template) => {
			configured.value = isValidTemplate(template);
		})
		.catch(() => {
			configured.value = false;
		});

	return computed(() => configured.value && !context.isNew.value);
}
