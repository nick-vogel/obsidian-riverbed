// Filename sanitization. `suggestedFilename` is treated as untrusted input: the outbox
// contract promises a plain filename with no path separators, but a buggy or hostile
// server must not be able to write outside the destination folder.

/** Characters Obsidian forbids in a filename, plus control characters and DEL. */
const FORBIDDEN = new RegExp('[*"\\\\/<>:|?\\u0000-\\u001f\\u007f]', 'g');

/**
 * Windows reserved device names. These are not legal filenames on Windows with ANY
 * extension (`CON.md` is as invalid as `CON`), and `isDesktopOnly` is false, so a capture
 * titled "Con" or "Aux" would fail to write on every pass and be stranded in the outbox
 * forever. Prefixing sidesteps it without mangling anything else.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

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
		return fallbackName(fallbackId);
	}

	// Cap the stem so a long feed title cannot exceed the filesystem's per-component limit
	// (255 bytes on APFS and ext4). Uncapped, the write throws ENAMETOOLONG on every pass:
	// the entry is never acked, is re-reported on each poll, and is stranded in the user's
	// outbox permanently. Budget is in BYTES, since a title in a non-Latin script costs up
	// to 4 bytes per character.
	out = capBytes(out, MAX_STEM_BYTES).replace(/[.\s]+$/, '');
	if (out === '') {
		return fallbackName(fallbackId);
	}

	if (!out.toLowerCase().endsWith('.md')) {
		out = `${out}.md`;
	}

	// Windows resolves a device name from the segment before the FIRST dot, and ignores
	// trailing spaces on it: `CON.txt.md` and `CON .md` both still hit the device, so
	// checking only the stem before `.md` would let them through.
	if (WINDOWS_RESERVED.test(out.split('.')[0].trimEnd())) {
		out = `riverbed-${out}`;
	}

	return out;
}

/**
 * Name used when the server's `suggestedFilename` sanitizes away to nothing.
 *
 * The entry id is ALSO untrusted server input and gets the same treatment as the filename.
 * Interpolating it raw was an arbitrary-write hole: an id of `../../../../Users/me/.zshrc`
 * with an unusable filename produced `riverbed-capture-../../../../Users/me/.zshrc.md`, and
 * while Obsidian's `normalizePath` does not resolve `..`, the adapter joins with the vault
 * path and Node's `path.join` does, landing the write outside the vault entirely. An
 * unbounded id was the same permanent-stranding bug as an unbounded filename.
 */
function fallbackName(fallbackId: string): string {
	const safeId =
		capBytes(
			(fallbackId ?? '')
				.replace(FORBIDDEN, '-')
				// Dots go entirely: no `..` segment can survive, and none is wanted in an id.
				.replace(/\./g, '-')
				.replace(/^[.\-\s]+|[.\s]+$/g, ''),
			64,
		) || 'unknown';
	return `riverbed-capture-${safeId}.md`;
}

/** Leaves room for the `.md` extension and a `-NN` collision suffix inside 255 bytes. */
const MAX_STEM_BYTES = 200;

/**
 * Truncate to at most `max` UTF-8 bytes without splitting a character.
 *
 * Iterates CODE POINTS via `Array.from`, not `String.prototype.slice`. Slicing removes one
 * UTF-16 code unit, which halves a surrogate pair: an emoji at the boundary left a lone
 * high surrogate in the filename, written to disk as a replacement character.
 */
function capBytes(value: string, max: number): string {
	const encoder = new TextEncoder();
	if (encoder.encode(value).length <= max) return value;
	const points = Array.from(value);
	let bytes = 0;
	let kept = 0;
	for (const point of points) {
		const size = encoder.encode(point).length;
		if (bytes + size > max) break;
		bytes += size;
		kept++;
	}
	return points.slice(0, kept).join('');
}
