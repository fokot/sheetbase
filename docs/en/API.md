# API reference

Import from `@fokot/sheetbase` after installing from GitHub. Repository examples use `./dist/index.js`. The package is not published to the npm registry.

## `createSheetbase(options)`

| Option | Type / default | Meaning |
| --- | --- | --- |
| `accountId` | required `string` | Stable account identifier verified by your app; use Google's userinfo `sub`. |
| `storage` | required `Storage` | Local persistence adapter. |
| `remote` | required `Remote` | Remote adapter. |
| `namespace` | `string`, `sheetbase` | Part of the local table identity. |
| `autoSync` | `boolean`, `true` | Automatically send registered tables' queues. |
| `debounceMs` | `number`, `650` | Window for batching nearby writes. |
| `retry.attempts` | `number`, `4` | Maximum automatic attempts after a transient error. |
| `retry.baseDelayMs` | `number`, `1000` | Base exponential backoff delay. |
| `retry.maxDelayMs` | `number`, `30000` | Maximum backoff delay. |

`db.table(definition)` registers a table without calling Google. Registering the same identity with the same schema returns the existing instance; a different schema is rejected.

`db.sync()` sends all registered tables. `db.setOnline(boolean)` explicitly changes connectivity; the browser also supplies online/offline events. `db.pause()` suspends network work and invalidates in-flight context while retaining local editing. After reauthorization, call `db.resume()`. `db.dispose()` permanently closes the client. An HTTP request already sent may complete on Google; the closed client will not acknowledge it locally, and the next client will check its receipt.

## `db.table({ spreadsheetId, sheet, keyColumn, columns })`

The key is always in the first column. `keyColumn` names its header, not a physical address. Every nonempty key must be unique. Headers are case-insensitively unique.

```ts
const journal = db.table({
  spreadsheetId: 'existing-file-id',
  sheet: 'Journal', keyColumn: 'Date',
  columns: { pages: column.number('Pages') }
});
```

A resulting row is `{ key: string, values: { pages: number | null } }`. TypeScript infers values from the column definitions.

## Table methods

- `open({ create?: boolean, refresh?: boolean, cachedOnly?: boolean } = {}): Promise<Snapshot>` — restore local data; fetch remote data on first use. `create` allows initializing a missing or completely empty tab in an existing file. It never overwrites incompatible data.
- `set(key, patch): Promise<void>` — set absolute values in a partial patch. Resolves after the local commit. Unspecified fields are unchanged; `undefined` is invalid and `null` clears a cell. No server-side increment or compare-and-swap.
- `delete(key): Promise<void>` — clear managed local values and enqueue cell clearing. The physical row, key, and unmanaged columns remain.
- `get(key): Row | undefined` — synchronous local view after `open()`, including pending edits. No network.
- `all(): Row[]` — local records. Ordering is not part of the contract; sort in your app.
- `snapshot(): Snapshot` — current data and status. Before `open()` completes it may contain no rows and the phase `opening`.
- `subscribe(fn): () => void` — immediately invoke a subscriber, then emit snapshots. The returned function unsubscribes. Subscriber exceptions must not interrupt saving.
- `sync(): Promise<void>` — process at most 100 batches per call, with approximately 100 operations per batch (a transaction is never split). The automatic scheduler handles subsequent work. Errors reject while retaining operations and batch identity.
- `refresh({ create?: boolean } = {}): Promise<void>` — fetch the full current managed data while retaining local pending changes.
- `export(): Promise<StoredTable | null>` — raw record with base data, operations, and batch identity. No token is included; application data may be sensitive.

## Snapshot

```ts
{
  phase: 'opening' | 'ready' | 'pending' | 'syncing' |
         'offline' | 'auth-required' | 'error' | 'closed',
  rows: Row[],
  columns: DynamicColumn[],
  initialized: boolean,
  pending: number, // coalesced operations, not clicks
  syncedAt: number | null, // local timestamp of the last read/ack
  error: { code: string, message: string } | null
}
```

On initial access, `syncedAt` confirms a read; after sending, it confirms acknowledgement. `ready` with no pending operations does not imply live tracking of other devices' edits. Use `refresh()` for those.

## Columns

| Function | Value | Cell format |
| --- | --- | --- |
| `column.text(header)` | `string | null` | Nonempty text; empty cell for `null`. |
| `column.number(header)` | `number | null` | Finite number encoded as text; zero is valid. |
| `column.boolean(header, checked = '✓')` | `boolean | null` | `checked`, `FALSE`, or an empty cell. |
| `column.json<T>(header, validator, version = 'v1')` | `T | null` | JSON with a required runtime validator. |
| `column.custom<T>(header, { id, encode, decode })` | `T | null` | Custom text codec with a stable, versioned ID. |

