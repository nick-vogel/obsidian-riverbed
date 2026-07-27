// Filename and destination-folder sanitization. `suggestedFilename` is treated as untrusted
// input: the outbox contract promises a plain filename with no path separators, but a buggy
// or hostile server must not be able to write outside the destination folder. The folder is
// user input rather than server input, so it is self-harm rather than an attack surface, but
// README.md promises the plugin never writes outside the destination folder and a typed
// `../../notes` broke that promise outright.

/**
 * Characters that contribute nothing a reader can see, defined BY PROPERTY rather than by
 * a hand-listed set of ranges.
 *
 * `\p{Cc}` is the control characters, `\p{Cf}` the format characters: the bidi overrides
 * and isolates, the zero-width spaces and joiners, the soft hyphen, the Arabic letter mark,
 * the BOM, the astral tag block. The hand-listed ranges this replaces covered roughly half
 * of them, which meant `​/etc` was reported as an attempt to leave the vault while
 * `­/etc` was silently accepted and created a folder whose name rendered blank. A
 * property is the whole class by construction; an enumeration is whatever was thought of.
 *
 * Added explicitly: the Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), which are
 * `Lo`, not format characters, but still render as nothing.
 *
 * EXCLUDED, deliberately, and this is the important part: U+200C ZWNJ and U+200D ZWJ are
 * `Cf` but are ORTHOGRAPHIC, not formatting artifacts. ZWNJ separates letters in Persian
 * (`می‌روم`), ZWJ forms conjuncts in Devanagari and binds emoji sequences (`👨‍👩‍👧`).
 * Treating them as forbidden inserted a `-` into the middle of an ordinary word in a user's
 * own capture title. Variation selectors are `Mn` and so were never in scope, which is the
 * right answer for the same reason.
 *
 * U+2800 (braille pattern blank) is `So` and likewise stays: it renders blank but is a real
 * character in braille text.
 */
const INVISIBLE_CLASS = '\\p{Cc}\\p{Cf}\\u115f\\u1160\\u3164\\uffa0';

/** The orthographic joiners that must survive both classes below. */
const JOINERS = '(?![\\u200c\\u200d])';

/**
 * A name with nothing in it that renders: empty, or only joiners and whitespace.
 *
 * Keeping ZWNJ and ZWJ opens a small hole the other invisibles do not have. They are
 * orthographic INSIDE a word, but a name built only from them shows up blank in the file
 * list. Every other invisible is already a `-` by the time this runs (FORBIDDEN replaces
 * rather than deletes), so joiners and whitespace are the only things left that can occupy
 * a name without showing anything.
 *
 * Whitespace has to be in here, not just the joiners: the leading and trailing strips
 * cannot reach a space sitting BETWEEN two joiners, so `‌ ‌` survived an
 * all-joiners test and became a folder whose name displays as a single space.
 */
const RENDERS_BLANK = /^[‌‍\s]*$/u;

/**
 * Characters Obsidian forbids in a filename, plus everything invisible.
 *
 * Built from the same class as INVISIBLE so the two cannot drift apart. They did not drift
 * yet, but they were two separate literals, and the next range added to one and not the
 * other would silently reopen the asymmetry that `visible()` exists to close.
 */
const FORBIDDEN = new RegExp(`${JOINERS}[*"\\\\/<>:|?${INVISIBLE_CLASS}]`, 'gu');

/**
 * Windows reserved device names. These are not legal filenames on Windows with ANY
 * extension (`CON.md` is as invalid as `CON`), and `isDesktopOnly` is false, so a capture
 * titled "Con" or "Aux" would fail to write on every pass and be stranded in the outbox
 * forever. Prefixing sidesteps it without mangling anything else.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Prefix that defuses a reserved device name. Its length is budgeted against the byte cap. */
