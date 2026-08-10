import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
	ExtensionHostApi,
	ExtensionHostError,
	ExtensionInvocationContext,
	ExtensionRequest,
	ExtensionResponse,
	ExtensionResult,
	ExtensionSecretReference,
	JsonEndpointRequest,
} from '@cairncms/extensions-server-api';
import endpoint from './index.js';

const SESSION = 'f8a3b2c1-4d5e-6f70-8192-a3b4c5d6e7f8';
const SECRET_REFERENCE: ExtensionSecretReference = { kind: 'secret-reference', ref: 'ref-1' };
const MARKER = 'RAW-GOOGLE-MARKER-9f3a';

type SendResult = ExtensionResult<ExtensionResponse>;

type HarnessConfig = {
	settingsValue?: ExtensionSecretReference | null;
	sendResult?: SendResult;
};

function deniedError(): ExtensionHostError {
	return { code: 'denied', message: 'not stubbed' };
}

function makeHarness(config: HarnessConfig = {}) {
	const settingsValue = 'settingsValue' in config ? config.settingsValue ?? null : SECRET_REFERENCE;

	const sendResult: SendResult =
		'sendResult' in config && config.sendResult !== undefined
			? config.sendResult
			: { ok: true, value: { status: 200, headers: {}, body: {} } };

	const settingsCalls: string[] = [];
	const sendCalls: ExtensionRequest[] = [];

	const host: ExtensionHostApi = {
		log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		settings: {
			async get<T>(key: string): Promise<ExtensionResult<T | ExtensionSecretReference | null>> {
				settingsCalls.push(key);
				return { ok: true, value: settingsValue };
			},
		},
		request: {
			async send<T>(request: ExtensionRequest): Promise<ExtensionResult<ExtensionResponse<T>>> {
				sendCalls.push(request);
				return sendResult as ExtensionResult<ExtensionResponse<T>>;
			},
		},
		items: {
			async read() {
				return { ok: false, error: deniedError() };
			},
			async readOne() {
				return { ok: false, error: deniedError() };
			},
		},
		template: {
			async renderLiquid() {
				return { ok: false, error: deniedError() };
			},
		},
	};

	const context: ExtensionInvocationContext = {
		extensionId: '@cairncms/extension-address-completion',
		contributionId: 'address-completion-api',
		activation: { type: 'json-endpoint' },
		accountability: null,
		host,
	};

	return { context, settingsCalls, sendCalls };
}

async function call(request: JsonEndpointRequest, config?: HarnessConfig) {
	const harness = makeHarness(config);
	const response = await endpoint.handler(request, harness.context);
	return { response, ...harness };
}

function autocompleteRequest(body: Record<string, unknown> = {}): JsonEndpointRequest {
	return {
		method: 'POST',
		path: '/autocomplete',
		query: {},
		body: { input: '10 Main St', sessionToken: SESSION, ...body },
	};
}

function detailsRequest(placeId: string, query: Record<string, string> = {}): JsonEndpointRequest {
	return { method: 'GET', path: `/place/${placeId}`, query, body: null };
}

afterEach(() => {
	vi.useRealTimers();
});

