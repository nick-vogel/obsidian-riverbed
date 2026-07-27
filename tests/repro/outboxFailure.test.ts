import { describe, expect, it } from 'vitest'
import { HttpOutboxGateway } from '../../src/outboxClient'
import { SyncRunner } from '../../src/sync/runSync'
import type { SyncVault } from '../../src/sync/types'

const BASE = process.env.RIVERBED_BASE ?? 'http://localhost:3500'
const TOKEN = process.env.OUTBOX_TOKEN ?? ''

// A vault whose write ALWAYS fails, which is the whole point: it forces the sync
// pass down its failure branch so the error-report path runs for real.
const throwingVault = (message: string): SyncVault => ({
	exists: async () => false,
	read: async () => '',
	create: async () => {
		throw new Error(message)
	},
	createFolder: async () => {},
})

describe('outbox failure reporting, against a live server', () => {
	it('records a reason when the write fails with a normal Error', async () => {
		const outbox = new HttpOutboxGateway(
			() => BASE,
			() => TOKEN,
		)
		const logs: string[] = []
		const runner = new SyncRunner()
		const result = await runner.run({
			vault: throwingVault('disk on fire'),
			outbox,
			folder: 'Repro',
			log: (m) => logs.push(m),
		})
		console.log('RESULT', JSON.stringify(result), 'LOGS', JSON.stringify(logs))
		expect(result?.failed).toBeGreaterThan(0)
	})
})

describe('an entry with NO suggestedFilename, against a live server', () => {
	it('now delivers and acks instead of being rejected forever', async () => {
		const outbox = new HttpOutboxGateway(
			() => BASE,
			() => TOKEN,
		)
		const written: string[] = []
		const runner = new SyncRunner()
		const result = await runner.run({
			vault: {
				exists: async () => false,
				read: async () => '',
				create: async (path: string) => {
					written.push(path)
				},
				createFolder: async () => {},
			},
			outbox,
			folder: 'Repro',
			log: () => {},
		})
		console.log('DELIVERY', JSON.stringify(result), 'WROTE', JSON.stringify(written))
		expect(result?.delivered).toBeGreaterThan(0)
	})
})