const RESERVED_PREFIX = 'riverbed-';

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
	// NFC FIRST, because the byte cap below must measure the bytes that actually reach the
	// filesystem. `normalizePath` applies NFC on the way to the write, and NFC can GROW a
	// string (U+0344 doubles; the musical symbols U+1D160-U+1D164 triple), so budgeting on
	// the pre-NFC form let a 203-byte name land as 603 bytes, over the 255-byte component
	// limit and back into the ENAMETOOLONG stranding this cap exists to prevent.
	let out = (name ?? '').normalize('NFC').trim();

	// Forbidden characters (path separators among them) become a dash, so a traversal
	// attempt degrades into an ordinary flat name rather than escaping the folder.
	out = out.replace(FORBIDDEN, '-');

	// Collapse any run of dots, which removes every `..` segment while leaving a single
	// extension dot intact.
	out = out.replace(/\.{2,}/g, '.');

	// A leading dot would make the note hidden on disk; leading dashes and space are noise.
	out = out.replace(/^[.\-\s]+/, '').trim();

	// Cap the stem so a long feed title cannot exceed the filesystem's per-component limit
	// (255 bytes on APFS and ext4). Uncapped, the write throws ENAMETOOLONG on every pass:
	// the entry is never acked, is re-reported on each poll, and is stranded in the user's
	// outbox permanently. Budget is in BYTES, since a title in a non-Latin script costs up
	// to 4 bytes per character.
	//
	// Trailing dots and spaces go afterwards, ONCE. Without this a name like `note.` becomes
	// `note..md`, breaking this function's own "no `..`" guarantee, and Windows silently
	// strips a trailing dot or space so the written name would differ from the requested one.
	// A second copy before the cap is provably dead: the trim only ever removes a suffix and
	// the cap only ever truncates one, so trimming twice equals trimming once.
	out = capBytes(out, MAX_STEM_BYTES).replace(/[.\s]+$/, '');

	// ONE emptiness test, and it runs AFTER every transformation above.
	//
	// Checking before the trailing trim instead is how `‌.` reached disk as `‌.md`, a file
	// whose entire visible name is `.md`: joiners-plus-a-dot passes an all-joiners test, then
	// the dot is trimmed away and nothing looks again. Any guard on "what is left" has to be
	// the last thing that runs, or it is answering a question about an intermediate value.
	if (RENDERS_BLANK.test(out)) {
		return fallbackName(fallbackId);
	}

	if (!out.toLowerCase().endsWith('.md')) {
		out = `${out}.md`;
	}

	// Windows resolves a device name from the segment before the FIRST dot, and ignores
	// trailing spaces on it: `CON.txt.md` and `CON .md` both still hit the device, so
	// checking only the stem before `.md` would let them through.
	if (WINDOWS_RESERVED.test(out.split('.')[0].trimEnd())) {
		out = `${RESERVED_PREFIX}${out}`;
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
				.normalize('NFC')
				.replace(FORBIDDEN, '-')
				// Dots go entirely: no `..` segment can survive, and none is wanted in an id.
				.replace(/\./g, '-')
				.replace(/^[.\-\s]+|[.\s]+$/g, ''),
			64,
		) || 'unknown';
	return `riverbed-capture-${safeId}.md`;
}

/**
 * Leaves room for the `.md` extension, a `-NN` collision suffix, and the reserved-name
 * prefix inside 255 bytes. 200 + 9 + 3 + 3 is comfortably under, which is why the filename
 * path can prefix after capping where the folder path (which spends the full budget) cannot.
 */
const MAX_STEM_BYTES = 200;

/**
 * Per-component filesystem limit (255 bytes on APFS and ext4). A folder segment needs no
 * room for an extension or a collision suffix, so it gets the whole budget. Uncapped, an
 * over-long segment fails `createFolder` and then every write, on every pass, forever.
 */
const MAX_FOLDER_SEGMENT_BYTES = 255;

/** A Windows drive prefix as its own path segment, e.g. the `C:` of `C:\Users\me`. */
const DRIVE_PREFIX = /^[A-Za-z]:$/;

/**
 * Everything that renders as nothing, removed before an input is COMPARED against `..`,
 * `/` or a drive letter.
 *
 * Without it, `\u200b..` is not equal to `..` and so is not flagged as a traversal, even
 * though the zero-width space is stripped moments later and the segment WAS one. `trim()`
 * does not cover it: JS whitespace includes U+3000 and U+FEFF but not U+200B or U+2060.
 *
 * Unlike FORBIDDEN this does NOT exempt the joiners, and the difference is the point. The
 * joiners are preserved in OUTPUT because they are orthographic, but `\u200c/etc` still reads
 * as `/etc` to the person who typed it, so for the purpose of deciding what they asked for
 * it has to be invisible here too. Comparison and output are different questions.
 */
const INVISIBLE = new RegExp(`[${INVISIBLE_CLASS}]`, 'gu');

export interface FolderSanitizeResult {
	/** A vault-relative folder: no `..`, not absolute, `/`-separated, possibly empty (root). */
	folder: string;
	/** The input pointed outside the vault (a `..` segment, a leading separator, a drive). */
	escaped: boolean;
	/** The result differs from what was typed by more than separator tidying. */
	changed: boolean;
}

/**
 * Reduce a user-typed destination folder to a safe vault-relative path.
 *
 * Unlike `sanitizeFilename` this KEEPS `/` as a nesting separator, because nested
 * destination folders are supported (`research/inbox`). What it removes is the ability to
 * leave the vault: Obsidian's `normalizePath` does not resolve `..`, but the adapter joins
 * the result with the vault path and Node's `path.join` does, so a typed `../../notes`
 * wrote outside the vault entirely.
 *
 * `\` counts as a separator too. `normalizePath` folds it to `/` on the way to the write,
 * so treating it as an ordinary character here would let `..\..\notes` through the `..`
 * check and then have Obsidian turn it back into a traversal.
 */
