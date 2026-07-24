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

	// Nothing meaningful survived (an empty, all-dots, or all-forbidden name).
	if (out === '') {
		return `riverbed-capture-${fallbackId}.md`;
	}

	if (!out.toLowerCase().endsWith('.md')) {
		out = `${out}.md`;
	}

	return out;
}
