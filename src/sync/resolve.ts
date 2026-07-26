import { SyncVault } from './types';

/**
 * Upper bound on suffix iteration. A pathological folder must fail the entry (which is
 * then reported and retried later) rather than spin forever inside a sync pass.
 */
export const MAX_SUFFIX_ATTEMPTS = 100;

export interface Resolution {
	/** `write` = create the file at `path`; `skip-and-ack` = identical bytes already there. */
	action: 'write' | 'skip-and-ack';
	path: string;
}

export function joinPath(folder: string, filename: string): string {
	const clean = folder.replace(/^\/+|\/+$/g, '');
	return clean === '' ? filename : `${clean}/${filename}`;
}

function withSuffix(filename: string, n: number): string {
	const dot = filename.lastIndexOf('.');
	if (dot <= 0) return `${filename}-${n}`;
	return `${filename.slice(0, dot)}-${n}${filename.slice(dot)}`;
}

/**
 * Decide where an entry's markdown should go, without destroying anything already there.
 *
 * Identical bytes at the target are treated as already-delivered rather than as a
 * collision: that is what makes a crash (or a dropped ack) between write and ack
 * recoverable on the next pass instead of producing an endless trail of `-2` duplicates.
 *
 * @throws when every slot up to MAX_SUFFIX_ATTEMPTS is occupied by different content.
 */
export async function resolveTarget(
	vault: SyncVault,
	folder: string,
	filename: string,
	contents: string,
): Promise<Resolution> {
	for (let attempt = 1; attempt <= MAX_SUFFIX_ATTEMPTS; attempt++) {
		const candidate = joinPath(folder, attempt === 1 ? filename : withSuffix(filename, attempt));
		if (!(await vault.exists(candidate))) {
			return { action: 'write', path: candidate };
		}
		if ((await vault.read(candidate)) === contents) {
			return { action: 'skip-and-ack', path: candidate };
		}
		// Occupied by different content: try the next suffix.
	}
	throw new Error(
		`no free filename for "${filename}" after ${MAX_SUFFIX_ATTEMPTS} attempts in "${folder}"`,
	);
}
