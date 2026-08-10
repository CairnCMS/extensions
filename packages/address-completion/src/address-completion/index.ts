import { defineInterface } from '@cairncms/extensions-sdk';
import { ISO_COUNTRY_CODES } from '../shared/countries.js';
import InterfaceComponent from './interface.vue';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

const countryChoices = [...ISO_COUNTRY_CODES]
	.map((code) => ({ text: regionNames.of(code) ?? code, value: code }))
	.sort((a, b) => a.text.localeCompare(b.text));

export default defineInterface({
	id: 'address-completion',
	name: 'Address Completion',
	description: 'Search Google Places and save one compact address record',
	icon: 'location_on',
	component: InterfaceComponent,
	types: ['json'],
	options: [
		{
			field: 'countries',
			name: 'Countries',
			type: 'json',
			meta: {
				width: 'full',
				interface: 'select-multiple-dropdown',
				note: 'Limit suggestions to these countries, up to 15',
				options: {
					choices: countryChoices,
				},
			},
		},
		{
			field: 'scope',
			name: 'Search scope',
			type: 'string',
			meta: {
				width: 'half',
				interface: 'select-dropdown',
				note: 'What kinds of places can be suggested',
				options: {
					choices: [
						{ text: 'All places', value: 'all' },
						{ text: 'Addresses', value: 'addresses' },
						{ text: 'Cities', value: 'cities' },
						{ text: 'Regions', value: 'regions' },
					],
				},
			},
			schema: {
				default_value: 'all',
			},
		},
		{
			field: 'showMap',
			name: 'Show map',
			type: 'boolean',
			meta: {
				width: 'half',
				interface: 'boolean',
				note: 'Requires the browser key and Map ID extension settings',
			},
			schema: {
				default_value: false,
			},
		},
		{
			field: 'biasLatitude',
			name: 'Bias latitude',
			type: 'float',
			meta: {
				width: 'half',
				interface: 'input',
				note: 'Ranks nearby results higher when all three bias fields are set',
				options: {
					min: -90,
					max: 90,
				},
			},
		},
		{
			field: 'biasLongitude',
			name: 'Bias longitude',
			type: 'float',
			meta: {
				width: 'half',
				interface: 'input',
				options: {
					min: -180,
					max: 180,
				},
			},
		},
		{
			field: 'biasRadiusMeters',
			name: 'Bias radius in meters',
			type: 'integer',
			meta: {
				width: 'half',
				interface: 'input',
				note: '100 to 50000',
				options: {
					min: 100,
					max: 50000,
					step: 1,
				},
			},
		},
	],
});
