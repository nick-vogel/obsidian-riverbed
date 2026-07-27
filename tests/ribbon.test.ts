import { describe, expect, it } from 'vitest';
import {
	RIBBON_BASELINES,
	RIBBON_STROKE,
	RIBBON_SVG,
	RIBBON_VIEWBOX,
	RIBBON_X,
	waveSpan,
} from '../src/ribbon';

/** Pull every `M x y ... T x1 y1` back out of the emitted markup. */
function baselinesInSvg(svg: string): number[] {
	return [...svg.matchAll(/M\d+ (\d+) Q/g)].map((m) => Number(m[1]));
}

describe('ribbon glyph geometry', () => {
	it('FITS the viewBox, cap and overshoot included', () => {
		// The defect this exists for: rescaling the brand mark proportionally put the bottom
		// wave's span at [87, 105] in a 100-unit box. Obsidian's custom-icon wrapper carries
		// only a viewBox, so the UA default `overflow: hidden` sliced the wave flat, and at
		// 18px in a ribbon that reads as a slightly odd shape rather than as a bug.
		for (const baseline of RIBBON_BASELINES) {
			const [top, bottom] = waveSpan(baseline);
			expect(top, `baseline ${baseline} top`).toBeGreaterThanOrEqual(0);
			expect(bottom, `baseline ${baseline} bottom`).toBeLessThanOrEqual(RIBBON_VIEWBOX);
		}
	});

	it('fits horizontally too, round caps included', () => {
		const half = RIBBON_STROKE / 2;
		expect(RIBBON_X.start - half).toBeGreaterThanOrEqual(0);
		expect(RIBBON_X.end + half).toBeLessThanOrEqual(RIBBON_VIEWBOX);
	});

	it('accounts for the T reflection, not just the explicit control point', () => {
		// `T` mirrors the previous control point through the midpoint, so a wave dips BELOW
		// its baseline by as much as it rose above it. Measuring only the `Q` half is how the
		// overshoot got missed: it makes a wave look 5 units shorter than it is.
		const [top, bottom] = waveSpan(50, 0);
		expect(top).toBe(45);
		expect(bottom).toBe(55);
		// With the real stroke the cap adds half a width at each end.
		expect(waveSpan(50)).toEqual([41, 59]);
	});

	it('is vertically centred, with equal margins', () => {
		const spans = RIBBON_BASELINES.map((b) => waveSpan(b));
		const top = Math.min(...spans.map((s) => s[0]));
		const bottom = Math.max(...spans.map((s) => s[1]));
		expect(top).toBe(RIBBON_VIEWBOX - bottom);
	});

	it('spaces the waves evenly', () => {
		const gaps = RIBBON_BASELINES.slice(1).map((b, i) => b - RIBBON_BASELINES[i]);
		expect(new Set(gaps).size).toBe(1);
	});

	it('emits one stroked path per baseline, themed by currentColor', () => {
		const paths = RIBBON_SVG.match(/<path /g) ?? [];
		expect(paths).toHaveLength(RIBBON_BASELINES.length);
		expect(baselinesInSvg(RIBBON_SVG)).toEqual([...RIBBON_BASELINES]);

		// All three are required. Obsidian's CUSTOM-icon wrapper supplies only a viewBox,
		// unlike its Lucide wrapper, so a path without these renders as a black fill that
		// ignores the theme entirely.
		for (const attr of ['fill="none"', 'stroke="currentColor"', 'stroke-linecap="round"']) {
			expect((RIBBON_SVG.match(new RegExp(attr.replace(/"/g, '"'), 'g')) ?? []).length).toBe(
				RIBBON_BASELINES.length,
			);
		}
		// No hard-coded colour anywhere, or it stops following light/dark.
		expect(RIBBON_SVG).not.toMatch(/#[0-9a-f]{3,8}/i);
		// And no wrapping <svg>: Obsidian supplies it, and a nested one renders nothing.
		expect(RIBBON_SVG).not.toContain('<svg');
	});
});
