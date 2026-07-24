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
