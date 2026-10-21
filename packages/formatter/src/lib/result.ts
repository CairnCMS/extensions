import { BOUNDS } from './bounds.js';
import { cloneSourceAccounted } from './clone.js';

export function cloneAndMeasureResult(value: unknown): { value: unknown; bytes: number } {
	return cloneSourceAccounted(value, BOUNDS, 'the transform result', 'RESULT_SHAPE');
}
