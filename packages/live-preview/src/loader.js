/**
 * Only the most recent load() call applies its result or reports its failure. A call
 * superseded while one of its fetches was in flight applies nothing and resolves false.
 */
export function createLoader({ loadTemplate, loadValues, onResult, onError }) {
	let round = 0;

	return async function load(context) {
		const current = ++round;

		try {
			const template = await loadTemplate(context);
			if (current !== round) return false;

			const values = template ? await loadValues(template, context) : {};
			if (current !== round) return false;

			onResult({ template, values });
			return true;
		} catch (error) {
			if (current === round) onError?.(error);
			return false;
		}
	};
}
