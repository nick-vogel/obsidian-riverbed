# obsidian-riverbed

Obsidian companion plugin for Riverbed (plugin id `riverbed`). It is the bridge client
for Riverbed's pull-based outbox API: it polls `GET /app-outbox` on the user's configured
instance, writes each pending capture's `renderedMarkdown` verbatim into the vault's
destination folder under its `suggestedFilename`, acks each entry only after a confirmed
write, and reports failed writes back through `POST /app-outbox/:id/error` so they surface
in the reader's Outbox view. The outbox contract is ground truth and lives in the
`riverbed` repo at `docs/outbox-api.md`; auth is `Authorization: Token <token>` (never
`Bearer`, never `JWT`). All HTTP goes through Obsidian's `requestUrl`.

Asana project: Riverbed
Second brain: /Users/nick/Library/Mobile Documents/iCloud~md~obsidian/Documents/Knowsmore/personal/riverbed
