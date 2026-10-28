# Samostatné testovanie

```sh
npm ci
npm test
node examples/basic.mjs
```

Testy importujú zostavený balík z `dist/index.js`. `npm test` pred nimi zostaví TypeScript, takže netestujú inú implementáciu než tú, ktorú používa HTML ukážka. TypeScript príklady sa kontrolujú osobitne cez `npm run typecheck:examples`.

Aktuálne prechádza **29 automatických testov** plus TypeScript kontrola príkladov.

## Pokrytie

`tests/client.test.mjs` preveruje typy buniek, null/false/zero, lokálnu projekciu, spájanie patchov, perzistenciu cez nového klienta, zmrazenú dávku, stratenej odpovede, zápisy počas requestu, chybu úložiska, izoláciu účtov, fingerprint schémy, zatvorenie klienta, delete, refresh s lokálnou frontou, špeciálne kľúče a dva klienty s jedným storage.

`tests/google.test.mjs` používa simulovaný HTTP Sheets server. Overuje formát requestov, Bearer token, skrytý ledger v tej istej dávke, zachovanie cudzích buniek, čerstvé indexy po presunutí riadkov, koncové poznámky, opakovaný request po stratenej odpovedi, chyby servera, účet zmenený pred/po requeste, neplatnú schému, duplicitné kľúče, apostrofy v A1 rozsahoch a obmedzený rozsah načítaných dát.

Fixture aplikuje celý batch na kópiu stavu. Až po úspešnej aplikácii ho potvrdí. Režim „lost response“ najprv uloží dáta aj receipt, až potom vyhodí sieťovú chybu.

## Čo tieto testy nepotvrdzujú

Mockované Google API nie je certifikácia správania živej služby. Živé integračné testy nie sú nastavené a nevyužívajú žiadne tvoje súbory. Memory storage nepotvrdzuje všetky implementačné detaily IndexedDB; tie sa navyše skúšajú cez HTML ukážku v prehliadači.

## Automatické buildy

GitHub Actions spúšťa rovnaké testy pri pushi aj pull requeste. Workflow kontroluje, že pribalený `dist/` zodpovedá zdrojom, a odovzdá ho ako artefakt. Pages zostaví obe jazykové verzie a vykreslí Markdown do HTML. Release workflow pre tag `vX.Y.Z` vytvorí inštalovateľný `.tgz`; do npm registry nič neposiela.

`npm run build:docs && npm run test:docs` kontroluje obe jazykové verzie, lokálne odkazy a syntax highlighting.

## Ručná skúška v HTML

1. Spusť `npm run docs`, otvor vypísanú lokálnu adresu.
2. Zapni Offline, pridaj strany a prepnúť prechádzku.
3. Skontroluj lokálnu tabuľku a počet čakajúcich zmien. Simulovaný Sheet sa nemení.
4. Klikni Znova otvoriť alebo obnov stránku. Lokálne dáta a fronta zostanú.
5. Vráť Online a synchronizuj. Oba pohľady sa zhodnú a fronta sa vyprázdni.
6. V rozšírených testoch priprav stratenú odpoveď, urob ďalšiu zmenu a synchronizuj. Prvý pokus nechá dávku vo fronte; druhý ju potvrdí bez duplicitného záznamu.
7. Otestuj úzky mobilný viewport a klávesnicové ovládanie tabov.

Ukážka uchová testovací backend lokálne cez checkpoint memory adaptéra. Skutočná Google integrácia v nej nie je zapnutá. Obnoviť testovacie dáta vymaže len databázu ukážky `sheetbase-docs-v1` a jej vlastné pomocné kľúče.
