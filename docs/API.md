# API referencia

Import: `@fokot/sheetbase` po inštalácii z GitHubu. Pri práci v tomto repozitári príklady používajú `./dist/index.js`. Balík nie je publikovaný v npm registry.

## `createSheetbase(options)`

| Voľba | Typ / default | Význam |
| --- | --- | --- |
| `accountId` | povinný `string` | Stabilný identifikátor účtu overeného aplikáciou; pri Google používaj userinfo `sub`. |
| `storage` | povinný `Storage` | Lokálna perzistencia. |
| `remote` | povinný `Remote` | Vzdialené úložisko. |
| `namespace` | `string`, `sheetbase` | Súčasť identity lokálnej tabuľky. |
| `autoSync` | `boolean`, `true` | Automatické odosielanie registrovaných tabuliek. |
| `debounceMs` | `number`, `650` | Okno na zoskupenie blízkych zápisov. |
| `retry.attempts` | `number`, `4` | Limit automatických pokusov po prechodnej chybe. |
| `retry.baseDelayMs` | `number`, `1000` | Základ exponenciálneho oneskorenia. |
| `retry.maxDelayMs` | `number`, `30000` | Horná hranica oneskorenia. |

`db.table(definition)` zaregistruje tabuľku. Registrácia nevolá Google. Opakovaná registrácia tej istej identity s rovnakou schémou vráti tú istú inštanciu; iná schéma je odmietnutá.

`db.sync()` odošle všetky registrované tabuľky. `db.setOnline(boolean)` umožňuje explicitný režim; prehliadač navyše posiela udalosti online/offline. `db.pause()` pozastaví sieť a zneplatní rozpracovaný kontext; lokálne úpravy zostanú dostupné. Po obnovení prihlasovania zavolaj `db.resume()`. `db.dispose()` je definitívne zatvorenie klienta. Už odoslaný HTTP request môže Google dokončiť; zatvorený klient ho neoznačí lokálne za potvrdený a ďalší klient použije receipt.

## `db.table({ spreadsheetId, sheet, keyColumn, columns })`

Kľúč je vždy prvý stĺpec. `keyColumn` je názov jeho hlavičky, nie fyzická adresa. Každý neprázdny kľúč musí byť jedinečný. Hlavičky sú jedinečné bez ohľadu na veľkosť písmen. Príklad:

```ts
const journal = db.table({
  spreadsheetId: 'existing-file-id',
  sheet: 'Journal', keyColumn: 'Date',
  columns: { pages: column.number('Pages') }
});
```

Výsledný `Row` je `{ key: string, values: { pages: number | null } }`. TypeScript odvodí hodnoty z definícií stĺpcov.

## Metódy tabuľky

- `open({ create?: boolean, refresh?: boolean, cachedOnly?: boolean } = {}): Promise<Snapshot>` — načíta lokálny record; pri prvom použití načíta vzdialené dáta. `create` povoľuje inicializáciu chýbajúceho/úplne prázdneho listu v existujúcom súbore. Neprepisuje nekompatibilné dáta.
- `set(key, patch): Promise<void>` — čiastočne nastaví absolútne hodnoty. Promise sa splní až po lokálnom commite. Nezadané polia nemení. `undefined` je chyba; `null` vymaže bunku. Nevykonáva serverový increment ani compare-and-swap.
- `delete(key): Promise<void>` — lokálne vymaže registrované hodnoty a zaradí vyprázdnenie buniek do fronty. Fyzický riadok a jeho kľúč zostávajú zachované. Neregistrované stĺpce nemení.
- `get(key): Row | undefined` — synchronizovaný pohľad na lokálny stav po `open()`, vrátane čakajúcich zmien. Bez siete.
- `all(): Row[]` — lokálne záznamy. Poradie nie je súčasťou kontraktu; aplikácia si ho zoradí.
- `snapshot(): Snapshot` — aktuálne dáta aj stav. Pred dokončením `open()` môže obsahovať prázdne riadky a fázu `opening`.
- `subscribe(fn): () => void` — okamžite zavolá odberateľa a posiela ďalšie snapshoty. Návratová funkcia odpojí odber. Chyba odberateľa nesmie prerušiť uloženie.
- `sync(): Promise<void>` — spracuje frontu po maximálne 100 dávkach na jedno zavolanie, po najviac 100 operáciách v dávke. Ďalšie automatické odosielanie rieši plánovač. Pri chybe odmietne promise, zachová operácie aj receipt ID.
- `refresh({ create?: boolean } = {}): Promise<void>` — načíta celý aktuálny obsah registrovaných polí a zachová čakajúce lokálne zmeny.
- `export(): Promise<StoredTable | null>` — surový record vrátane base, operácií a identity dávky. Neobsahuje token. Export môže obsahovať osobné dáta aplikácie.

## Snapshot

