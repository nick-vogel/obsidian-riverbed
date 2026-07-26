// Pure URL helpers. Deliberately free of any `obsidian` import, for the same reason
// settings.ts is: the `obsidian` package ships types only and has no runtime entry, so
// anything importing it cannot be loaded by the test runner. Logic that deserves a test
// lives in a module like this one; outboxClient.ts keeps the parts that genuinely need
// Obsidian's `requestUrl`.

/**
 * Strip trailing slashes (and surrounding whitespace) from a user-entered base URL, so a
 * self-hosted instance typed as `https://host/` does not produce a double-slashed
 * `https://host//app-outbox`. A pasted URL commonly carries both.
 */
export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, '');
}
