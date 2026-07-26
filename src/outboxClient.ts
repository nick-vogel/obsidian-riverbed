import { requestUrl } from 'obsidian';
import { OutboxGateway, OutboxItem, isIdentifiable } from './sync/types';

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

// Lives in the obsidian-free src/url.ts so it can be unit tested (this module imports
// `obsidian`, which ships types only and cannot be loaded by the test runner).
// Re-exported here so existing importers keep working.
export { normalizeBaseUrl } from './url';
import { normalizeBaseUrl } from './url';

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

/**
 * The live outbox gateway: the sync pass's OutboxGateway backed by real HTTP.
 *
 * Unlike `testConnection`, which classifies outcomes for a Notice and never throws, every
 * method here THROWS on a non-2xx or an unreachable host. A sync pass wraps the whole run,
 * so a failure has to propagate to be turned into a visible status.
 */
export class HttpOutboxGateway implements OutboxGateway {
	constructor(
		private readonly getBaseUrl: () => string,
		private readonly getToken: () => string,
	) {}

	private headers(): Record<string, string> {
		return { Authorization: `Token ${this.getToken().trim()}` };
	}

	private url(path: string): string {
		return `${normalizeBaseUrl(this.getBaseUrl())}${path}`;
	}

	async getPending(): Promise<OutboxItem[]> {
		const res = await requestUrl({ url: this.url('/app-outbox'), method: 'GET', headers: this.headers() });
		// `res.json` is a getter that PARSES on access, so a 200 carrying HTML (a captive
		// portal, a proxy error page, the wrong host) throws a SyntaxError out of the whole
		// pass. Treat unparseable as an explicit, readable failure instead.
		let body: unknown;
		try {
			body = res.json;
		} catch {
			throw new Error('the server did not return JSON. Check the base URL points at a Riverbed instance.');
		}
		const items = (body as { items?: unknown } | null)?.items;
		if (!Array.isArray(items)) return [];
		// Drop ONLY what cannot be identified: without an id there is no way to ack it or
		// report against it, so it can neither be delivered nor surfaced. Everything else
		// passes through and is validated per-entry by the sync pass, which fails and
		// REPORTS a malformed entry rather than dropping it silently. Silently discarding a
		// malformed entry here would stall it forever with no user-visible trace.
		const usable = items.filter(isIdentifiable);
		if (usable.length !== items.length) {
			console.log(
				`Riverbed: ignored ${items.length - usable.length} outbox entr${items.length - usable.length === 1 ? 'y' : 'ies'} with no id`,
			);
		}
		return usable as OutboxItem[];
	}

	async ack(id: string): Promise<void> {
		// Idempotent per the contract: re-acking a delivered entry is a 200, never an error.
		await requestUrl({
			url: this.url(`/app-outbox/${encodeURIComponent(id)}/ack`),
			method: 'POST',
			headers: this.headers(),
		});
	}

	async reportError(id: string, reason: string): Promise<void> {
		await requestUrl({
			url: this.url(`/app-outbox/${encodeURIComponent(id)}/error`),
			method: 'POST',
			headers: { ...this.headers(), 'Content-Type': 'application/json' },
			body: JSON.stringify({ reason }),
		});
	}
}
