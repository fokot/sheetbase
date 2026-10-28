# Sheetbase

[English](README.md) · **Slovenčina**

[Webová dokumentácia](https://fokot.github.io/sheetbase/sk/) · [GitHub](https://github.com/fokot/sheetbase)

Samostatná TypeScript knižnica pre osobné aplikácie, ktoré používajú Google Sheets ako vzdialené úložisko. Dáta zapisuje najprv do lokálneho úložiska, potom odosiela čakajúce zmeny v dávkach.

**Funkčný prototyp na posúdenie rozhrania. Fero Tracker ho zatiaľ nepoužíva.** Zdrojový kód je na GitHube; balík nie je publikovaný v npm registry. Balík má `private: true`, nemá žiadne runtime závislosti, React ani Zustand. Google adaptér je overený simulovaným HTTP API; tento projekt sa neprihlasuje do tvojho účtu a nevykonal živé zápisy do tvojich tabuliek.

## Inštalácia

```sh
npm install github:fokot/sheetbase#v0.1.0
```

Importuj z `@fokot/sheetbase`. Tag obsahuje hotový `dist/` s JavaScriptom a TypeScript deklaráciami. Inštalácia nespúšťa build ani build dokumentácie. Balík nie je v npm registry. Alternatívne sa dá nainštalovať `.tgz` z GitHub Release.

## Pozrieť si návrh

Vyžaduje Node.js 20.11 alebo novší:

```sh
npm ci
npm test
npm run docs
```

Otvor lokálnu adresu vypísanú serverom, štandardne `http://127.0.0.1:4188/`. Stránka obsahuje interaktívnu ukážku offline zápisu, obnovenia klienta, synchronizácie a stratenej odpovede. Používa skutočné jadro SDK, IndexedDB a simulovaný cloud. Jej testovacie dáta zostávajú v tomto prehliadači. Server počúva len na loopback adrese. Vstupná URL vyberie slovenčinu iba pri slovenskom primárnom jazyku prehliadača, inak angličtinu. Ručné prepnutie si zapamätá. Priame odkazy `/en/` a `/sk/` vždy otvoria zvolený jazyk.

Pribalený `dist/` umožňuje spustiť príklad a testy knižnice aj bez inštalácie závislostí:

```sh
node examples/basic.mjs
node --test tests/client.test.mjs tests/google.test.mjs
```

Po úprave zdrojov spusti `npm run build:lib`; `npm run build:docs` zostaví dvojjazyčný web do `_site/`. Samostatný `preview.html` obsahuje vložené štýly aj celé SDK a dá sa otvoriť priamo v prehliadači. IndexedDB na `file://` závisí od prehliadača; spoľahlivý plný test používa lokálny HTTP server. Zdrojový `index.html` a `en/index.html` sú slovenská a anglická verzia webu. README aj ďalšie Markdown dokumenty sa pri builde vykreslia do HTML so syntax highlightingom. `npm run docs` zostaví a sprístupní iba `_site/`. Samostatný náhľad samotnej stránky nevolá Google, nenahráva dáta a neobsahuje tokeny.

## Prvé použitie s Googlom

```ts
import {
  createSheetbase, createIndexedDBStorage,
  createGoogleSheetsRemote, column
} from '@fokot/sheetbase';

// Účet už overila aplikácia cez Google userinfo.
// Token je v pamäti aplikácie, nie v lokálnom úložisku.
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
  // Renderuj vlastné rozhranie.
});
```

`googleUser`, `tokenInMemory` a `sheetId` sú vstupy aplikácie; nejde o hodnoty poskytnuté SDK. Knižnica sama nevytvára OAuth popup. [Konfigurácia Google účtu](docs/GOOGLE-SETUP.md).

`await set()` potvrdzuje lokálnu transakciu, nie zápis do Googlu. Automatické odosielanie je štandardne zapnuté, s oknom 650 ms. `await table.sync()` explicitne odošle aktuálnu frontu. `unsubscribe()` odpojí odber, `db.dispose()` zastaví klienta a `storage.close()` uzavrie vlastný storage adaptér.

## Model tabuľky

- Každý záznam má jedinečný neprázdny textový kľúč v **stĺpci A**.
- Riadok 1 obsahuje hlavičky. Schéma mapuje polia aplikácie na názvy stĺpcov.
- Knižnica mení len registrované stĺpce. Ostatné stĺpce a listy zachová.
- `set(key, patch)` je čiastočná zmena absolútnych hodnôt, nie atomický increment.
- `null` vymaže hodnotu. `0` a `false` sa ukladajú ako hodnoty. Prázdny text sa reprezentuje cez `null`.
- `delete(key)` vyprázdni registrované bunky. Fyzický riadok, kľúč a neregistrované bunky zostávajú zachované. Riadky so všetkými registrovanými hodnotami prázdnymi sa v `all()` nevracajú.
- `open({ create: true })` vytvorí chýbajúci list alebo inicializuje úplne prázdny list v existujúcom spreadsheet súbore. Nevytvára nový súbor na Drive a neprepisuje nekompatibilný neprázdny list.

Príklad:

| Date | Walk | Pages | Note |
| --- | --- | --- | --- |
| 2026-10-27 | ✓ | 24 | Kapitola pred spaním |

Texty sa zapisujú cez `userEnteredValue.stringValue`, takže text začínajúci `=` nie je prevedený na vzorec.

## Offline a synchronizácia

`createIndexedDBStorage()` trvalo uchová základ dát, frontu zmien a identitu rozpracovanej dávky. Dáta sú oddelené podľa namespace, účtu, súboru a listu. Po opätovnom vytvorení rovnakého klienta a zavolaní `open()` s rovnakou schémou sa čakajúca fronta obnoví. Na odoslanie sa musia zaregistrovať príslušné tabuľky; klient neskenuje a neodosiela nezaregistrované staré schémy.

Pri bežnom zápise adaptér načíta hlavičky a stĺpec kľúčov, overí aktuálne fyzické pozície a zapíše len zmenené bunky. Nové kľúče pridáva cez serverové `appendCells`, čím zachová aj koncové riadky s poznámkami a prázdnym kľúčom. Opakované neodoslané zmeny záznamu sa spájajú. Dávka, ktorá už mohla byť odoslaná, sa nemení.

Skrytý list **`_Sheetbase`** obsahuje `Batch`, `Table`, `Saved at`. Zápisy dát aj potvrdenie dávky sa odosielajú v jednom atomickom Google batch requeste. Ak sa odpoveď stratí, ďalší pokus skontroluje uložené potvrdenie. Tento list nemaž, kým môžu existovať čakajúce dávky.

`open()` po prvom načítaní používa cache. `get()` a `all()` nikdy nečítajú Google. Ručné úpravy iných buniek v Sheete sa zobrazia cez `refresh()` alebo `open({ refresh: true })`. `refresh()` zachová lokálnu frontu. Pozastavenie či obnovenie spojenia nevyvoláva čítanie celej histórie.

Klient reaguje na návrat internetu a aktívne okno; automatické pokusy majú konečný limit. Chyba prihlásenia vyžaduje reautorizáciu v aplikácii a `db.resume()`. Zmena schémy alebo duplicitný kľúč zastaví zápis a ponechá frontu. Všetky tieto správania možno overiť bez Googlu cez `createMemoryRemote()`.

## Hranice verzie 0.1

- Fixná schéma registrovaných stĺpcov; automatické migrácie, premenovanie a mazanie stĺpcov nie sú implementované.
- Zmena fingerprintu schémy so starými dátami je odmietnutá. Najprv so starou schémou synchronizuj/exportuj frontu; presný migračný protokol je otvorená úloha.
- Práva sú práva Google súboru. SDK nepridáva riadkové bezpečnostné pravidlá.
- Medzi nezávislými zariadeniami platí posledný úspešný zápis do bunky. Zoradenie listu medzi načítaním indexu a zápisom môže byť súbežný konflikt; nejde o distribuovanú databázu.
- IndexedDB synchronizácia používa Web Locks. Bez nich zostanú lokálne zápisy zachované, ale synchronizácia vyhodí chybu `unsupported`. V pamäťovom adaptéri sa zámky koordinujú v jednej JS inštancii.
- Synchronizácia beží v otvorenej aplikácii. Service worker, cache HTML stránky, serverové úlohy a nahrávanie po zavretí prehliadača nie sú súčasťou SDK.
- Browser môže úložisko odmietnuť alebo vymazať. `table.export()` poskytne aj neodoslané operácie pre vlastnú zálohu aplikácie.
- Nepoužívaj serverový service-account privátny kľúč v prehliadači. Tokenový provider má byť pasívny a nesmie otvárať prihlasovacie okno pri každej požiadavke.
- Google API má vlastné kvóty a tokeny expirujú. [Oficiálne limity](https://developers.google.com/workspace/sheets/api/limits), [tokenový model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [atomicita a súbežné úpravy](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate).

## Build a vydanie

- `npm run build:lib` zostaví knižnicu do `dist/`.
- `npm test` zostaví knižnicu, skontroluje typované príklady a spustí testy.
- `npm run build:docs` zostaví obe jazykové verzie a HTML README do `_site/`.
- `npm run test:docs` overí zostavené stránky, odkazy a zvýraznenie kódu.
- GitHub Actions pri pushi/PR spustí testy a uloží `dist/` ako artefakt. Kontroluje aj zhodu pribaleného `dist/` so zdrojmi.
- GitHub Pages po pushi na `main` zostaví a nasadí dokumentáciu.
- Tag `vX.Y.Z` spustí release workflow: overenie verzie, build, testy a GitHub Release s inštalovateľným `.tgz`. Žiadny npm publish.

Pred vydaním zmeň verziu cez `npm version patch --no-git-tag-version`, zostav a otestuj kód, commitni aj `dist/` a pushni tag zhodný s verziou balíka. Zastaraný `dist/` release workflow odmietne.

```sh
npm version patch --no-git-tag-version
npm test
npm run build:docs
npm run test:docs
git add package.json package-lock.json dist
git commit -m "Release 0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

Repozitár zatiaľ nemá udelenú open-source licenciu (`UNLICENSED`). Zverejnenie kódu samo neudeľuje právo na ďalšiu distribúciu.

## Súbory

| Cesta | Obsah |
| --- | --- |
| `src/client.ts` | Verejné rozhranie a synchronizačný mechanizmus |
| `src/storage.ts` | IndexedDB a pamäťový adaptér |
| `src/google.ts` | Google Sheets adaptér a simulovaný backend |
| `src/columns.ts` | Typy a formátovanie buniek |
| `src/model.ts` | Projekcia lokálnych zmien a spájanie operácií |
| `tests/` | Samostatné regresné testy, HTTP fixture |
| `examples/` | Spustiteľný príklad a TypeScript ukážky |
| `index.html`, `en/`, `assets/` | Dvojjazyčná webová dokumentácia |
| `.github/workflows/` | CI, GitHub Pages a zostavenie vydaní |

Ďalej: [API](docs/API.md) · [Architektúra](docs/ARCHITECTURE.md) · [Testovanie](docs/TESTING.md) · [Google setup](docs/GOOGLE-SETUP.md).
