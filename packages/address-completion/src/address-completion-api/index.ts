import { defineJsonEndpoint, type ExtensionSecretReference } from '@cairncms/extensions-server-api';
import {
	AUTOCOMPLETE_FIELD_MASK,
	AUTOCOMPLETE_URL,
	DETAILS_FIELD_MASK,
	parseAutocompleteBody,
	parseDetailsRequest,
	shapeSuggestions,
} from './requests.js';

type EndpointResult = { status: number; body: Record<string, unknown> };

function failure(status: number, code: string, message: string): EndpointResult {
	return { status, body: { error: { code, message } } };
}

function isInvalidKeyBody(body: unknown): boolean {
	if (typeof body !== 'object' || body === null) return false;

	const error = (body as Record<string, unknown>)['error'];
	if (typeof error !== 'object' || error === null) return false;

	const details = (error as Record<string, unknown>)['details'];
	if (!Array.isArray(details)) return false;

	return details.some(
		(entry) =>
			typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>)['reason'] === 'API_KEY_INVALID'
	);
}

function upstreamFailure(googleStatus: number, googleBody: unknown): EndpointResult {
	if (googleStatus === 401 || googleStatus === 403 || isInvalidKeyBody(googleBody)) {
		return failure(502, 'UPSTREAM_AUTH', 'Google rejected the configured API key');
	}

	if (googleStatus === 429) {
		return failure(502, 'UPSTREAM_RATE_LIMITED', 'Google rate-limited the request');
	}

	return failure(502, 'UPSTREAM_FAILED', 'Google could not process the request');
}

function isSecretReference(value: unknown): value is ExtensionSecretReference {
	return typeof value === 'object' && value !== null && (value as ExtensionSecretReference).kind === 'secret-reference';
}

export default defineJsonEndpoint({
	id: 'address-completion-api',
	async handler(request, { host }): Promise<EndpointResult> {
		const isAutocomplete = request.method === 'POST' && request.path === '/autocomplete';
		const isDetails = request.method === 'GET' && request.path.startsWith('/place/');

		if (!isAutocomplete && !isDetails) {
			return failure(404, 'ROUTE_NOT_FOUND', 'unknown route');
		}

		const parsed = isAutocomplete
			? parseAutocompleteBody(request.body)
			: parseDetailsRequest(request.path, (request.query ?? {}) as Record<string, unknown>);

		if (!parsed.ok) {
			return failure(400, 'INVALID_INPUT', parsed.message);
		}

		const keyResult = await host.settings.get('google_maps_api_key');

		if (!keyResult.ok || !isSecretReference(keyResult.value)) {
			return failure(503, 'MISSING_KEY', 'google_maps_api_key is not configured');
		}

		const auth = { header: 'X-Goog-Api-Key', secret: keyResult.value };

		const result =
			'outbound' in parsed
				? await host.request.send({
						url: AUTOCOMPLETE_URL,
						method: 'POST',
						headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK },
						body: JSON.stringify(parsed.outbound),
						auth,
				  })
				: await host.request.send({
						url: parsed.url,
						method: 'GET',
						headers: { 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
						auth,
				  });

		if (!result.ok) {
			return failure(502, 'UPSTREAM_FAILED', 'the request to Google could not be completed');
		}

		if (result.value.status !== 200) {
			return upstreamFailure(result.value.status, result.value.body);
		}

		if ('outbound' in parsed) {
			return { status: 200, body: { suggestions: shapeSuggestions(result.value.body) } };
		}

		return {
			status: 200,
			body: { place: (result.value.body ?? {}) as Record<string, unknown>, observedAt: new Date().toISOString() },
		};
	},
});
