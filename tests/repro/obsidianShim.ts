// Minimal stand-in for Obsidian's `requestUrl`, faithful to the two behaviours the
// outbox client depends on:
//   1. it THROWS on a non-2xx unless `throw: false` is passed
//   2. `json` is a GETTER that parses on access, so unparseable bodies throw at the
//      access site rather than at request time
export async function requestUrl(opts: {
	url: string
	method?: string
	headers?: Record<string, string>
	body?: string
	throw?: boolean
}) {
	const res = await fetch(opts.url, {
		method: opts.method ?? 'GET',
		headers: opts.headers,
		body: opts.body,
	})
	const text = await res.text()
	const shouldThrow = opts.throw !== false
	if (shouldThrow && (res.status < 200 || res.status >= 300)) {
		throw new Error(`Request failed, status ${res.status}`)
	}
	return {
		status: res.status,
		text,
		get json() {
			return JSON.parse(text)
		},
	}
}
