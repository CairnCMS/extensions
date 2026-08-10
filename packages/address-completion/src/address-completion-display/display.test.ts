// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Display from './display.vue';

const SELECTED = {
	version: 1,
	formattedAddress: '12345 College Blvd, Overland Park, KS 66210, USA',
	placeId: 'ChIJok',
	location: { latitude: 38.9249484, longitude: -94.7269431, observedAt: '2026-08-09T14:22:24.388Z' },
};

const MANUAL = { version: 1, formattedAddress: 'Warehouse dock 3' };

describe('address-completion display', () => {
	it('renders both record variants as bare text without any mark', () => {
		const selected = mount(Display, { props: { value: SELECTED } });
		expect(selected.text()).toBe(SELECTED.formattedAddress);
		expect(selected.find('img').exists()).toBe(false);

		const manual = mount(Display, { props: { value: MANUAL } });
		expect(manual.text()).toBe(MANUAL.formattedAddress);
	});

	it('renders nothing for empty and foreign values', () => {
		expect(
			mount(Display, { props: { value: null } })
				.find('.address-display')
				.exists()
		).toBe(false);

		expect(
			mount(Display, { props: { value: { type: 'Feature' } } })
				.find('.address-display')
				.exists()
		).toBe(false);
	});

	it('renders a template through the same fallback contract', () => {
		const templated = mount(Display, { props: { value: SELECTED, template: '{{ location.latitude }}' } });
		expect(templated.text()).toBe('38.9249484');

		const malformed = mount(Display, { props: { value: SELECTED, template: '{{ location..latitude }}' } });
		expect(malformed.text()).toBe(SELECTED.formattedAddress);
	});
});
