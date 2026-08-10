const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function resolveLanguage(userLanguage: unknown, projectDefault: unknown): string {
	for (const candidate of [userLanguage, projectDefault]) {
		if (typeof candidate === 'string' && candidate.length <= 35 && LANGUAGE_PATTERN.test(candidate)) {
			return candidate;
		}
	}

	return 'en-US';
}
