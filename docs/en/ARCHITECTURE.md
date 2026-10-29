# Architecture and decisions

## Purpose

Separate generic data-client behavior from React components and tracker-specific rules. The library does not know about habits, workouts, days, or sets. It understands column schemas, string keys, local operations, and remote receipts.

```text
Application / OAuth / UI
          │
  SheetbaseClient + SheetTable
       ┌──┴────────────┐
    Storage          Remote
    IndexedDB        Google Sheets
    or memory        or simulation
```

The core has no runtime dependencies. Cell codecs form an explicit boundary between application values and sheet text. If the tracker adopts the SDK later, its UI and workout-set encoding will stay in the application. This project does not change the tracker.

## Local record

Format version `1` contains:

- Identity: namespace + account ID + spreadsheet ID + tab name.
- Schema fingerprint: key header, fields, types, and codec versions.
- `base`: last fetched or acknowledged managed cell data.
- `operations`: absolute local patches with UUIDs.
- `batch`: immutable batch ID and operation IDs that the remote might already have accepted.
- Monotonic `revision`, initialization status, timestamp, and last sync error.

The UI projection is `apply(base, operations)`. This pure function omits records with all managed values empty. Local records contain neither authentication tokens nor codec functions.

`Storage.update` must perform an atomic read → reducer → write transaction and resolve only after commit. The reducer is synchronous. IndexedDB implements this as one readwrite transaction. Memory storage serializes updates through a promise queue. Subscribers are notified after commit; revisions prevent an older callback overwriting a newer view.

## From click to acknowledgement

1. `set` validates fields and encodes values as text.
2. A transaction reads the current record and coalesces unsent patches for the same key. Later values win while unrelated fields remain unchanged.
3. The local-save promise resolves; the UI can show the new state.
4. A scheduler waits 650 ms by default, then starts sending.
5. Under a lock, up to 100 operations are frozen into a batch with a UUID. Subsequent edits cannot alter frozen operations.
6. The Google adapter reads current headers, keys, and receipts. It checks schema compatibility and unique keys without fetching all historical values for ordinary writes.
7. Changed cells and the receipt are written in one Sheets batch operation. New keys use server append to preserve trailing notes with empty keys.
8. Local acknowledgement applies only the sent operations to the base and removes their IDs. Edits made during the request remain queued for the next batch.

After a lost response, the batch remains frozen. Retry first checks for its receipt. If the receipt belongs to the same table, it does not repeat the write. This protects the retry protocol; it is not a distributed transaction across devices.

## Identity and lifecycle

The client's account identity is immutable. Before and after requests, the Google adapter compares the passive provider's account and token. Your app must verify Google's `sub` when obtaining a token; the SDK cannot verify the app's identity claim without another identity flow. No stored record references a token.

`pause` and `dispose` increment the client generation. In-flight steps check the generation before writing or acknowledging locally. An already sent request may complete remotely, so its local batch must remain for a later receipt check.

The table lock serializes reads and sync across clients sharing storage. A file lock coordinates tables in the same spreadsheet and creation of the shared ledger. `set()` needs no network lock: it uses an atomic storage update and can run during a request.

## Deliberate limits

- Keys are in column A; headerless reads and arbitrary relational queries are not supported.
- Schemas have fingerprints but no migration protocol. The SDK never hides a mismatch by erasing the cache.
- No physical row deletion. Dynamic column changes are explicit; no previous application data is imported.
- Retries are bounded; ordinary 400/schema errors do not trigger endless attempts.
- IndexedDB sync uses Web Locks or renewable leases in the `leases` store (database version 2).
- Locks do not extend across independent devices. Structural edits between index reading and writing remain a conflict window.
- No server secrets, proxy, analytics, or OAuth UI.

Before production adoption, add contract tests against a dedicated live sheet, and testing in target browsers. The documentation demo validates the local IndexedDB flow without access to a visitor's Google account.
