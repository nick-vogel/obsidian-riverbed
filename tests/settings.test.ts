import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SETTINGS,
	MAX_INTERVAL_MINUTES,
	RiverbedSettings,
	clampInterval,
	isConfigured,
} from '../src/settings';
import { normalizeBaseUrl } from '../src/url';

const withSettings = (overrides: Partial<RiverbedSettings>): RiverbedSettings => ({
	...DEFAULT_SETTINGS,
	...overrides,
});

describe('isConfigured', () => {
	it('is false for a fresh install, so enabling the plugin makes no network call', () => {
		// The regression this exists for: DEFAULT_SETTINGS ships a real baseUrl but an
		// empty token, and the startup pass used to fire anyway — an error on every
		// launch, and an empty-token request to the default host from every install
		// that was never set up.
		expect(isConfigured(DEFAULT_SETTINGS)).toBe(false);
	});

	it('is false when the token is missing or only whitespace', () => {
		expect(isConfigured(withSettings({ token: '' }))).toBe(false);
		expect(isConfigured(withSettings({ token: '   ' }))).toBe(false);
	});

	it('is false when the base URL is missing or only whitespace', () => {
		expect(isConfigured(withSettings({ token: 'tok', baseUrl: '' }))).toBe(false);
		expect(isConfigured(withSettings({ token: 'tok', baseUrl: '  ' }))).toBe(false);
	});

	it('is true once both are present', () => {
		expect(isConfigured(withSettings({ baseUrl: 'http://localhost:3000', token: 'tok' }))).toBe(true);
	});

	it('does not validate — a present but wrong value still counts as configured', () => {
		// Deliberate: a bad URL or a revoked token must surface as a visible connection
		// failure, not a silent skip that looks identical to "never set up".
		expect(isConfigured(withSettings({ baseUrl: 'not-a-url', token: 'revoked' }))).toBe(true);
	});
});

describe('clampInterval', () => {
	it('raises a sub-floor value to the floor', () => {
		expect(clampInterval(1, 5)).toBe(5);
		expect(clampInterval(0, 5)).toBe(5);
		expect(clampInterval(-30, 5)).toBe(5);
	});

	it('leaves a legal value alone', () => {
		expect(clampInterval(7, 5)).toBe(7);
		expect(clampInterval(5, 5)).toBe(5);
	});

	it('falls back to the (clamped) default on a non-finite value', () => {
		// The regression this guards: a corrupted or hand-edited data.json whose
		// intervalMinutes is not a number. Propagating NaN into window.setInterval is
		// specified to coerce to 0ms, which would fire a sync pass on every event-loop
		// turn and hammer the user's server.
		expect(clampInterval(NaN, 5)).toBe(DEFAULT_SETTINGS.intervalMinutes);
		expect(clampInterval(Number('every 15 min'), 5)).toBe(DEFAULT_SETTINGS.intervalMinutes);
		// Infinity is non-finite too and takes the same fallback — correctly, since an
		// infinite interval would mean the plugin never syncs again.
		expect(clampInterval(Infinity, 5)).toBe(DEFAULT_SETTINGS.intervalMinutes);
	});

	it('caps an absurdly large interval below the setInterval overflow point', () => {
		// setInterval's delay is a 32-bit int (2^31-1 ms, about 35,791 minutes). Past it the
		// delay overflows and the timer fires CONTINUOUSLY rather than never, so a user who
		// typed a huge number to mean "basically never" would hammer their own server.
		expect(clampInterval(999_999, 5)).toBe(MAX_INTERVAL_MINUTES);
		expect(clampInterval(MAX_INTERVAL_MINUTES + 1, 5)).toBe(MAX_INTERVAL_MINUTES);
		expect(MAX_INTERVAL_MINUTES * 60_000).toBeLessThan(2 ** 31 - 1);
	});

	it('leaves a large-but-legal interval alone', () => {
		expect(clampInterval(1440, 5)).toBe(1440);
	});

	it('clamps the fallback itself when the floor exceeds the default', () => {
		expect(clampInterval(NaN, 60)).toBe(60);
	});
});

describe('normalizeBaseUrl', () => {
	it('strips trailing slashes so the joined path is not double-slashed', () => {
		expect(normalizeBaseUrl('https://host/')).toBe('https://host');
		expect(normalizeBaseUrl('https://host///')).toBe('https://host');
	});

	it('trims surrounding whitespace (pasted URLs carry it)', () => {
		expect(normalizeBaseUrl('  https://host  ')).toBe('https://host');
		expect(normalizeBaseUrl(' https://host/ ')).toBe('https://host');
	});

	it('leaves a clean URL untouched, path included', () => {
		expect(normalizeBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
		expect(normalizeBaseUrl('https://host/riverbed')).toBe('https://host/riverbed');
	});
});
