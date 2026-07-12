import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fieldsInTemplate, isValidTemplate, renderPreviewUrl, templateOrigin } from '../src/url.js';

test('renders a simple template with interpolated values', () => {
	const url = renderPreviewUrl('https://site.example.com/articles/{{slug}}', { slug: 'hello-world' });
	assert.equal(url, 'https://site.example.com/articles/hello-world');
});

test('rejects non-http schemes', () => {
	assert.equal(templateOrigin('javascript:alert(1)'), null);
	assert.equal(templateOrigin('data:text/html,x'), null);
	assert.equal(templateOrigin('ftp://x.com/{{slug}}'), null);
	assert.equal(renderPreviewUrl('javascript:alert(1)', {}), null);
});

test('rejects a template whose scheme or host interpolates', () => {
	assert.equal(templateOrigin('{{scheme}}://x.com/p'), null);
	assert.equal(templateOrigin('https://{{host}}/p'), null);
	assert.equal(templateOrigin('https://{{sub}}.example.com/p'), null);
	assert.equal(renderPreviewUrl('https://{{host}}/p', { host: 'evil.com' }), null);
});

test('rejects userinfo in the template', () => {
	assert.equal(templateOrigin('https://user:pass@x.com/p'), null);
	assert.equal(renderPreviewUrl('https://user@x.com/{{slug}}', { slug: 'a' }), null);
});

test('a value cannot move the frame off the literal origin', () => {
	const cases = [
		{ slug: '@evil.com' },
		{ slug: '//evil.com/x' },
		{ slug: '..%2F..%2F' },
		{ slug: 'https://evil.com/x' },
		{ slug: '?host=evil.com#x' },
	];

	for (const values of cases) {
		const url = renderPreviewUrl('https://site.example.com/articles/{{slug}}', values);
		assert.ok(url !== null, `rendered for ${values.slug}`);
		assert.ok(new URL(url).origin === 'https://site.example.com', `origin held for ${values.slug}`);
	}
});

test('encodes values per URL component', () => {
	const url = renderPreviewUrl('https://x.com/p/{{v}}', { v: 'a b?c&d#e/f' });
	assert.equal(url, 'https://x.com/p/a%20b%3Fc%26d%23e%2Ff');
});

test('merges a static query with interpolated parameters', () => {
	const url = renderPreviewUrl('https://x.com/p?preview=true&slug={{slug}}', { slug: 'a&b=c' });

	const parsed = new URL(url);
	assert.equal(parsed.searchParams.get('preview'), 'true');
	assert.equal(parsed.searchParams.get('slug'), 'a&b=c');
});

test('interpolates in both path and query', () => {
	const url = renderPreviewUrl('https://x.com/{{type}}/preview?id={{id}}', { type: 'articles', id: 7 });
	assert.equal(url, 'https://x.com/articles/preview?id=7');
});

test('renders missing and null values as empty', () => {
	assert.equal(renderPreviewUrl('https://x.com/p/{{gone}}', {}), 'https://x.com/p/');
	assert.equal(renderPreviewUrl('https://x.com/p/{{gone}}', { gone: null }), 'https://x.com/p/');
});

test('serializes an object value as encoded JSON', () => {
	const url = renderPreviewUrl('https://x.com/p?f={{filter}}', { filter: { a: 1 } });
	assert.equal(new URL(url).searchParams.get('f'), '{"a":1}');
});

test('resolves dot paths into nested values', () => {
	const url = renderPreviewUrl('https://x.com/by/{{author.slug}}', { author: { slug: 'jane' } });
	assert.equal(url, 'https://x.com/by/jane');
});

test('never resolves inherited properties', () => {
	assert.equal(renderPreviewUrl('https://x.com/p/{{constructor.name}}', { a: 1 }), 'https://x.com/p/');
	assert.equal(renderPreviewUrl('https://x.com/p/{{__proto__.x}}', { a: 1 }), 'https://x.com/p/');
	assert.equal(renderPreviewUrl('https://x.com/p/{{toString}}', { a: 1 }), 'https://x.com/p/');
});

test('a polluted prototype key never resolves', () => {
	Object.prototype.polluted = 'leak';

	try {
		assert.equal(renderPreviewUrl('https://x.com/p/{{polluted}}', {}), 'https://x.com/p/');
		assert.equal(renderPreviewUrl('https://x.com/p/{{author.polluted}}', { author: {} }), 'https://x.com/p/');
	} finally {
		delete Object.prototype.polluted;
	}
});

test('preserves an explicit port in the origin', () => {
	assert.equal(templateOrigin('http://localhost:3000/{{slug}}'), 'http://localhost:3000');
	assert.equal(renderPreviewUrl('http://localhost:3000/{{slug}}', { slug: 'a' }), 'http://localhost:3000/a');
});

test('accepts only a configured template with a literal origin', () => {
	assert.equal(isValidTemplate('https://site.example.com/articles/{{slug}}'), true);

	assert.equal(isValidTemplate(null), false);
	assert.equal(isValidTemplate(undefined), false);
	assert.equal(isValidTemplate(''), false);
	assert.equal(isValidTemplate('javascript:alert(1)'), false);
	assert.equal(isValidTemplate('https://{{host}}/p'), false);
	assert.equal(isValidTemplate('not a url'), false);
});

test('extracts deduplicated, trimmed fields from a template', () => {
	assert.deepEqual(fieldsInTemplate('https://x.com/{{ slug }}/{{slug}}?a={{ author.slug }}'), [
		'slug',
		'author.slug',
	]);

	assert.deepEqual(fieldsInTemplate('https://x.com/static'), []);
	assert.deepEqual(fieldsInTemplate(null), []);
});
