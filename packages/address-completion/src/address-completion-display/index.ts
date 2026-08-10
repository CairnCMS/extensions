import { defineDisplay } from '@cairncms/extensions-sdk';
import DisplayComponent from './display.vue';
import { displayText } from './format.js';

export default defineDisplay({
	id: 'address-completion',
	name: 'Address Completion',
	description: 'Display the formatted address from the saved record',
	icon: 'location_on',
	component: DisplayComponent,
	handler: (value: unknown, options: Record<string, unknown> | null) => displayText(value, options?.['template']),
	options: [
		{
			field: 'template',
			name: 'Display Template',
			type: 'string',
			meta: {
				width: 'full',
				interface: 'input',
				note: 'Paths like {{ components.locality }} resolve inside the saved record',
				options: {
					placeholder: '{{ formattedAddress }}',
				},
			},
		},
	],
	types: ['json'],
});
