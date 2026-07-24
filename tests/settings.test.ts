import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, RiverbedSettings, isConfigured } from '../src/settings';

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
