export interface Bounds {
	maxInputStringLength: number;
	maxRulesPerOperation: number;
	maxPathDepth: number;
	maxWildcardMatches: number;
	maxSourceDepth: number;
	maxSourceNodeCount: number;
	maxSerializedSizeBytes: number;
	maxListItems: number;
	maxLookupRows: number;
	maxReplacementInputLength: number;
	maxOutputLength: number;
	maxNumberDigits: number;
	maxExponentMagnitude: number;
	maxLocaleIdentifierLength: number;
	maxPathLength: number;
	maxOptionStringLength: number;
	maxLookupAggregateLength: number;
	maxOptionGraphNodeCount: number;
	maxOptionGraphBytes: number;
	maxInvocationsPerOperation: number;
	maxAggregateOutputBytes: number;
	maxProcessedInputBytes: number;
}

export const BOUNDS: Bounds = {
	maxInputStringLength: 100_000,
	maxRulesPerOperation: 64,
	maxPathDepth: 16,
	maxWildcardMatches: 10_000,
	maxSourceDepth: 32,
	maxSourceNodeCount: 20_000,
	maxSerializedSizeBytes: 1024 * 1024,
	maxListItems: 1_000,
	maxLookupRows: 1_000,
	maxReplacementInputLength: 100_000,
	maxOutputLength: 1_000_000,
	maxNumberDigits: 100,
	maxExponentMagnitude: 300,
	maxLocaleIdentifierLength: 64,
	maxPathLength: 512,
	maxOptionStringLength: 256,
	maxLookupAggregateLength: 262_144,
	maxOptionGraphNodeCount: 20_000,
	maxOptionGraphBytes: 1024 * 1024,
	maxInvocationsPerOperation: 20_000,
	maxAggregateOutputBytes: 1024 * 1024,
	maxProcessedInputBytes: 1024 * 1024,
};
