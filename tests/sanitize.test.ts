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

	it('caps by BYTES, not characters', () => {
		// A non-Latin title costs up to 4 bytes per character, so a character budget
		// would sail past the byte limit it is meant to respect.
		const out = sanitizeFilename('日'.repeat(300), 'id1');
		expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(255);
		expectSafe(out);
	});

	it('never splits a surrogate pair when truncating', () => {
		// Regression: capBytes used slice(0,-1), which drops one UTF-16 CODE UNIT and so
		// halves an emoji at the boundary, leaving a lone high surrogate that is written to
		// disk as a replacement character. The previous assertion here checked the output
		// did not CONTAIN U+FFFD, which JS string slicing can never produce, so it passed
		// while the bug was live. Check for unpaired surrogates instead, which is the thing
		// that actually goes wrong.
		const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
		// Sweep the boundary: the failure only appears at the exact lengths where the pair
		// straddles the byte budget.
		for (let n = 150; n <= 260; n++) {
			const out = sanitizeFilename('a'.repeat(n) + '\u{1F600}', 'id1');
			expect(lone.test(out), `unpaired surrogate at n=${n}: ${out}`).toBe(false);
			expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(255);
		}
	});

	it('prefixes Windows reserved device names, which are illegal with any extension', () => {
		// CON.md is as invalid as CON on Windows, and isDesktopOnly is false. Uncaught, the
		// write fails on every pass and the entry is stranded in the outbox forever.
		expect(sanitizeFilename('CON', 'id1')).toBe('riverbed-CON.md');
		expect(sanitizeFilename('con.md', 'id1')).toBe('riverbed-con.md');
		expect(sanitizeFilename('NUL.md', 'id1')).toBe('riverbed-NUL.md');
		expect(sanitizeFilename('COM1', 'id1')).toBe('riverbed-COM1.md');
		expect(sanitizeFilename('lpt9.md', 'id1')).toBe('riverbed-lpt9.md');
		// Not reserved: a longer name that merely starts with one.
		expect(sanitizeFilename('console.md', 'id1')).toBe('console.md');
		expect(sanitizeFilename('connection', 'id1')).toBe('connection.md');
	});

	it('falls back when a name is nothing but dots and spaces', () => {
		expect(sanitizeFilename('  ... ', 'abc')).toBe('riverbed-capture-abc.md');
	});

	it('sanitizes the FALLBACK ID too, which is equally server-controlled', () => {
		// The hole this closes: the fallback interpolated the entry id raw, so an id of
		// `../../../../Users/me/.zshrc` with an unusable filename produced a path that
		// Obsidian's normalizePath leaves alone but the adapter's path.join resolves,
		// writing OUTSIDE the vault. Every earlier fallback test used a benign id, which
		// is why it survived two reviews.
		const hostile = sanitizeFilename('...', '../../../../Users/me/.zshrc');
		expect(hostile).not.toContain('/');
		expect(hostile).not.toContain('\\');
		expect(hostile).not.toContain('..');
		expectSafe(hostile);

		expect(sanitizeFilename('', '../../etc/passwd')).not.toContain('/');
		expect(sanitizeFilename('***', 'a/b\\c:d')).not.toMatch(/[\\/:]/);
	});

	it('caps a very long fallback id, so an unusable name cannot strand the entry', () => {
		const out = sanitizeFilename('...', 'a'.repeat(400));
		expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(255);
		expectSafe(out);
	});

	it('still produces a usable name when the id sanitizes away entirely', () => {
		expect(sanitizeFilename('...', '///')).toBe('riverbed-capture-unknown.md');
		expect(sanitizeFilename('...', '')).toBe('riverbed-capture-unknown.md');
	});

	it('catches a reserved device name before ANY dot, not just before .md', () => {
		// Windows resolves the device from the first segment and ignores trailing spaces,
		// so these all still hit the device despite not being bare `CON.md`.
		expect(sanitizeFilename('CON.txt', 'id1')).toBe('riverbed-CON.txt.md');
		expect(sanitizeFilename('nul.md.md', 'id1')).toBe('riverbed-nul.md.md');
		expect(sanitizeFilename('CON .md', 'id1')).toBe('riverbed-CON .md');
	});

	it('leaves COM0 and LPT0 alone, which are not reserved', () => {
		expect(sanitizeFilename('COM0', 'id1')).toBe('COM0.md');
		expect(sanitizeFilename('LPT0', 'id1')).toBe('LPT0.md');
	});
});