Custom codecs must validate input and reject invalid formats. Changing an ID/version changes the schema fingerprint. Encoded cells have a prototype limit of 40,000 characters; this is not a promise about overall Google API limits.

## Adapters

`createIndexedDBStorage(name = 'sheetbase')` persists tables in the `tables` store, sends notifications through BroadcastChannel when available, and coordinates sync with Web Locks or renewable IndexedDB leases. `list()` returns all persisted table records. `close()` closes the database connection and channel. It does not erase data.

`createMemoryStorage()` serializes updates and coordinates locks within one instance, for tests or temporary state.

`createGoogleSheetsRemote({ getCredentials, fetch? })` uses Google's REST API. The passive provider returns `{ accountId, accessToken }`. `fetch` can be replaced in contract tests. The adapter never persists credentials or opens OAuth windows.

`createMemoryRemote(initialTables?, initialReceipts?, initialSchemas?)` is a simulated backend for tests and the demo. `checkpoint()` returns `{ tables, receipts, schemas }` for restoring another simulation. This adapter is optional in production apps.

The `Storage`, `Remote`, `Target`, `StoredTable`, and `Operation` interfaces are exported for custom adapters. See [Architecture](ARCHITECTURE.md).

## Errors

`SheetbaseError` has `code`, `message`, and `retryable`. Codes: `auth-required`, `offline`, `schema`, `storage`, `network`, `closed`, `invalid-value`, `unsupported`.

- `network` with `retryable: true`: bounded automatic retries; data remains saved.
- `auth-required`: your app authorizes the correct account, then calls `resume()`.
- `schema`: fix headers/duplicate keys or restore the original schema; pending changes are not discarded.
- `storage`: do not claim a successful local save if its promise rejects.
- `unsupported`: the configured remote does not implement dynamic schema discovery.

## Dynamic table API / Dynamické tabuľky

```ts
const journal = db.table({
  spreadsheetId: 'existing-file-id', sheet: 'Journal', keyColumn: 'Date',
  columns: {},
  dynamic: {
    sheet: 'JournalColumns', defaultType: 'text',
    codecs: { text: column.text, number: column.number }
  }
});
await journal.open({ create: true });
await journal.transaction(tx => {
  tx.addColumn({ id: 'pages', header: 'Pages', type: 'number' });
  tx.set('2026-10-29', { pages: 24 });
});
await journal.renameColumn('pages', 'Read pages');
await journal.removeColumn('pages');
```

- `columns(): DynamicColumn[]` returns the projected `{ id, header, type }` schema.
- `addColumn(column)`, `renameColumn(id, header)`, `removeColumn(id)` enqueue durable schema changes.
- `transaction(tx => { ... })` applies synchronous `tx.get`, `tx.set`, `tx.addColumn`, `tx.renameColumn`, `tx.removeColumn` to the latest record in one storage transaction. Validation failure rolls back every change. `tx.columns` reflects preceding changes in the callback.
- `import({ base, columns, operations, batch, initialized, syncedAt })` seeds an empty cache during a migration. Existing initialized records and queues are never replaced. Data is raw text keyed by stable column ID for dynamic tables. Import retains frozen IDs; callers own conversion of their legacy format.
- `open({ cachedOnly: true })` restores the cache without opening a network connection.
- `duplicateKeys: 'last'` optionally reads the last physical duplicate, including clears, and writes every matching row. The default rejects duplicates.

Dynamic Google tables own a separate metadata tab named by `dynamic.sheet`, with `ID`, `Name`, `Type` headers. All data headers are managed; unrelated tabs are preserved. `dynamic.defaultType` assigns a codec type to existing columns without metadata. Register stable, versioned codec types in `dynamic.codecs`. The remote stores schema operations and receipts in the same atomic Sheets batch, and keeps structural transactions together across batch boundaries. A schema refresh that conflicts with pending values fails before replacing the old local base.

`createGoogleSheetsRemote({ getCredentials, fetch?, timeoutMs?, legacyLedgers? })` can check old receipt tabs containing `Batch ID`, `Saved at` during migrations. A matching receipt reloads current data and stable column IDs before acknowledging the original frozen batch.

Custom dynamic remotes implement `readSchema(target, guard)` and return raw values by column ID. `commit()` receives acknowledged `target.columns` and operations with optional `schema` and `transaction`. It may return `{ rows, columns }` after structural writes or receipt recovery; otherwise the client applies acknowledged operations locally. Storage adapters now implement `list()`.