```ts
{
  phase: 'opening' | 'ready' | 'pending' | 'syncing' |
         'offline' | 'auth-required' | 'error' | 'closed',
  rows: Row[],
  columns: DynamicColumn[],
  initialized: boolean,
  pending: number, // počet operácií po spájaní, nie počet klikov
  syncedAt: number | null, // lokálny timestamp posledného čítania/acku
  error: { code: string, message: string } | null
}
```

Pri prvom prístupe `syncedAt` potvrdzuje čítanie; pri odoslaní potvrdzuje acknowledgement. `ready` a nula čakajúcich operácií neznamenajú, že klient sleduje všetky živé zmeny iných zariadení. Na to je explicitný `refresh()`.

## Stĺpce

| Funkcia | Hodnota | Bunkový formát |
| --- | --- | --- |
| `column.text(header)` | `string | null` | Neprázdny text alebo prázdna bunka pre `null`. |
| `column.number(header)` | `number | null` | Konečné číslo zapísané ako text. `0` je platné. |
| `column.boolean(header, checked = '✓')` | `boolean | null` | `checked`, `FALSE`, prázdna bunka. |
| `column.json<T>(header, validator, version = 'v1')` | `T | null` | JSON s povinným runtime validátorom. |
| `column.custom<T>(header, { id, encode, decode })` | `T | null` | Vlastný textový kodek so stabilným verzovaným ID. |

Vlastný kodek musí kontrolovať vstupy a odmietnuť neplatný formát. Zmena ID/verzie mení fingerprint schémy. Encoded bunka má v prototype limit 40 000 znakov; nejde o prísľub celkových limitov Google API.

## Adaptéry

`createIndexedDBStorage(name = 'sheetbase')` uchová dáta v store `tables`, posiela oznámenia cez BroadcastChannel (ak je dostupný), koordinuje synchronizáciu cez Web Locks alebo obnovované IndexedDB leases. `list()` vráti všetky uložené tabuľky. `close()` uzavrie handle a kanál. Storage môže byť zdieľaný viacerými klientmi; `dispose()` ho automaticky nezatvára.

`createMemoryStorage()` je dočasné úložisko pre testy a príklady. Pre perzistenciu v prehliadači použi IndexedDB.

`createGoogleSheetsRemote({ getCredentials, fetch?, timeoutMs? })` vyžaduje pasívny callback vracajúci `{ accountId, accessToken }`. `accountId` sa kontroluje pred a po HTTP requeste, rovnako aj token. Callback nemá token získavať interaktívne. Timeout je štandardne 20 s. Metadata sú cacheované 60 s a po chybách zápisu sa invalidujú.

`createMemoryRemote(initialTables = {}, savedReceipts = {})` je simulácia, ktorá nevolá Google. Kľúč úvodnej tabuľky je `JSON.stringify([accountId, spreadsheetId, sheet])`. Metódy `setOnline()`, `loseNextResponse()`, `inspect(target)`, `stats()` a `checkpoint()` sú pomocníci pre testy a dokumentačnú ukážku. `checkpoint()` vracia `{ tables, receipts, schemas }`, ktoré možno odovzdať ďalšej simulácii. Do produkčnej aplikácie tento simulovaný adaptér netreba.

Rozhrania `Storage`, `Remote`, `Target`, `StoredTable` a `Operation` sú exportované pre vlastné adaptéry. Ich kontrakt popisuje [architektúra](ARCHITECTURE.md).

## Chyby

`SheetbaseError` obsahuje `code`, `message`, `retryable`. Kódy: `auth-required`, `offline`, `schema`, `storage`, `network`, `closed`, `invalid-value`, `unsupported`.

- `network` s `retryable: true`: konečný počet automatických pokusov; dáta zostanú uložené.
- `auth-required`: aplikácia prihlási správny účet, potom zavolá `resume()`.
- `schema`: oprav hlavičku/duplicitný kľúč alebo sa vráť k pôvodnej schéme; fronta sa automaticky nevymazáva.
- `storage`: nezobrazuj úspešné lokálne uloženie, keď promise zápisu zlyhá.
- `unsupported`: adaptér nepodporuje načítanie dynamickej schémy.

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
- `open({ cachedOnly: true })` restores the cache without opening a network connection.

Dynamic Google tables own a separate metadata tab named by `dynamic.sheet`, with `ID`, `Name`, `Type` headers. All data headers are managed; unrelated tabs are preserved. `dynamic.defaultType` assigns a codec type to existing columns without metadata. Register stable, versioned codec types in `dynamic.codecs`. The remote stores schema operations and receipts in the same atomic Sheets batch, and keeps structural transactions together across batch boundaries. A schema refresh that conflicts with pending values fails before replacing the old local base.


Custom dynamic remotes implement `readSchema(target, guard)` and return raw values by column ID. `commit()` receives acknowledged `target.columns` and operations with optional `schema` and `transaction`. It may return `{ rows, columns }` after structural writes or receipt recovery; otherwise the client applies acknowledged operations locally. Storage adapters now implement `list()`.
