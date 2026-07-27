import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// `obsidian` ships types only, so it cannot be imported at runtime. Aliasing it to a
// faithful shim is what lets the REAL OutboxClient be exercised against a live server.
export default defineConfig({
	resolve: { alias: { obsidian: resolve(__dirname, 'obsidianShim.ts') } },
	test: { include: ['tests/repro/**/*.test.ts'], testTimeout: 60000 },
})
