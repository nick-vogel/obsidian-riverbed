import { describe, expect, it } from 'vitest';
import { folderNotice, sanitizeFilename, sanitizeFolder } from '../src/sync/sanitize';

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

	it('collapses an INTERIOR run of dots, not only a leading or trailing one', () => {
		// Found by mutation testing: deleting the dot-collapse left the whole suite green,
		// because every traversal case in it also had a leading dot run that the separate
		// leading-dot strip removed. An interior run is the case only this line handles, and
		// nothing exercised it, so the "no `..` in the result" guarantee was unenforced.
		expect(sanitizeFilename('report..final.md', 'id1')).toBe('report.final.md');
		expect(sanitizeFilename('a....b', 'id1')).toBe('a.b.md');
		expectSafe(sanitizeFilename('report..final.md', 'id1'));
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

	it('strips dots from the fallback id even when the `..` is INTERIOR', () => {
		// Every other fallback-id case here puts the `..` at the START, where the separate
		// leading-dot strip removes it, so the id's own dot-strip was never the thing under
		// test and deleting it left the suite green. An interior `..` is the case only that
		// line handles, and it breaks the function's documented "no `..`" guarantee.
		expect(sanitizeFilename('...', 'x..y')).toBe('riverbed-capture-x--y.md');
		expect(sanitizeFilename('...', 'a/../b')).not.toContain('..');
		expectSafe(sanitizeFilename('...', 'a/../b'));
		expectSafe(sanitizeFilename('...', 'x..y'));
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

	it('strips bidi overrides, which spoof how a filename renders', () => {
		// U+202E reverses display order, so a server could make a capture LOOK like a
		// different filename than the one on disk. Invisible, so nothing else catches it.
		const out = sanitizeFilename('report\u202Egnp.md', 'id1');
		expect(out).not.toContain('\u202E');
		expectSafe(out);
		const viaId = sanitizeFilename('...', '\u202Eevil');
		expect(viaId).not.toContain('\u202E');
		expect(sanitizeFilename('a\u2066b\u2069c', 'id1')).not.toMatch(/[\u2066-\u2069]/);
	});

	it('strips C1 control characters', () => {
		expect(sanitizeFilename('a\u0085b', 'id1')).toBe('a-b.md');
	});

	it('leaves COM0 and LPT0 alone, which are not reserved', () => {
		expect(sanitizeFilename('COM0', 'id1')).toBe('COM0.md');
		expect(sanitizeFilename('LPT0', 'id1')).toBe('LPT0.md');
	});
});

describe('sanitizeFilename — NFC before the byte budget', () => {
	// normalizePath applies NFC on the way to the write, and NFC can GROW a string, so a
	// budget measured on the pre-NFC form under-counts what actually hits the filesystem.
	// Past 255 bytes the write throws ENAMETOOLONG on every pass and strands the entry,
	// which is precisely what the cap was added to prevent.
	const nfcBytes = (s: string) => new TextEncoder().encode(s.normalize('NFC')).length;

	it('stays under the filesystem limit AFTER NFC, not just before it', () => {
		// U+1D160 triples under NFC; U+0344 doubles.
		expect(nfcBytes(sanitizeFilename('\u{1D160}'.repeat(80), 'id1'))).toBeLessThanOrEqual(255);
		expect(nfcBytes(sanitizeFilename('̈́'.repeat(200), 'id1'))).toBeLessThanOrEqual(255);
	});

	it('applies the same guarantee to the fallback id path', () => {
		expect(nfcBytes(sanitizeFilename('...', '̈́'.repeat(200)))).toBeLessThanOrEqual(255);
	});

	it('returns an already-NFC name on the fallback path, not merely a short one', () => {
		// A byte-length bound cannot test this: the correct form and the un-normalized one
		// both come in under 255, so the assertion above passes either way. The property that
		// actually depends on normalizing the id is that the result is NFC-STABLE, which is
		// what normalizePath would otherwise change on the way to disk, landing the write at
		// a different path than the one just checked for collisions.
		const out = sanitizeFilename('...', '\u0344'.repeat(60));
		expect(out).toBe(out.normalize('NFC'));
	});

	it('leaves ordinary names unaffected', () => {
		expect(sanitizeFilename('a normal title', 'id1')).toBe('a normal title.md');
		expect(nfcBytes(sanitizeFilename('日'.repeat(300), 'id1'))).toBeLessThanOrEqual(255);
	});
});

/** Every sanitized folder must satisfy all of these, whatever the user typed. */
function expectSafeFolder(folder: string) {
	expect(folder).not.toContain('\\');
	expect(folder).not.toContain('..');
	expect(folder.startsWith('/')).toBe(false);
	expect(folder.endsWith('/')).toBe(false);
	expect(folder).not.toMatch(/\/\//);
	// No segment may be hidden, and none may carry a drive letter.
	for (const segment of folder === '' ? [] : folder.split('/')) {
		expect(segment).not.toBe('');
		expect(segment.startsWith('.')).toBe(false);
		expect(segment).not.toMatch(/^[A-Za-z]:$/);
	}
}

describe('sanitizeFolder — nesting is preserved', () => {
	it('leaves an ordinary folder alone', () => {
		expect(sanitizeFolder('inbox')).toEqual({ folder: 'inbox', escaped: false, changed: false });
		expectSafeFolder(sanitizeFolder('inbox').folder);
	});

	it('KEEPS "/" as a nesting separator', () => {
		// The whole reason this cannot reuse sanitizeFilename's rules, which flatten every
		// separator: nested destination folders are supported.
		const out = sanitizeFolder('research/inbox');
		expect(out.folder).toBe('research/inbox');
		expect(out.changed).toBe(false);
		expectSafeFolder(out.folder);
		expect(sanitizeFolder('a/b/c/d').folder).toBe('a/b/c/d');
	});

	it('treats an empty folder as the vault root', () => {
		expect(sanitizeFolder('')).toEqual({ folder: '', escaped: false, changed: false });
		expect(sanitizeFolder('   ')).toEqual({ folder: '', escaped: false, changed: false });
	});

	it('tidies separators QUIETLY, so ordinary typing raises no notice', () => {
		// changed drives a user-facing Notice, so a trailing slash or a doubled one must not
		// fire it. Only a value that actually lost something should.
		for (const input of ['inbox/', 'inbox//', 'a//b', 'a\\b', '  inbox  ', 'in box / notes']) {
			expect(sanitizeFolder(input).changed, input).toBe(false);
		}
		expect(sanitizeFolder('in box / notes').folder).toBe('in box/notes');
		expect(sanitizeFolder('inbox/').folder).toBe('inbox');
		expect(sanitizeFolder('a//b').folder).toBe('a/b');
		expect(sanitizeFolder('a\\b').folder).toBe('a/b');
	});
});

describe('sanitizeFolder — cannot leave the vault', () => {
	it('strips a ".." segment, the actual hole', () => {
		// A user-typed `../../notes` wrote OUTSIDE the vault: normalizePath does not resolve
		// `..`, but the adapter joins with the vault path and Node's path.join does.
		const out = sanitizeFolder('../../notes');
		expect(out.folder).toBe('notes');
		expect(out.escaped).toBe(true);
		expectSafeFolder(out.folder);

		expect(sanitizeFolder('..').folder).toBe('');
		expect(sanitizeFolder('..').escaped).toBe(true);
		expect(sanitizeFolder('inbox/../../..').folder).toBe('inbox');
		expect(sanitizeFolder('../../../../Users/me/.ssh').folder).toBe('Users/me/ssh');
		for (const input of ['..', '../x', 'x/..', 'x/../y', '../../notes']) {
			expect(sanitizeFolder(input).escaped, input).toBe(true);
			expectSafeFolder(sanitizeFolder(input).folder);
		}
	});

	it('treats "\\" as a separator, because normalizePath folds it to "/"', () => {
		// Left as an ordinary character, `..\..\notes` would pass the `..` check here and then
		// be turned back into a traversal by Obsidian on the way to the write.
		const out = sanitizeFolder('..\\..\\notes');
		expect(out.folder).toBe('notes');
		expect(out.escaped).toBe(true);
		expectSafeFolder(out.folder);
	});

	it('flags a PADDED traversal as an escape, not merely as a tidy-up', () => {
		// Deciding `escaped` from a regex over the raw string missed these: the segment was
		// stripped (so the folder stayed safe) but the user was told "not usable as typed"
		// instead of "cannot leave your vault", which is the one thing they needed to know.
		for (const input of ['.. /x', '..\t/x', '.. /x', '..　/x', '​../x']) {
			expect(sanitizeFolder(input).escaped, JSON.stringify(input)).toBe(true);
			expectSafeFolder(sanitizeFolder(input).folder);
		}
	});

	it('flags an INVISIBLY padded absolute path and drive prefix, not just a traversal', () => {
		// The escape checks must all agree with what the user sees. A zero-width space in
		// front of `/etc` renders as `/etc`, so reporting it as a mere tidy-up told them the
		// wrong thing. The `..` check was fixed first and left these two behind.
		expect(sanitizeFolder('​/etc').escaped).toBe(true);
		expect(sanitizeFolder('⁠/etc').escaped).toBe(true);
		expect(sanitizeFolder('‎\\x').escaped).toBe(true);

		const drive = sanitizeFolder('​C:/x');
		expect(drive.escaped).toBe(true);
		expect(drive.folder).toBe('x');

		// Two invisibles that a human cannot tell apart from `..` are treated alike: the
		// leading-padded form and the interior-padded one both read as `..` on screen.
		expect(sanitizeFolder('​../x').escaped).toBe(true);
		expect(sanitizeFolder('.​./x').escaped).toBe(true);

		// Trailing space THEN a zero-width space. The per-segment trim cannot reach the
		// space, because the zero-width character is not whitespace and sits outside it, so
		// the whitespace only becomes trimmable once the invisibles are stripped. Both
		// operations are needed and in that order.
		expect(sanitizeFolder('.. ​/x').escaped).toBe(true);
		expect(sanitizeFolder('.. ​/x').folder).toBe('x');
	});

	it('does not flag a dotted segment that is not a traversal', () => {
		// `...` and `.` are dropped as meaningless, but neither leaves the vault, so neither
		// should produce the escape notice.
		expect(sanitizeFolder('.').escaped).toBe(false);
		expect(sanitizeFolder('.../x').escaped).toBe(false);
		expect(sanitizeFolder('....').escaped).toBe(false);
	});

	it('rejects an absolute path', () => {
		for (const input of ['/etc', '/Users/me/notes', '\\\\server\\share']) {
			expect(sanitizeFolder(input).escaped, input).toBe(true);
			expectSafeFolder(sanitizeFolder(input).folder);
		}
		expect(sanitizeFolder('/Users/me/notes').folder).toBe('Users/me/notes');
	});

	it('rejects a Windows drive prefix, dropping the letter rather than mangling it', () => {
		const out = sanitizeFolder('C:\\Users\\me\\notes');
		expect(out.folder).toBe('Users/me/notes');
		expect(out.escaped).toBe(true);
		expectSafeFolder(out.folder);
		// Only as the FIRST segment, and only a bare drive letter.
		expect(sanitizeFolder('notes/C:/x').escaped).toBe(false);
		expect(sanitizeFolder('CD:/x').escaped).toBe(false);
	});

	it('does not mistake an interior dot for a traversal', () => {
		// `..` only traverses as a WHOLE segment, so an ordinary dotted name is untouched
		// and never reported as an escape.
		expect(sanitizeFolder('my.notes')).toEqual({
			folder: 'my.notes',
			escaped: false,
			changed: false,
		});
		// A doubled interior dot is still collapsed, which keeps the stronger invariant the
		// safety predicate asserts (no `..` anywhere, not merely no `..` segment), but it is
		// a tidy-up rather than an escape.
		expect(sanitizeFolder('a..b')).toEqual({ folder: 'a.b', escaped: false, changed: true });
	});
});

describe('sanitizeFolder — per-segment cleanup', () => {
	it('sanitizes each segment while the separators between them survive', () => {
		const out = sanitizeFolder('why: this?/*notes*');
		expect(out.folder).toBe('why- this-/notes-');
		expect(out.changed).toBe(true);
		expectSafeFolder(out.folder);
	});

	it('strips a leading dot, so a typed ".obsidian" cannot aim at the config directory', () => {
		expect(sanitizeFolder('.obsidian/plugins').folder).toBe('obsidian/plugins');
		expect(sanitizeFolder('.hidden').folder).toBe('hidden');
		expectSafeFolder(sanitizeFolder('.obsidian/plugins').folder);
	});

	it('strips control characters and bidi overrides', () => {
		expect(sanitizeFolder('in\u0001box').folder).toBe('in-box');
		expect(sanitizeFolder('in\u202Ebox').folder).not.toContain('\u202E');
	});

	it('prefixes a Windows reserved device name, which cannot be a folder there', () => {
		// Same permanent-stranding failure as the filename path: the folder can never be
		// created on Windows, so every write fails on every pass forever.
		expect(sanitizeFolder('CON').folder).toBe('riverbed-CON');
		expect(sanitizeFolder('notes/aux').folder).toBe('notes/riverbed-aux');
		expect(sanitizeFolder('console').folder).toBe('console');
	});

	it('caps an over-long segment at the filesystem component limit', () => {
		const out = sanitizeFolder('a'.repeat(400));
		expect(new TextEncoder().encode(out.folder).length).toBeLessThanOrEqual(255);
		expectSafeFolder(out.folder);
		// Bytes, not characters: a non-Latin name costs up to 4 bytes per character.
		const wide = sanitizeFolder('日'.repeat(300));
		expect(new TextEncoder().encode(wide.folder).length).toBeLessThanOrEqual(255);
	});

	it('keeps a reserved-name segment inside the byte cap AFTER prefixing', () => {
		// Regression: the cap ran first and `riverbed-` was prepended afterwards, adding 9
		// bytes and landing a long reserved segment at 264, past the 255-byte component
		// limit. createFolder then throws ENAMETOOLONG, ensureFolder swallows it into a log
		// line, and every capture bound for that folder fails on every pass forever. The
		// existing cap test could never catch it: `a`.repeat(400) never enters this branch.
		for (const name of ['con', 'AUX', 'nul', 'prn', 'com1', 'lpt9']) {
			const out = sanitizeFolder(`${name}.${'a'.repeat(400)}`).folder;
			expect(out.startsWith('riverbed-'), name).toBe(true);
			expect(new TextEncoder().encode(out).length, name).toBeLessThanOrEqual(255);
		}
		// The same crossing in a nested path, where each segment gets its own budget.
		const nested = sanitizeFolder(`con.${'a'.repeat(400)}/nul.${'b'.repeat(400)}`).folder;
		for (const segment of nested.split('/')) {
			expect(new TextEncoder().encode(segment).length).toBeLessThanOrEqual(255);
		}
	});

	it('strips a trailing dot or space from a segment', () => {
		// Windows silently strips these from a name on disk, so leaving them makes the
		// created folder differ from the one the field and the notice both display. The
		// filename path has carried this guard and its test since launch; the folder path
		// duplicated the code without the test, and mutation testing found the gap.
		expect(sanitizeFolder('notes.').folder).toBe('notes');
		expect(sanitizeFolder('notes ').folder).toBe('notes');
		expect(sanitizeFolder('a/notes. /b').folder).toBe('a/notes/b');
		expect(sanitizeFolder('spaced . ').folder).toBe('spaced');
		expectSafeFolder(sanitizeFolder('a/notes. /b').folder);
	});

	it('trims a trailing dot exposed BY the byte cap', () => {
		// The cap can land exactly on a dot, so the trailing trim has to run again after it.
		// 255 bytes of `a` then a dot: capping to 255 keeps the run, but at 254 the dot is
		// the last surviving character.
		const out = sanitizeFolder(`${'a'.repeat(254)}.${'b'.repeat(50)}`).folder;
		expect(out.endsWith('.')).toBe(false);
		expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(255);
	});

	it('PRESERVES the orthographic joiners, which are letters, not formatting', () => {
		// Regression introduced by widening the forbidden class to a hand-listed range: it
		// swept in U+200C ZWNJ and U+200D ZWJ, which are part of ordinary words. A dash was
		// inserted into the middle of the user's own capture title.
		expect(sanitizeFolder('می‌روم').folder).toBe('می‌روم');
		expect(sanitizeFolder('می‌روم').changed).toBe(false);
		expect(sanitizeFilename('می‌روم', 'id1')).toBe('می‌روم.md');
		expect(sanitizeFilename('क्‍ष', 'id1')).toBe('क्‍ष.md');
		// A ZWJ emoji sequence is one glyph; splitting it changes what is displayed.
		expect(sanitizeFilename('👨‍👩‍👧 family', 'id1')).toBe('👨‍👩‍👧 family.md');
	});

	it('still rejects a name made ONLY of joiners, which renders as nothing', () => {
		// The hole the exception above opens: orthographic inside a word, but alone they are
		// a folder whose name looks empty in the file list.
		expect(sanitizeFolder('‌').folder).toBe('');
		expect(sanitizeFolder('‍‌').folder).toBe('');
		expect(sanitizeFolder('‌/notes').folder).toBe('notes');
		expect(sanitizeFilename('‌', 'id1')).toBe('riverbed-capture-id1.md');
	});

	it('rejects joiners plus DOTS, which the all-joiners test alone lets through', () => {
		// The first version of the guard ran before the trailing-dot trim, so joiners-plus-a-
		// dot passed it, then the dot was trimmed off and nothing looked again. `.‌.` became
		// a folder named `‌` and `‌.` became the file `‌.md`, whose entire visible name is
		// `.md`. Any guard on "what is left" has to run last.
		for (const input of [
			'.‌.',
			'‌..',
			'‌.',
			'‌.‌.',
			'‌. ',
			'x/‌.',
			// A space BETWEEN two joiners, which neither the leading nor the trailing strip
			// can reach, so an all-joiners test misses it and the folder displays as a space.
			'‌ ‌',
			'‍ ‍',
			' ‌ ‌ ',
			'x/‌ ‌',
		]) {
			const out = sanitizeFolder(input).folder;
			for (const segment of out === '' ? [] : out.split('/')) {
				expect(segment.replace(/[‌‍]/g, ''), `${JSON.stringify(input)} -> ${out}`).not.toBe('');
			}
		}
		expect(sanitizeFolder('.‌.').folder).toBe('');
		expect(sanitizeFolder('x/‌.').folder).toBe('x');
		expect(sanitizeFilename('‌.', 'id1')).toBe('riverbed-capture-id1.md');
		expect(sanitizeFilename('‌..', 'id1')).toBe('riverbed-capture-id1.md');
		expect(sanitizeFilename('‌ ‌', 'id1')).toBe('riverbed-capture-id1.md');
		expect(sanitizeFolder('‌ ‌').folder).toBe('');
	});

	it('is IDEMPOTENT, because runSync treats a second change as an upstream bug', () => {
		// runSync logs whenever sanitizeFolder changes something, on the stated assumption
		// that a folder reaching it was already cleaned upstream. A non-idempotent sanitize
		// makes that alarm fire on every poll forever for a value nothing is wrong with.
		for (const input of [
			'.‌.',
			'C/‌.',
			'../../notes',
			'/Users/me/.ssh',
			'C:\\Users\\me',
			'research/inbox',
			'con.' + 'a'.repeat(300),
			'.obsidian/plugins',
			'in box / notes',
		]) {
			const once = sanitizeFolder(input).folder;
			const twice = sanitizeFolder(once);
			expect(twice.folder, `${JSON.stringify(input)} -> ${once}`).toBe(once);
			expect(twice.changed, `${JSON.stringify(input)} -> ${once}`).toBe(false);
			expect(twice.escaped, `${JSON.stringify(input)} -> ${once}`).toBe(false);
		}
	});

	it('covers the WHOLE invisible class, not a hand-listed half of it', () => {
		// The enumeration that preceded this missed roughly half of the format characters,
		// so `​/etc` was reported as leaving the vault while `­/etc` was accepted
		// in silence and created a folder rendering blank. Each of these is outside the old
		// ranges and inside the property.
		for (const [name, ch] of [
			['soft hyphen U+00AD', '­'],
			['Mongolian vowel separator U+180E', '᠎'],
			['Arabic letter mark U+061C', '؜'],
			['Hangul choseong filler U+115F', 'ᅟ'],
			['Hangul filler U+3164', 'ㅤ'],
			['halfwidth Hangul filler U+FFA0', 'ﾠ'],
			['tag block U+E0001', '\u{e0001}'],
			['musical symbol U+1D173', '\u{1d173}'],
			// The joiners are PRESERVED in output but must still be invisible to the escape
			// checks, which ask what the user sees, not what survives sanitizing.
			['ZWNJ U+200C', '‌'],
			['ZWJ U+200D', '‍'],
		] as const) {
			expect(sanitizeFolder(ch).folder, name).toBe('');
			expect(sanitizeFolder(`${ch}/etc`).escaped, name).toBe(true);
			expect(sanitizeFolder(`${ch}../x`).escaped, name).toBe(true);
			expect(sanitizeFilename(ch.repeat(3), 'id1'), name).toBe('riverbed-capture-id1.md');
		}
	});

	it('strips zero-width characters, which render as nothing at all', () => {
		// A folder named only of these is created in the vault with a name that looks empty,
		// and `changed` was false so the user was never even told.
		for (const invisible of ['​', '⁠', '‎']) {
			const out = sanitizeFolder(invisible);
			expect(out.folder, JSON.stringify(invisible)).toBe('');
			expect(out.changed, JSON.stringify(invisible)).toBe(true);
		}
		// U+FEFF is the exception, and only because JS counts it as whitespace: `trim()`
		// removes it up front, so it reads as an empty field rather than as a correction.
		// That matches typing spaces, which also selects the vault root without a notice.
		expect(sanitizeFolder('﻿')).toEqual({ folder: '', escaped: false, changed: false });
		expect(sanitizeFolder('in​box').folder).toBe('in-box');
		expect(sanitizeFilename('a​b', 'id1')).toBe('a-b.md');
		// U+2800 is braille blank, a real character, and deliberately left alone.
		expect(sanitizeFolder('⠀').folder).toBe('⠀');
	});

	it('survives a non-string persisted into data.json', () => {
		// Object.assign in loadSettings copies whatever is in the file; a number would throw
		// on .normalize and take the whole sync pass down.
		expect(sanitizeFolder(undefined as unknown as string).folder).toBe('');
		expect(sanitizeFolder(42 as unknown as string).folder).toBe('');
		expect(sanitizeFolder(null as unknown as string).folder).toBe('');
	});
});

describe('folderNotice', () => {
	// The settings tab cannot be loaded by vitest (the `obsidian` package is types only, with
	// no runtime entry), so this decision lives here instead of inline in the blur handler.
	// Two defects have already reached production through a clean attended GUI pass.

	it('says nothing when the folder was accepted as typed', () => {
		expect(folderNotice(sanitizeFolder('inbox'))).toBeNull();
		expect(folderNotice(sanitizeFolder('research/inbox'))).toBeNull();
		// Cleared to the vault root on purpose, which is a legitimate choice, not a mistake.
		expect(folderNotice(sanitizeFolder(''))).toBeNull();
		// Separator tidying alone is not worth interrupting anyone for.
		expect(folderNotice(sanitizeFolder('inbox/'))).toBeNull();
	});

	it('names the vault when the folder tried to leave it', () => {
		expect(folderNotice(sanitizeFolder('../../notes'))).toBe(
			'Riverbed: the destination folder cannot leave your vault. Using "notes".',
		);
		expect(folderNotice(sanitizeFolder('/Users/me/notes'))).toBe(
			'Riverbed: the destination folder cannot leave your vault. Using "Users/me/notes".',
		);
	});

	it('falls back to the root wording when nothing usable is left', () => {
		expect(folderNotice(sanitizeFolder('..'))).toBe(
			'Riverbed: the destination folder cannot leave your vault. Writing captures to the vault root.',
		);
		expect(folderNotice(sanitizeFolder('...'))).toBe(
			'Riverbed: that destination folder is not usable as typed. Writing captures to the vault root.',
		);
	});

	it('uses the milder wording for a correction that was not an escape', () => {
		expect(folderNotice(sanitizeFolder('.obsidian/plugins'))).toBe(
			'Riverbed: that destination folder is not usable as typed. Using "obsidian/plugins".',
		);
		expect(folderNotice(sanitizeFolder('CON'))).toBe(
			'Riverbed: that destination folder is not usable as typed. Using "riverbed-CON".',
		);
	});

	it('never uses an em-dash, which is a repo-wide rule for user-facing copy', () => {
		for (const input of ['../../notes', '..', '.obsidian', 'CON', '/etc', '...']) {
			expect(folderNotice(sanitizeFolder(input)) ?? '').not.toContain('—');
		}
	});
});
