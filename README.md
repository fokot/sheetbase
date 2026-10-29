# Sheetbase

**English** · [Slovenčina](README.sk.md)

[Documentation & interactive demo](https://fokot.github.io/sheetbase/en/) · [Slovenská dokumentácia](https://fokot.github.io/sheetbase/sk/) · [GitHub](https://github.com/fokot/sheetbase)

A local-first TypeScript library for personal apps that use Google Sheets as remote storage. Writes commit to local storage first; pending changes sync in batches. No application server, React dependency, or runtime packages.

**Version 0.2 adds durable dynamic columns and local transactions for tracker integrations.** The Google adapter is covered by simulated HTTP contract tests, not live Google integration tests. The documentation demo uses disposable browser-local data and never signs in to Google. The package remains `private: true` to prevent accidental npm publication.

## Install from GitHub

```sh
npm install github:fokot/sheetbase#main
```

Import from `@fokot/sheetbase`. The repository includes compiled JavaScript and TypeScript declarations in `dist/`. Installation does not run a library or documentation build. The package is not published to the npm registry. An installable `.tgz` is also attached to each GitHub Release.

## Quick start

```ts
import {
  createSheetbase, createIndexedDBStorage,
  createGoogleSheetsRemote, column
} from '@fokot/sheetbase';

// Your app has already verified the Google user's identity.
// Keep the access token in memory, outside local storage.
const db = createSheetbase({
  accountId: googleUser.id,
  storage: createIndexedDBStorage('my-app'),
  remote: createGoogleSheetsRemote({
    getCredentials: () => ({
      accountId: googleUser.id,
      accessToken: tokenInMemory
    })
  })
});

const journal = db.table({
  spreadsheetId: sheetId,
  sheet: 'Journal',
  keyColumn: 'Date',
  columns: {
    walk: column.boolean('Walk'),
    pages: column.number('Pages'),
    note: column.text('Note')
  }
});

await journal.open({ create: true });
await journal.set('2026-10-27', { walk: true, pages: 24 });
console.log(journal.get('2026-10-27'));

const unsubscribe = journal.subscribe(({ rows, phase, pending }) => {
  // Render your own interface.
});
```

`googleUser`, `tokenInMemory`, and `sheetId` are supplied by your app. The SDK does not open OAuth popups. See [Google setup](docs/en/GOOGLE-SETUP.md).

`await set()` confirms the local transaction. Automatic sync is enabled by default with a 650 ms batching window. `await table.sync()` explicitly sends the pending queue. Call `unsubscribe()` to stop observing, `db.dispose()` to close the client, and `storage.close()` when you own the storage adapter's lifecycle.

## Table model

- Every record has a unique, nonempty string key in **column A**.
- Row 1 contains headers. The schema maps application fields to column names.
- Only registered columns are changed; other cells and tabs are preserved.
- `set(key, patch)` sets absolute values in a partial patch. It is not an atomic increment.
- `null` clears a cell. `0` and `false` are values; empty text is represented by `null`.
- `delete(key)` clears registered cells. It retains the physical row, key, and unregistered cells. Records whose managed values are all empty are omitted from `all()`.
- `open({ create: true })` creates a missing tab or initializes an entirely empty tab in an existing spreadsheet. It does not create a Drive file or overwrite incompatible data.

| Date | Walk | Pages | Note |
| --- | --- | --- | --- |
| 2026-10-27 | ✓ | 24 | A chapter before bed |

Values use `userEnteredValue.stringValue`; text beginning with `=` is stored as text, not interpreted as a formula.

## Dynamic columns and transactions

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
Dynamic tables store stable column IDs, names and codec types in a separate tab with the headers `ID`, `Name`, `Type`. This metadata tab is owned by the dynamic table; all nonempty data headers are registered. Renames keep the ID and all history; removals delete the physical column and its metadata. Column changes and associated values are saved in one local transaction and one remote batch, including across batch-size boundaries. They survive reloads and lost responses. `tx.get()` reads the latest durable projection inside the local transaction, so concurrent toggles do not use stale UI state. Callbacks must be synchronous.

`columns()` and `snapshot().columns` expose the current schema. `open({ cachedOnly: true })` restores data without requiring Google. `storage.list()` enumerates cached queues for backups and reconnecting files.

Record keys must be unique. Duplicate keys stop synchronization until the sheet is corrected.

## Offline and synchronization

`createIndexedDBStorage()` persists the base data, operation queue, and frozen batch identity. Records are isolated by namespace, account, spreadsheet, and tab. Recreate the same client and call `open()` with the same schema to recover pending changes. Register the tables you want to sync; the client does not discover or send old unregistered schemas.

For ordinary writes, the Google adapter reads current headers and the key index, then writes only changed cells. New keys use server-side `appendCells`, preserving trailing notes with empty keys. Unsent patches for the same record are coalesced. A batch that might already have reached the server remains immutable.

A hidden **`_Sheetbase`** tab stores `Batch`, `Table`, and `Saved at`. Cell changes and the receipt are written in one atomic Sheets batch request. If a response is lost, retry checks that receipt instead of repeating the write. Do not remove the ledger while pending batches may exist.

After initial loading, `open()` uses the cache. `get()` and `all()` never read Google. Use `refresh()` or `open({ refresh: true })` to load external edits; pending local changes are retained. Reconnecting does not automatically reload the entire history.

The client reacts to browser online and focus events, with bounded retries. Authentication errors require your app to reauthorize and call `db.resume()`. Schema mismatches and duplicate keys stop writes while preserving the queue. All these flows can be tested without Google using `createMemoryRemote()`.

## Limits of version 0.2

- Fixed schemas still reject incompatible fingerprints. Opt into dynamic tables for durable column additions, renames, and removals.
- A different schema fingerprint rejects existing local data. Use the registered schema to sync or export pending changes before replacing it.
- Google file permissions determine access. The SDK adds no row-level security.
- Across independent devices, the last successful cell write wins. Sorting between the index read and write can cause a conflict; this is not a distributed database.
- IndexedDB synchronization uses Web Locks, with renewable IndexedDB leases as a fallback. Memory adapters coordinate within one JavaScript instance.
- Sync runs while the app is open. Service workers, offline page caching, and uploads after closing the browser are outside the SDK.
- A browser can reject or evict storage. `table.export()` includes pending operations for an app-owned backup flow.
- Never put service-account private keys in the browser. The credentials provider must be passive and must not open a login popup for each request.
- Google quotas and token expiry still apply. See [API limits](https://developers.google.com/workspace/sheets/api/limits), [the token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), and [batch atomicity/concurrency](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate).

## Develop and preview

Requires Node.js 20.11 or newer; CI uses Node.js 24.

```sh
npm ci
npm test
npm run docs
```

Open the printed loopback URL, normally `http://127.0.0.1:4188/`. The website includes an English/Slovak switch, rendered README/API pages, highlighted code, and an interactive offline demo using the real SDK, IndexedDB, and a simulated remote. The server exposes only the built `_site/` directory. The entry URL selects Slovak only when the browser’s primary language is Slovak; otherwise it selects English. The language switch remembers an explicit choice. Direct `/en/` and `/sk/` links always open the requested language.

```sh
npm run build:lib       # JavaScript, declarations and maps → dist/
npm run build:docs      # Both documentation languages → _site/
npm run test:docs       # Page, link and code-highlighting checks
node examples/basic.mjs # Offline + lost-response example, no Google
```

The checked-in `dist/` also lets you run the example or library tests without installing dependencies:

```sh
node examples/basic.mjs
node --test tests/client.test.mjs tests/google.test.mjs tests/dynamic.test.mjs
```

`preview.html` is a standalone Slovak preview with inlined assets. IndexedDB on `file://` is browser-dependent; use the HTTP preview for reliable testing.

## Automatic builds and releases

- **CI:** every push to `main` and pull request builds the SDK, checks typed examples, runs tests, builds both documentation languages, verifies local links, and uploads `dist/`. It checks that committed `dist/` matches its sources.
- **Pages:** pushes to `main` build and deploy the documentation to GitHub Pages.
- **Release:** pushing `vX.Y.Z` checks that the tag matches `package.json`, builds/tests, and attaches an installable `.tgz` to a GitHub Release. Nothing is published to npm.

Before tagging a version, update the package version and commit the rebuilt `dist/`. The release workflow refuses stale compiled files.

```sh
npm version patch --no-git-tag-version
npm test
npm run build:docs
npm run test:docs
git add package.json package-lock.json dist
git commit -m "Release 0.2.1"
git tag v0.2.1
git push origin main v0.2.1
```

The repository currently has no open-source license grant (`UNLICENSED`). Public visibility alone does not grant redistribution rights.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/client.ts` | Public API and synchronization engine |
| `src/storage.ts` | IndexedDB and memory adapters |
| `src/google.ts` | Google Sheets adapter and simulated remote |
| `src/columns.ts` | Cell types and codecs |
| `src/model.ts` | Local projection and operation coalescing |
| `tests/` | SDK regressions, HTTP fixture, documentation checks |
| `examples/` | Runnable example and typed usage |
| `index.html`, `en/`, `assets/` | Bilingual documentation website |
| `.github/workflows/` | CI, Pages, and release packaging |

[API reference](docs/en/API.md) · [Architecture](docs/en/ARCHITECTURE.md) · [Testing](docs/en/TESTING.md) · [Google setup](docs/en/GOOGLE-SETUP.md)
