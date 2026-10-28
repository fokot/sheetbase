# Testing independently

```sh
npm ci
npm test
node examples/basic.mjs
```

Tests import the compiled package from `dist/index.js`. `npm test` builds TypeScript first, so tests and the documentation demo use the same implementation. Typed examples are checked separately by `npm run typecheck:examples`.

There are **29 SDK tests**, plus TypeScript example checks and documentation-build tests.

## Coverage

`tests/client.test.mjs` covers cell types, null/false/zero, local projection, patch coalescing, reopening persistence, frozen batches, lost responses, edits during upload, storage failures, account isolation, schema fingerprints, client disposal, deletion, refreshing with pending changes, special keys, and clients sharing storage.

`tests/google.test.mjs` uses a simulated HTTP Sheets server. It checks request format, Bearer credentials, a hidden ledger in the same batch, preserving unmanaged cells, fresh indexes after moving rows, trailing notes, retrying a lost response, server errors, account changes before/after a request, invalid schemas, duplicate keys, apostrophes in A1 ranges, and bounded read ranges.

The fixture applies each complete batch to a copy of its state and acknowledges only after successful application. Its lost-response mode first persists data and the receipt, then throws a network error.

## What these tests do not prove

A mocked Google API is not certification of the live service. No live integration tests or access to your files are configured. Memory storage does not validate every IndexedDB implementation detail; the latter is also exercised by the HTML demo in a browser.

## Automatic builds

GitHub Actions runs the same SDK tests on pushes and pull requests, checks that committed `dist/` matches source, and uploads compiled files as an artifact. Pages builds both documentation languages and renders Markdown as HTML. The release workflow for `vX.Y.Z` produces an installable `.tgz`; it does not publish to npm.

```sh
npm run build:docs
npm run test:docs
```

Documentation tests check both languages, local links, syntax-highlighted snippets, and the package's installation scripts.

## Manual browser check

1. Run `npm run docs` and open the printed local address.
2. Switch to English, enable Offline, add pages, and toggle the walk value.
3. Check the local table and pending count. The simulated Sheet stays unchanged.
4. Click Reopen client or reload. Local data and pending changes remain.
5. Return Online and sync. Both views match and the queue empties.
6. Expand the lost-response test, arm it, edit a value, and sync. The first attempt keeps a pending batch; the second acknowledges it without duplication.
7. Check mobile layout, keyboard tabs, language switching, and code copying in the README.

The demo persists its simulated backend locally using a memory-adapter checkpoint. Live Google integration is disabled. Reset demo data deletes only `sheetbase-docs-v1` and the demo's own auxiliary keys.
