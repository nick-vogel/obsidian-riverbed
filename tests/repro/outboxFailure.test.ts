import { beforeAll, describe, expect, it } from 'vitest'
import { HttpOutboxGateway } from '../../src/outboxClient'
import { SyncRunner } from '../../src/sync/runSync'
import type { SyncVault } from '../../src/sync/types'

// Live-server tests for the outbox client, which no other test in this repo touches.
//
// DANGER, and the reason for the guard below: a sync pass ACKS every entry it delivers,
// and an acked entry never reappears in the outbox. These tests use a vault that does not
// actually write anything, so pointing them at a real instance would consume every pending
// capture and throw it away, unrecoverably. An earlier version of this file had no guard
// and documented itself with a `RIVERBED_BASE=` example, which is exactly how that happens.
//
// So: localhost only, and every entry these tests act on is one they created themselves.
const BASE = process.env.RIVERBED_BASE ?? 'http://localhost:3500'
const TOKEN = process.env.OUTBOX_TOKEN ?? ''
const ADMIN = {
  email: process.env.ADMIN_EMAIL ?? 'matrix-admin@riverbed.test',
  password: process.env.ADMIN_PASSWORD ?? 'matrix-admin-pw-1',
}

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)
if (!isLocal) {
  throw new Error(
    `Refusing to run against ${BASE}. These tests ACK entries without writing them, which ` +
      `destroys pending captures. Point RIVERBED_BASE at localhost.`,
  )
}

const api = async (method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `JWT ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

/** Collects only the ids this run created, so nothing else can be acked by accident. */
let seeded: string[] = []
let adminToken = ''

const seedSaveWithoutFilename = async (suffix: string) => {
  const stamp = Date.now()
  const feed = (
    await api('POST', '/feeds', {
      token: adminToken,
      body: {
        canonicalUrl: `repro-${stamp}-${suffix}.invalid/f`,
        url: `https://repro-${stamp}-${suffix}.invalid/f`,
        title: 'Repro Feed',
      },
    })
  ).json?.doc?.id
  const item = (
    await api('POST', '/items', {
      token: adminToken,
      body: {
        feed,
        guidHash: `repro-${stamp}-${suffix}`,
        title: `Repro article ${suffix}`,
        url: `https://repro-${stamp}-${suffix}.invalid/a`,
        extractionStatus: 'ok',
        extractedHtml: '<p>Body.</p>',
        publishedAt: new Date().toISOString(),
      },
    })
  ).json?.doc?.id
  const me = (await api('GET', '/users/me', { token: adminToken })).json?.user
  // Created through the PAYLOAD REST API on purpose, NOT /app-save. That is the real-world
  // path that produces a save with no `suggestedFilename` — app-save.ts is the only writer
  // of that column, and it has no default.
  const save = (
    await api('POST', '/saves', {
      token: adminToken,
      body: { item, user: me?.id, why: `repro ${suffix}` },
    })
  ).json?.doc
  seeded.push(String(save?.id))
  return String(save?.id)
}

const outboxEntry = async (id: string) => {
  const res = await fetch(`${BASE}/app-outbox`, { headers: { Authorization: `Token ${TOKEN}` } })
  const body = (await res.json()) as { items?: Array<Record<string, unknown>> }
  return (body.items ?? []).find((i) => String(i.id) === id)
}

/** Runs a pass restricted to ONE entry, so no unrelated capture is ever acked. */
const syncOnly = async (id: string, vault: SyncVault, log?: (m: string) => void) => {
  const live = new HttpOutboxGateway(
    () => BASE,
    () => TOKEN,
  )
  const scoped = {
    getPending: async () => (await live.getPending()).filter((i) => String(i.id) === id),
    ack: (ackId: string) => live.ack(ackId),
    reportError: (errId: string, reason: string) => live.reportError(errId, reason),
  }
  return new SyncRunner().run({ vault, outbox: scoped, folder: 'Repro', log })
}

beforeAll(async () => {
  adminToken =
    (await api('POST', '/users/login', { body: ADMIN })).json?.token ??
    (await api('POST', '/users/first-register', { body: { ...ADMIN, name: 'Matrix Admin' } })).json?.token ??
    ''
  expect(adminToken, 'could not authenticate against the local instance').toBeTruthy()
  expect(TOKEN, 'OUTBOX_TOKEN is required').toBeTruthy()
})

describe('outbox failure reporting, against a live server', () => {
  it('records the reason when the vault write fails', async () => {
    const id = await seedSaveWithoutFilename('fail')
    const logs: string[] = []
    const result = await syncOnly(
      id,
      {
        exists: async () => false,
        read: async () => '',
        create: async () => {
          throw new Error('disk on fire')
        },
        createFolder: async () => {},
      },
      (m) => logs.push(m),
    )
    expect(result?.failed).toBe(1)
    // The server recorded it, which is what makes the reader able to show it.
    const after = (await api('GET', `/saves/${id}`, { token: adminToken })).json
    expect(after?.syncError).toBe('disk on fire')
  })
})

describe('an entry with NO suggestedFilename, against a live server', () => {
  it('is served by the API with no filename, and still delivers', async () => {
    const id = await seedSaveWithoutFilename('nofilename')

    // The precondition IS the point: without it this passes on any ordinary entry, and
    // proves nothing about the fix.
    const entry = await outboxEntry(id)
    expect(entry, 'the seeded save is in the outbox').toBeTruthy()
    expect(typeof entry?.suggestedFilename).not.toBe('string')

    const written: string[] = []
    const result = await syncOnly(id, {
      exists: async () => false,
      read: async () => '',
      create: async (path: string) => {
        written.push(path)
      },
      createFolder: async () => {},
    })

    expect(result?.delivered).toBe(1)
    expect(written).toHaveLength(1)
    // Named from the entry id by sanitizeFilename's fallback, and a single flat component.
    expect(written[0]).toBe(`Repro/riverbed-capture-${id}.md`)
  })
})
