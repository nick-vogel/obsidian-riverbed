// Filename sanitization. `suggestedFilename` is treated as untrusted input: the outbox
// contract promises a plain filename with no path separators, but a buggy or hostile
// server must not be able to write outside the destination folder.

/** Characters Obsidian forbids in a filename, plus control characters and DEL. */
const FORBIDDEN = new RegExp('[*"\\\\/<>:|?\\u0000-\\u001f\\u007f]', 'g');

/**
 * Reduce a server-supplied name to a bare, safe, `.md` filename.
 *
 * Guarantees on the result: non-empty, contains no `/` or `\`, contains no `..` segment,
 * does not start with a dot, and ends in `.md`.
 *
 * @param name the entry's `suggestedFilename`
 * @param fallbackId the entry id, used to name a capture whose filename sanitizes away
 */
export function sanitizeFilename(name: string, fallbackId: string): string {
	let out = (name ?? '').trim();

	// Forbidden characters (path separators among them) become a dash, so a traversal
	// attempt degrades into an ordinary flat name rather than escaping the folder.
	out = out.replace(FORBIDDEN, '-');

	// Collapse any run of dots, which removes every `..` segment while leaving a single
	// extension dot intact.
	out = out.replace(/\.{2,}/g, '.');

	// A leading dot would make the note hidden on disk; leading dashes and space are noise.
	out = out.replace(/^[.\-\s]+/, '').trim();

	// Trailing dots and spaces go too. Without this a name like `note.` becomes `note..md`,
	// which breaks this function's own documented "no `..` segment" guarantee (and the
	// safety predicate the tests assert with). Windows also silently strips a trailing dot
	// or space from a filename, so leaving them makes the written name differ from the
	// requested one on that platform.
	out = out.replace(/[.\s]+$/, '');

	// Nothing meaningful survived (an empty, all-dots, or all-forbidden name).
	if (out === '') {
		return `riverbed-capture-${fallbackId}.md`;
	}

	// Cap the stem so a long feed title cannot exceed the filesystem's per-component limit
	// (255 bytes on APFS and ext4). Uncapped, the write throws ENAMETOOLONG on every pass:
	// the entry is never acked, is re-reported on each poll, and is stranded in the user's
	// outbox permanently. Budget is in BYTES, since a title in a non-Latin script costs up
	// to 4 bytes per character.
	out = capBytes(out, MAX_STEM_BYTES).replace(/[.\s]+$/, '');
	if (out === '') {
		return `riverbed-capture-${fallbackId}.md`;
	}

	if (!out.toLowerCase().endsWith('.md')) {
		out = `${out}.md`;
	}

	return out;
}

/** Leaves room for the `.md` extension and a `-NN` collision suffix inside 255 bytes. */
const MAX_STEM_BYTES = 200;

/** Truncate to at most `max` UTF-8 bytes without splitting a character. */
function capBytes(value: string, max: number): string {
	const encoder = new TextEncoder();
	if (encoder.encode(value).length <= max) return value;
	let out = value;
	// Drop whole code points from the end; slicing by byte could split a multi-byte
	// character and produce a replacement char in the filename.
	while (out.length > 0 && encoder.encode(out).length > max) {
		out = out.slice(0, -1);
	}
	return out;
}
