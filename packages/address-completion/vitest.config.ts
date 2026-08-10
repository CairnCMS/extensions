import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [vue()],
	test: {
		css: true,
		environmentOptions: {
			happyDOM: {
				settings: {
					disableJavaScriptFileLoading: true,
					disableJavaScriptEvaluation: true,
					disableCSSFileLoading: true,
				},
			},
		},
	},
});