export function sanitizeFolder(input: string): FolderSanitizeResult {
	// A hand-edited data.json can hold anything; a non-string would throw on `.normalize`.
	const trimmed = (typeof input === 'string' ? input : '').normalize('NFC').trim();

	// EVERY escape test runs against the VISIBLE form: invisibles removed, padding trimmed.
	// A zero-width space sitting inside `../x`, `/etc` or `C:\x` changes none of them as far
	// as the user's eyes are concerned, so all three checks have to agree with what is on
	// screen. Applying this to the `..` check alone is what let `\u200b/etc` be corrected
	// without ever being reported as an attempt to leave the vault.
	const visible = (value: string) => value.replace(INVISIBLE, '').trim();

	// An absolute path is an escape whatever its segments turn out to be.
	let escaped = /^[/\\]/.test(visible(trimmed));

	// Trim each segment HERE, before anything looks at it. Deciding `escaped` from a regex
	// over the raw string instead let a padded traversal (`.. /x`, `.. /x`) be stripped
	// without being flagged, so the folder was safe but the user got the wrong notice.
	const segments = trimmed.split(/[/\\]+/).map((segment) => segment.trim());

	// Drop the drive letter rather than sanitizing it into a folder literally named `C-`,
	// which is not a folder anyone meant to ask for.
	if (DRIVE_PREFIX.test(visible(segments[0] ?? ''))) {
		escaped = true;
		segments.shift();
	}

	const kept: string[] = [];
	for (const segment of segments) {
		// `..` is the hole itself, dropped whole rather than mangled into a folder named
		// `-`. This is ALSO the only place `escaped` is decided for a traversal, which is
		// deliberate: the dot-collapse and leading-dot-strip in `sanitizeSegment` would
		// each independently reduce a stray `..` to nothing, so without this line carrying
		// the flag no single-line regression in the traversal guard would fail a test.
		if (visible(segment) === '..') {
			escaped = true;
			continue;
		}
		const clean = sanitizeSegment(segment);
		if (clean !== '') kept.push(clean);
	}
	const folder = kept.join('/');

	// Compared against a separator-tidied baseline, not the raw input, so the notice this
	// drives stays quiet for harmless typing (`inbox/`, `a//b`, `a\b`, `in box / notes`)
	// and fires only when the value actually lost something.
	const baseline = segments.filter((segment) => segment !== '').join('/');
	return { folder, escaped, changed: folder !== baseline };
}

/**
 * The Notice text for a folder the user just typed, or null when nothing changed and there
 * is nothing worth telling them.
 *
 * Lives here rather than inline in the settings tab so it can be tested at all: the
 * `obsidian` package ships types only, with no runtime entry, so any module importing it
 * cannot be loaded by vitest. This repo has already shipped two defects that a full
 * attended pass of the GUI did not catch, so "it is only a string in a dialog" is not a
 * reason to leave logic where no test can reach it.
 */
export function folderNotice(result: FolderSanitizeResult): string | null {
	if (!result.escaped && !result.changed) return null;
	const where =
		result.folder === '' ? 'Writing captures to the vault root.' : `Using "${result.folder}".`;
	return result.escaped
		? `Riverbed: the destination folder cannot leave your vault. ${where}`
		: `Riverbed: that destination folder is not usable as typed. ${where}`;
}

/**
 * Sanitize ONE folder segment. Separators are already gone at this point, so the segment
 * gets the same forbidden-character treatment as a filename and the separators between
 * segments survive.
 *
 * Returns `''` for a segment that carries no meaning, which the caller then drops.
 */
function sanitizeSegment(segment: string): string {
	let out = segment.replace(FORBIDDEN, '-');
	out = out.replace(/\.{2,}/g, '.');
	// A leading dot hides the folder from Obsidian (and would let a typed `.obsidian`
	// aim captures at the config directory); leading dashes and spaces are noise.
	out = out.replace(/^[.\-\s]+/, '');

	// Same reasoning as in `sanitizeFilename`: a folder named `CON` cannot be created on
	// Windows and `isDesktopOnly` is false, so it would fail every write on every pass.
	// `trimEnd` here rather than a trailing trim above, because the only trailing trim that
	// survives mutation testing is the post-cap one and a second copy would be dead code.
	const reserved = WINDOWS_RESERVED.test(out.split('.')[0].trimEnd());

	// Budget the prefix BEFORE capping. Prefixing afterwards pushed a long reserved-name
	// segment to 264 bytes, past the very 255-byte component limit this cap exists to
	// respect, which strands every capture bound for that folder forever.
	out = capBytes(out, MAX_FOLDER_SEGMENT_BYTES - (reserved ? RESERVED_PREFIX.length : 0));
	// Trailing dots and spaces go last, which also catches any the cap just exposed. Windows
	// silently strips them from a name on disk, so leaving them makes the folder that gets
	// created differ from the one the settings field and the notice both display.
	out = out.replace(/[.\s]+$/, '');

	// ONE emptiness test, AFTER every transformation, for the reason spelled out in
	// `sanitizeFilename`: `.‌.` used to survive as a folder named `‌`, which renders as
	// nothing in the file list.
	if (RENDERS_BLANK.test(out)) return '';

	return reserved ? `${RESERVED_PREFIX}${out}` : out;
}

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
