import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '../src/sync/sanitize';

/** Every sanitized name must satisfy all of these, whatever the server sent. */
function expectSafe(result: string) {
	expect(result).not.toBe('');
	expect(result).not.toContain('/');
	expect(result).not.toContain('\\');
	expect(result).not.toContain('..');
	expect(result.startsWith('.')).toBe(false);
	expect(result.toLowerCase().endsWith('.md')).toBe(true);
}

describe('sanitizeFilename', () => {
	it('leaves an ordinary capture filename alone', () => {
		const out = sanitizeFilename('2026-07-17_14-30-05-capture.md', 'abc');
		expect(out).toBe('2026-07-17_14-30-05-capture.md');
		expectSafe(out);
	});

	it('replaces characters Obsidian forbids', () => {
		const out = sanitizeFilename('why: this? *notes*.md', 'abc');
		expect(out).toBe('why- this- -notes-.md');
		expectSafe(out);
	});

	it('defuses a parent-directory traversal attempt', () => {
		const out = sanitizeFilename('../../../etc/passwd.md', 'abc');
		expectSafe(out);
	});

	it('flattens a path separator instead of writing into a subfolder', () => {
		const out = sanitizeFilename('foo/bar.md', 'abc');
		expect(out).toBe('foo-bar.md');
		expectSafe(out);
	});

	it('falls back to the entry id when the name sanitizes away entirely', () => {
		expect(sanitizeFilename('...', 'abc123')).toBe('riverbed-capture-abc123.md');
		expect(sanitizeFilename('', 'abc123')).toBe('riverbed-capture-abc123.md');
		expect(sanitizeFilename('   ', 'abc123')).toBe('riverbed-capture-abc123.md');
		expectSafe(sanitizeFilename('...', 'abc123'));
	});

	it('appends the extension when the server omits it', () => {
		const out = sanitizeFilename('capture-without-extension', 'abc');
		expect(out).toBe('capture-without-extension.md');
		expectSafe(out);
	});

	it('strips a leading dot so the note is not hidden', () => {
		const out = sanitizeFilename('.hidden.md', 'abc');
		expect(out).toBe('hidden.md');
		expectSafe(out);
	});

	it('strips control characters', () => {
		const out = sanitizeFilename('bad\u0001name\u007f.md', 'abc');
		expect(out).toBe('bad-name-.md');
		expectSafe(out);
	});
});

describe('sanitizeFilename — trailing dots and length', () => {
	it('strips trailing dots so the no-".." guarantee actually holds', () => {
		// Regression: `note.` used to become `note..md`, violating this function's own
		// documented invariant and the safety predicate the rest of this suite asserts.
		expect(sanitizeFilename('note.', 'id1')).toBe('note.md');
		expect(sanitizeFilename('trailing...', 'id1')).toBe('trailing.md');
		expect(sanitizeFilename('spaced . ', 'id1')).toBe('spaced.md');
		expectSafe(sanitizeFilename('note.', 'id1'));
		expectSafe(sanitizeFilename('trailing...', 'id1'));
	});

	it('caps a very long name to stay inside the filesystem component limit', () => {
		// Uncapped, a long feed title throws ENAMETOOLONG on every pass: never acked,
		// re-reported each poll, stranded in the outbox forever.
		const long = 'a'.repeat(500);
		const out = sanitizeFilename(long, 'id1');
		expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(255);
		expect(out.endsWith('.md')).toBe(true);
		expectSafe(out);
	});

	it('caps by BYTES, not characters, and never splits a character', () => {
		// A non-Latin title costs up to 4 bytes per character, so a character budget
		// would sail past the byte limit it is meant to respect.
		const out = sanitizeFilename('日'.repeat(300), 'id1');
		expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(255);
		expect(out).not.toContain('�');
		expectSafe(out);
	});

	it('falls back when a name is nothing but dots and spaces', () => {
		expect(sanitizeFilename('  ... ', 'abc')).toBe('riverbed-capture-abc.md');
	});
});
