# Pripojenie reálneho Google Sheetu

Tento krok je voliteľný. Lokálna HTML ukážka ani testy ho nepotrebujú.

## Čo pripraví aplikácia

1. Vo vlastnom Google Cloud projekte zapni Google Sheets API. Ak aplikácia vyberá/vytvára súbory cez Drive, aj Google Drive API.
2. Priprav OAuth klienta typu Web application a presné Authorized JavaScript origins.
3. Použi Google Identity Services tokenový model a rozsah vhodný pre súbory aplikácie, napríklad `https://www.googleapis.com/auth/drive.file`. Rozsah sám neudeľuje prístup k ľubovoľnému existujúcemu súboru: aplikácia musí súbor vytvoriť alebo ho používateľ explicitne vyberie cez podporovaný výber súboru.
4. Over identitu účtu, typicky cez Google userinfo a `sub`. Token drž len v pamäti.
5. Až potom vytvor `createSheetbase` a `createGoogleSheetsRemote`. Po expirácii tokenu aplikácia získa nový token z používateľského kliknutia a zavolá `db.resume()`.

Knižnica nevyžaduje client secret a nikdy ho nedávaj do prehliadača. Nevkladaj sem service-account private key. Zdrojový návrh neobsahuje `.env`, žiadne poverenia ani automatický login flow.

## Tabuľka

Vlastný existujúci spreadsheet súbor musí byť pre autorizovaný účet zapisovateľný. Na začiatok použite testovací súbor, nie jedinú kópiu dôležitých dát.

```ts
const journal = db.table({
  spreadsheetId: 'YOUR_TEST_FILE_ID',
  sheet: 'Journal', keyColumn: 'Date',
  columns: { pages: column.number('Pages') }
});
await journal.open({ create: true });
```

Toto povolenie vytvára iba chýbajúci list/hlavičku v uvedenom súbore. Existujúci neprázdny list s inou hlavičkou je odmietnutý. Prvá synchronizácia pridá skrytý interný list `_Sheetbase`. Preberanie existujúcich návykov alebo migrácia Fero Trackera nie sú implementované.

## Oficiálne podklady

- [Token model v prehliadači](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Sheets authorization scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [Sheets API quotas](https://developers.google.com/workspace/sheets/api/limits)
- [Batch update a súbežné zmeny](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)

SDK zdieľa limity Google služby. Pre aplikácie s mnohými súbežnými zapisovateľmi treba zvoliť jasnú konfliktovú politiku alebo databázu určenú na takú prevádzku.
