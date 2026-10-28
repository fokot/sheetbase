# Connect a real Google Sheet

This is optional. The documentation demo and automated tests do not need it.

## What your app supplies

1. Enable **Google Sheets API** in your Google Cloud project. Enable **Google Drive API** too if the app selects or creates Drive files.
2. Create an OAuth client of type **Web application** with exact **Authorized JavaScript origins**.
3. Use the Google Identity Services token model and an appropriate scope, for example `https://www.googleapis.com/auth/drive.file`. That scope alone does not authorize arbitrary existing files: the app must create the file or the user must explicitly select it through a supported picker.
4. Verify the account identity, typically using Google userinfo and `sub`. Keep the access token in memory only.
5. Create `createSheetbase` and `createGoogleSheetsRemote`. When a token expires, your app obtains another token from a user action, then calls `db.resume()`.

The SDK does not require a client secret. Never put a client secret or service-account private key in the browser. The repository contains no credentials or automatic login flow.

## Spreadsheet

Use an existing spreadsheet that the authorized account can edit. Start with a dedicated test file.

```ts
const journal = db.table({
  spreadsheetId: 'YOUR_TEST_FILE_ID',
  sheet: 'Journal', keyColumn: 'Date',
  columns: { pages: column.number('Pages') }
});
await journal.open({ create: true });
```

This allows creating a missing tab/header in the specified file. An existing nonempty tab with an incompatible schema is rejected. The first synchronization adds a hidden internal `_Sheetbase` tab. Importing existing tracker data or migrating Fero Tracker is not implemented.

## Official references

- [Browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Sheets authorization scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [Sheets API quotas](https://developers.google.com/workspace/sheets/api/limits)
- [Batch update and concurrent changes](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)

The SDK shares Google service limits. For applications with many concurrent writers, choose an explicit conflict policy or a database designed for that workload.
