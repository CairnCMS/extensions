import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLoader } from '../src/loader.js';

function deferred() {
	let resolve, reject;

	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

test('a slow earlier load never overwrites a later one', async () => {
	const results = [];
	const valueGates = new Map();

	const load = createLoader({
		loadTemplate: async (context) => `https://x.com/{{slug}}#${context.item}`,
		loadValues: (template, context) => {
			const gate = deferred();
			valueGates.set(context.item, gate);
			return gate.promise;
		},
		onResult: (result) => results.push(result),
	});

	const first = load({ item: 'a' });
	await new Promise((resolve) => setImmediate(resolve));

	const second = load({ item: 'b' });
	await new Promise((resolve) => setImmediate(resolve));

	valueGates.get('b').resolve({ slug: 'from-b' });
	assert.equal(await second, true);

	valueGates.get('a').resolve({ slug: 'from-a' });
	assert.equal(await first, false);

	assert.equal(results.length, 1);
	assert.deepEqual(results[0].values, { slug: 'from-b' });
});

test('a load superseded during the template fetch applies nothing', async () => {
	const results = [];
	const templateGate = deferred();
	let calls = 0;

	const load = createLoader({
		loadTemplate: () => (++calls === 1 ? templateGate.promise : Promise.resolve('https://x.com/p')),
		loadValues: async () => ({}),
		onResult: (result) => results.push(result),
	});

	const first = load({});
	const second = load({});

	assert.equal(await second, true);

	templateGate.resolve('https://stale.example.com/p');
	assert.equal(await first, false);

	assert.equal(results.length, 1);
	assert.equal(results[0].template, 'https://x.com/p');
});

test('a failed load reports through onError and applies nothing', async () => {
	const results = [];
	const errors = [];

	const load = createLoader({
		loadTemplate: async () => {
			throw new Error('settings unavailable');
		},
		loadValues: async () => ({}),
		onResult: (result) => results.push(result),
		onError: (error) => errors.push(error),
	});

	assert.equal(await load({}), false);
	assert.equal(results.length, 0);
	assert.equal(errors.length, 1);
	assert.equal(errors[0].message, 'settings unavailable');
});

test('a superseded load that fails reports no error', async () => {
	const errors = [];
	const templateGate = deferred();
	let calls = 0;

	const load = createLoader({
		loadTemplate: () => (++calls === 1 ? templateGate.promise : Promise.resolve('https://x.com/p')),
		loadValues: async () => ({}),
		onResult: () => {},
		onError: (error) => errors.push(error),
	});

	const first = load({});
	const second = load({});

	assert.equal(await second, true);

	templateGate.reject(new Error('stale failure'));
	assert.equal(await first, false);
	assert.equal(errors.length, 0);
});

test('an empty template resolves to empty values without fetching', async () => {
	const results = [];
	let fetched = false;

	const load = createLoader({
		loadTemplate: async () => null,
		loadValues: async () => {
			fetched = true;
			return { slug: 'x' };
		},
		onResult: (result) => results.push(result),
	});

	assert.equal(await load({}), true);
	assert.equal(fetched, false);
	assert.deepEqual(results[0].values, {});
});
