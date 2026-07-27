// The ribbon glyph, kept out of main.ts so its geometry can be asserted.
//
// A drawing is not usually testable, but "does it fit inside its own viewBox" is arithmetic,
// and getting that wrong is exactly what happened: a proportional rescale of the brand mark
// put the bottom wave at y=105 in a 100-unit box, where the SVG's own overflow clip sliced it
// flat. Nothing in a test suite noticed, and at 18px in a ribbon it is easy to miss by eye.

/** Registered with Obsidian's `addIcon`, then referenced by name in `addRibbonIcon`. */
export const RIBBON_ICON = 'riverbed';

/** The viewBox Obsidian wraps a custom icon in. Not configurable; the glyph must fit it. */
export const RIBBON_VIEWBOX = 100;

/** Stroke weight. 8% of the box, against Lucide's 1.75/24 = 7.3%, so it sits with its peers. */
export const RIBBON_STROKE = 8;

/**
 * Wave baselines, evenly spaced and centred.
 *
 * Each wave swings 5 units either side of its baseline (see `waveSpan`), and the round cap
 * adds half the stroke, so a baseline needs 9 units of clearance. 20/50/80 leaves 11 at the
 * top and 11 at the bottom.
 */
export const RIBBON_BASELINES = [20, 50, 80] as const;

/** Horizontal extent of the stroke's centre line, before the round caps add half a stroke. */
export const RIBBON_X = { start: 8, mid: 50, end: 92 } as const;

/**
 * Vertical extent a single wave actually occupies, INCLUDING the round cap.
 *
 * The path is `M x0 y Q cx (y-10) mid y T x1 y`. A quadratic's extreme is at t=0.5, where the
 * point is `0.25*P0 + 0.5*C + 0.25*P2`, so the first half peaks 5 above the baseline. `T`
 * REFLECTS that control point through the midpoint, giving `y+10`, so the second half dips 5
 * below. That reflection is the part a proportional rescale silently gets wrong.
 */
export function waveSpan(baseline: number, stroke = RIBBON_STROKE): [number, number] {
	const half = stroke / 2;
	const up = 0.25 * baseline + 0.5 * (baseline - 10) + 0.25 * baseline;
	const down = 0.25 * baseline + 0.5 * (baseline + 10) + 0.25 * baseline;
	return [up - half, down + half];
}

function wave(baseline: number): string {
	const { start, mid, end } = RIBBON_X;
	const control = Math.round((start + mid) / 2) - 1;
	return (
		`<path d="M${start} ${baseline} Q ${control} ${baseline - 10} ${mid} ${baseline} ` +
		`T ${end} ${baseline}" fill="none" stroke="currentColor" ` +
		`stroke-width="${RIBBON_STROKE}" stroke-linecap="round"/>`
	);
}

/**
 * The glyph's inner SVG.
 *
 * `fill="none" stroke="currentColor"` are load-bearing, not decoration: Obsidian wraps a
 * CUSTOM icon in an `<svg>` carrying only a viewBox, unlike its Lucide wrapper which supplies
 * stroke defaults. Without them the paths render as a black fill and ignore the theme.
 */
export const RIBBON_SVG = RIBBON_BASELINES.map(wave).join('\n');
