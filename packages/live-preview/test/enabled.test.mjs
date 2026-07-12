import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ref } from 'vue';
import { enabled } from '../src/enabled.js';

function settle() {
	return new Promise((resolve) => setImmediate(resolve));
}

function contextWith(template, { isNew = false, reject = false } = {}) {
	return {
		isNew: ref(isNew),
		settings: {
			get: () => (reject ? Promise.reject(new Error('settings unavailable')) : Promise.resolve(template)),
		},
	};
}

test('enabled once the collection has a valid template', async () => {
	const result = enabled(contextWith('https://site.example.com/articles/{{slug}}'));

	await settle();
	assert.equal(result.value, true);
});

test('a new item stays hidden even with a valid template', async () => {
	const result = enabled(contextWith('https://site.example.com/articles/{{slug}}', { isNew: true }));

	await settle();
	assert.equal(result.value, false);
});

test('the first save reveals the toggle through the returned ref without re-evaluation', async () => {
	const context = contextWith('https://site.example.com/articles/{{slug}}', { isNew: true });
	const result = enabled(context);

	await settle();
	assert.equal(result.value, false);

	context.isNew.value = false;
	assert.equal(result.value, true);
});

test('disabled without a configured template', async () => {
	for (const template of [null, undefined, '']) {
		const result = enabled(contextWith(template));

		await settle();
		assert.equal(result.value, false);
	}
});

test('disabled for a template that fails the origin rules', async () => {
	for (const template of ['javascript:alert(1)', 'https://{{host}}/p', 'not a url']) {
		const result = enabled(contextWith(template));

		await settle();
		assert.equal(result.value, false);
	}
});

test('a settings fetch rejection disables without an unhandled rejection', async () => {
	const unhandled = [];
	const onUnhandled = (reason) => unhandled.push(reason);
	process.on('unhandledRejection', onUnhandled);

	try {
		const result = enabled(contextWith('https://site.example.com/p', { reject: true }));

		await settle();
		await settle();
		assert.equal(result.value, false);
		assert.equal(unhandled.length, 0);
	} finally {
		process.off('unhandledRejection', onUnhandled);
	}
});
