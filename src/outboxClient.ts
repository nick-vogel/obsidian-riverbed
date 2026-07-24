import { requestUrl } from 'obsidian';

// Client for Riverbed's outbox API. Contract (ground truth): the riverbed repo's
// docs/outbox-api.md. Auth is `Authorization: Token <token>` -- NOT Bearer, NOT JWT;
// those two prefixes are reserved by Payload's own session auth and will not
// authenticate an outbox token.

/** The outcome of a Test-connection attempt, mapped to a Notice by the settings tab. */
export type TestConnectionResult =
	| { kind: 'connected'; pending: number | null }
	| { kind: 'auth-failed' }
	| { kind: 'unexpected-status'; status: number }
	| { kind: 'unreachable' };

/**
 * Strip trailing slashes so a self-hosted base URL entered as `https://host/` does not
 * produce a double-slashed `https://host//app-outbox`.
 */
export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, '');
}

/**
 * `GET /app-outbox` purely to classify the configured base URL + token.
 *
 * `throw: false` makes a non-2xx a return value rather than an exception, so the only
 * thrown case left is a genuinely unreachable host (DNS/connection failure).
 */
export async function testConnection(baseUrl: string, token: string): Promise<TestConnectionResult> {
	const url = `${normalizeBaseUrl(baseUrl)}/app-outbox`;
	let res;
	try {
		res = await requestUrl({
			url,
			method: 'GET',
			headers: { Authorization: `Token ${token.trim()}` },
			throw: false,
		});
	} catch (e) {
		return { kind: 'unreachable' };
	}

	if (res.status === 200) {
		// A 200 that isn't the documented shape still means the host answered, so it is
		// reported as connected with an unknown count rather than as unreachable.
		let pending: number | null = null;
		try {
			const items = res.json?.items;
			if (Array.isArray(items)) pending = items.length;
		} catch (e) {
			pending = null;
		}
		return { kind: 'connected', pending };
	}
	if (res.status === 401) return { kind: 'auth-failed' };
	return { kind: 'unexpected-status', status: res.status };
}
