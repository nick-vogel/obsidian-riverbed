import { configDefaults, defineConfig } from 'vitest/config'

// tests/repro/** is excluded from the default run on purpose: it drives the REAL outbox
// client against a live server and needs one running, plus an `obsidian` alias the default
// config does not provide. Run it with its own config:
//   pnpm exec vitest run --config tests/repro/vitest.repro.config.ts
//
// Spread the defaults rather than replacing them — a bare array silently drops
// **/dist/**, **/.git/** and the config-file patterns, which bites the first time a build
// output directory appears.
export default defineConfig({
	test: { exclude: [...configDefaults.exclude, 'tests/repro/**'] },
})
