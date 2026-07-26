import { describe, expect, it } from 'vitest';
import { isIdentifiable, isOutboxItem } from '../src/sync/types';

const good = { id: 'abc', renderedMarkdown: '# hi', suggestedFilename: 'x.md' };

describe('isOutboxItem', () => {
	it('accepts a well formed entry', () => {
		expect(isOutboxItem(good)).toBe(true);
	});

	it('rejects a non-string body, which would otherwise reach vault.create', () => {
		expect(isOutboxItem({ ...good, renderedMarkdown: null })).toBe(false);
		expect(isOutboxItem({ ...good, renderedMarkdown: 42 })).toBe(false);
		expect(isOutboxItem({ ...good, suggestedFilename: undefined })).toBe(false);
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
