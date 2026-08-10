// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION_ON_DARK, ATTRIBUTION_ON_LIGHT } from './attribution.js';
import AttributionMark from './attribution-mark.vue';

const LIGHT_SHA256 = '99a08b570afce8ce830d26aeb93ba287f6ad67387e6219fe381234ad7e4016b5';
const DARK_SHA256 = '727012e157bc115222e717325d3fb70a3cd1e6ba2407cd320e489285543503ec';

function sha256OfDataUri(uri: string): string {
	const base64 = uri.replace('data:image/svg+xml;base64,', '');
	return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}

function injectedCss(): string {
	return [...document.head.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n');
}

function ruleBody(css: string, selectorPattern: RegExp): string {
	const pattern = new RegExp(`${selectorPattern.source}[^{]*\\{([^}]*)\\}`);
	const match = css.match(pattern);
	expect(match, selectorPattern.source).not.toBeNull();
	return match![1]!;
}

describe('attribution mark', () => {
	it('embeds the official Google Maps lockups, byte for byte', () => {
		expect(sha256OfDataUri(ATTRIBUTION_ON_LIGHT)).toBe(LIGHT_SHA256);
		expect(sha256OfDataUri(ATTRIBUTION_ON_DARK)).toBe(DARK_SHA256);
	});

	it('renders both lockups at native size with translation disabled', () => {
		const wrapper = mount(AttributionMark);

		const root = wrapper.find('.attribution-mark');
		expect(root.attributes('translate')).toBe('no');

		const images = wrapper.findAll('img');
		expect(images).toHaveLength(2);

		for (const image of images) {
			expect(image.attributes('alt')).toBe('Google Maps');
			expect(image.attributes('width')).toBe('98');
			expect(image.attributes('height')).toBe('18');
			expect(image.attributes('src')).toMatch(/^data:image\/svg\+xml;base64,/);
		}

		expect(wrapper.find('img.on-light').exists()).toBe(true);
		expect(wrapper.find('img.on-dark').exists()).toBe(true);
	});

	it('pins the clear-space padding and the theme switching rules in the shipped styles', () => {
		mount(AttributionMark);
		const css = injectedCss();

		const [outsideMedia, insideMedia] = css.split('@media (prefers-color-scheme: dark)');
		expect(insideMedia, 'the auto-theme media query is missing').toBeDefined();

		expect(ruleBody(outsideMedia!, /\.attribution-mark/)).toContain('padding: 0.625rem 0.625rem 0.3125rem');

		expect(ruleBody(outsideMedia!, /\.on-dark/)).toContain('display: none');
		expect(ruleBody(outsideMedia!, /body\.dark[^{]*\.on-light/)).toContain('display: none');
		expect(ruleBody(outsideMedia!, /body\.dark[^{]*\.on-dark/)).toContain('display: block');

		expect(ruleBody(insideMedia!, /body\.auto[^{]*\.on-light/)).toContain('display: none');
		expect(ruleBody(insideMedia!, /body\.auto[^{]*\.on-dark/)).toContain('display: block');
	});
});
