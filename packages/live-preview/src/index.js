import { defineItemView } from '@cairncms/extensions-sdk';
import { enabled } from './enabled.js';
import PaneComponent from './live-preview.vue';

export default defineItemView({
	id: 'live-preview',
	name: 'Live Preview',
	icon: 'visibility',
	enabled,
	placements: {
		splitPane: {
			component: PaneComponent,
			minWidth: 310,
		},
	},
});
