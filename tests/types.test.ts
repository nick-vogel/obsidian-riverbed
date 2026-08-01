import { describe, expect, it } from 'vitest';
import { filenameOf, isIdentifiable, isOutboxItem } from '../src/sync/types';

const good = { id: 'abc', renderedMarkdown: '# hi', suggestedFilename: 'x.md' };

describe('isOutboxItem', () => {
	it('accepts a well formed entry', () => {
		expect(isOutboxItem(good)).toBe(true);
	});

	it('rejects a non-string body, which would otherwise reach vault.create', () => {
		expect(isOutboxItem({ ...good, renderedMarkdown: null })).toBe(false);
		expect(isOutboxItem({ ...good, renderedMarkdown: 42 })).toBe(false);
	});

	// NARROWED 2026-07-27. This used to also reject a missing `suggestedFilename`, which
	// made a recoverable field fatal: the entry was rejected as malformed on EVERY poll,
	// forever, with no way for the user to fix it — the article was never the problem.
	// `sanitizeFilename` already derives a name from the entry id, and takes that id for
	// exactly this case. The assertion is replaced rather than deleted because the thing it
	// protected (a body that is not a string must never reach `vault.create`) is still real
	// and is pinned above.
	it('accepts an entry with no filename, because that is recoverable', () => {
		// null is the case that matters: Payload serves an unset `text` column as null, so
		// that is what the wire actually carries for a save created outside app-save.ts.
		expect(isOutboxItem({ ...good, suggestedFilename: null })).toBe(true);
		expect(isOutboxItem({ ...good, suggestedFilename: undefined })).toBe(true);
	});

	it('still rejects a filename that is neither a string nor absent', () => {
		// Recoverable is not the same as "anything goes". A number here means the server is
		// sending something this client does not understand, and the predicate promises
		// `string | null | undefined` — it has to actually check that or it is lying.
		expect(isOutboxItem({ ...good, suggestedFilename: 42 })).toBe(false);
		expect(isOutboxItem({ ...good, suggestedFilename: {} })).toBe(false);
	});

	it('normalises any unusable filename to an empty string for the id fallback', () => {
		expect(filenameOf({ ...good, suggestedFilename: undefined } as never)).toBe('');
		expect(filenameOf({ ...good, suggestedFilename: null } as never)).toBe('');
		expect(filenameOf({ ...good, suggestedFilename: 42 } as never)).toBe('');
		expect(filenameOf({ ...good, suggestedFilename: 'kept.md' } as never)).toBe('kept.md');
	});

	it('rejects a missing or empty id', () => {
		expect(isOutboxItem({ ...good, id: '' })).toBe(false);
		expect(isOutboxItem({ ...good, id: 7 })).toBe(false);
	});

	it('rejects non-objects', () => {
		expect(isOutboxItem(null)).toBe(false);
		expect(isOutboxItem('nope')).toBe(false);
	});

	it('accepts an empty string body: a legitimately empty capture is not malformed', () => {
		expect(isOutboxItem({ ...good, renderedMarkdown: '' })).toBe(true);
	});
});

describe('isIdentifiable', () => {
	it('is the weaker check: an id is enough to ack or report against', () => {
		expect(isIdentifiable({ id: 'abc' })).toBe(true);
		// Malformed but identifiable, so it must NOT be dropped; it gets failed and
		// reported instead, which is what makes it visible in the reader's Outbox.
		expect(isIdentifiable({ id: 'abc', renderedMarkdown: null })).toBe(true);
	});

	it('rejects what cannot be reported against at all', () => {
		expect(isIdentifiable({ id: '' })).toBe(false);
		expect(isIdentifiable({})).toBe(false);
		expect(isIdentifiable(null)).toBe(false);
	});
});