describe('address-completion-api handler', () => {
	it('answers 404 for unknown routes and methods with no host calls', async () => {
		const requests: JsonEndpointRequest[] = [
			{ method: 'GET', path: '/autocomplete', query: {}, body: null },
			{ method: 'DELETE', path: '/autocomplete', query: {}, body: null },
			{ method: 'POST', path: '/place/abc', query: {}, body: null },
			{ method: 'GET', path: '/nope', query: {}, body: null },
		];

		for (const request of requests) {
			const { response, settingsCalls, sendCalls } = await call(request);
			expect(response.status).toBe(404);
			expect(response.body).toEqual({ error: { code: 'ROUTE_NOT_FOUND', message: 'unknown route' } });
			expect(settingsCalls).toHaveLength(0);
			expect(sendCalls).toHaveLength(0);
		}
	});

	it('answers 400 on invalid input with no host calls', async () => {
		const { response, settingsCalls, sendCalls } = await call({
			method: 'POST',
			path: '/autocomplete',
			query: {},
			body: { input: '' },
		});

		expect(response.status).toBe(400);

		expect(response.body).toEqual({
			error: { code: 'INVALID_INPUT', message: 'input must be 1 to 255 characters after trimming' },
		});

		expect(settingsCalls).toHaveLength(0);
		expect(sendCalls).toHaveLength(0);
	});

	it('answers 503 MISSING_KEY on valid input with no configured key and no outbound call', async () => {
		const { response, sendCalls } = await call(autocompleteRequest(), { settingsValue: null });
		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: { code: 'MISSING_KEY', message: 'google_maps_api_key is not configured' } });
		expect(sendCalls).toHaveLength(0);
	});

	it('makes exactly one outbound autocomplete call with the pinned url, masks, and auth shape', async () => {
		const { sendCalls } = await call(autocompleteRequest({ countries: ['GB'] }), {
			sendResult: { ok: true, value: { status: 200, headers: {}, body: { suggestions: [] } } },
		});

		expect(sendCalls).toHaveLength(1);
		const sent = sendCalls[0]!;

		expect(sent.url).toBe('https://places.googleapis.com/v1/places:autocomplete');
		expect(sent.method).toBe('POST');
		expect(sent.auth).toEqual({ header: 'X-Goog-Api-Key', secret: SECRET_REFERENCE });

		expect(sent.headers).toEqual({
			'Content-Type': 'application/json',
			'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
		});

		expect(JSON.parse(sent.body as string)).toEqual({
			input: '10 Main St',
			sessionToken: SESSION,
			includedRegionCodes: ['gb'],
		});
	});

	it('makes exactly one outbound details call with the details mask', async () => {
		const { sendCalls } = await call(detailsRequest('ChIJabc', { sessionToken: SESSION }), {
			sendResult: { ok: true, value: { status: 200, headers: {}, body: { id: 'ChIJabc' } } },
		});

		expect(sendCalls).toHaveLength(1);
		const sent = sendCalls[0]!;

		expect(sent.url).toBe(`https://places.googleapis.com/v1/places/ChIJabc?sessionToken=${SESSION}`);
		expect(sent.method).toBe('GET');
		expect(sent.headers).toEqual({ 'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents' });
	});

	it('shapes autocomplete success to suggestions only', async () => {
		const { response } = await call(autocompleteRequest(), {
			sendResult: {
				ok: true,
				value: {
					status: 200,
					headers: {},
					body: { suggestions: [{ placePrediction: { placeId: 'ChIJok', text: { text: '10 Main St, KS' } } }] },
				},
			},
		});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ suggestions: [{ placeId: 'ChIJok', text: '10 Main St, KS' }] });
	});

	it('answers details success with the place and an exact server-stamped observedAt', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));

		const { response } = await call(detailsRequest('ChIJabc'), {
			sendResult: { ok: true, value: { status: 200, headers: {}, body: { id: 'ChIJabc', formattedAddress: 'x' } } },
		});

		expect(response.status).toBe(200);

		expect(response.body).toEqual({
			place: { id: 'ChIJabc', formattedAddress: 'x' },
			observedAt: '2026-08-09T12:00:00.000Z',
		});
	});

	it('redacts upstream failures to the pinned code and message with nothing else', async () => {
		const cases: Array<[SendResult, string, string]> = [
			[
				{ ok: true, value: { status: 401, headers: {}, body: { error: { message: MARKER } } } },
				'UPSTREAM_AUTH',
				'Google rejected the configured API key',
			],
			[
				{
					ok: true,
					value: { status: 403, headers: {}, body: { error: { message: MARKER, details: [{ key: MARKER }] } } },
				},
				'UPSTREAM_AUTH',
				'Google rejected the configured API key',
			],
			[
				{ ok: true, value: { status: 429, headers: {}, body: { error: { message: MARKER } } } },
				'UPSTREAM_RATE_LIMITED',
				'Google rate-limited the request',
			],
			[
				{ ok: true, value: { status: 500, headers: {}, body: { error: { message: MARKER } } } },
				'UPSTREAM_FAILED',
				'Google could not process the request',
			],
			[
				{ ok: false, error: { code: 'timeout', message: MARKER } },
				'UPSTREAM_FAILED',
				'the request to Google could not be completed',
			],
		];

		for (const [sendResult, code, message] of cases) {
			const { response } = await call(autocompleteRequest(), { sendResult });
			expect(response.status).toBe(502);
			expect(response.body).toEqual({ error: { code, message } });
			expect(JSON.stringify(response.body)).not.toContain(MARKER);
		}
	});

	it('maps a Google 400 with the API_KEY_INVALID reason to UPSTREAM_AUTH and other 400s to UPSTREAM_FAILED', async () => {
		const invalidKey: SendResult = {
			ok: true,
			value: {
				status: 400,
				headers: {},
				body: { error: { message: MARKER, details: [{ reason: 'API_KEY_INVALID' }] } },
			},
		};

		const { response: authResponse } = await call(autocompleteRequest(), { sendResult: invalidKey });

		expect(authResponse.body).toEqual({
			error: { code: 'UPSTREAM_AUTH', message: 'Google rejected the configured API key' },
		});

		const otherBad: SendResult = {
			ok: true,
			value: { status: 400, headers: {}, body: { error: { message: MARKER, details: [{ reason: 'OTHER' }] } } },
		};

		const { response: failedResponse } = await call(autocompleteRequest(), { sendResult: otherBad });

		expect(failedResponse.body).toEqual({
			error: { code: 'UPSTREAM_FAILED', message: 'Google could not process the request' },
		});
	});
});
