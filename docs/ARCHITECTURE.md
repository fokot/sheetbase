# Architektúra a rozhodnutia

## Zámer

Oddeliť všeobecné správanie dátového klienta od React komponentov a konkrétneho trackera. Nová knižnica nie je kópiou jeho obchodnej logiky. Nepozná návyk, tréning, deň ani sériu. Pozná schému stĺpcov, textový kľúč, lokálnu operáciu a vzdialené potvrdenie.

```text
Aplikácia / OAuth / UI
         │
  SheetbaseClient + SheetTable
      ┌──┴────────────┐
   Storage          Remote
   IndexedDB        Google Sheets
   alebo memory     alebo simulácia
```

Jadro nemá runtime závislosti. Typy buniek tvoria explicitnú hranicu medzi aplikáciou a textom v Sheete. Pri prípadnom budúcom zapojení trackera by jeho UI aj kódovanie sérií zostali v aplikácii. V tomto návrhu sa tracker nemení.

## Lokálny record

Verzia formátu `1` obsahuje:

- identitu namespace + account ID + spreadsheet ID + názov listu;
- fingerprint hlavičky, polí, typov a verzií kodekov;
- `base`: posledný načítaný/potvrdený obsah registrovaných buniek;
- `operations`: absolútne lokálne zmeny s UUID;
- `batch`: nemenné ID dávky a zoznam operácií, ktoré mohol server už prijať;
- monotónne `revision`, stav inicializácie, timestamp a poslednú chybu synchronizácie.

Projekcia pre UI je `apply(base, operations)`. Čistá funkcia odstráni záznam zo zobrazenia, ak všetky registrované hodnoty zostanú prázdne. Lokálny record neobsahuje prihlasovací token ani funkcie kodekov.

`Storage.update` musí byť atomická transakcia read → reducer → write a splniť promise až po commite. Reducer je synchronný. IndexedDB túto hranicu realizuje jednou readwrite transakciou. Memory adaptér serializuje zmeny promise frontou. Odberatelia dostanú oznámenie až po zápise; revízie bránia spätnému prepisu novšieho stavu starším callbackom.

## Od kliknutia po acknowledgement

1. `set` skontroluje polia a prevedie hodnoty na text.
2. Transakcia načíta aktuálny record a spojí neodoslané zmeny rovnakého kľúča. Hodnoty z neskoršieho patchu vyhrajú, ostatné polia zostanú zachované.
3. Promise lokálneho uloženia sa splní; UI môže zobraziť nový stav.
4. Plánovač počká 650 ms (konfigurovateľné) a spustí odosielanie.
5. Pod zámkom sa zmrazí najviac 100 operácií do dávky s UUID. Už zmrazené operácie sa pri nových zápisoch nemenia.
6. Google adaptér načíta aktuálne hlavičky, kľúče a potvrdenia. Overí schému a jedinečnosť kľúčov. Historické hodnoty pri bežnom zápise nečíta.
7. Zmenené bunky a receipt sa zapíšu v jednej Sheets batch operácii. Nové kľúče používajú serverové append, aby neprepísali koncové poznámky s prázdnym kľúčom.
8. Lokálny acknowledgement aplikuje iba odoslané operácie do base a odstráni ich ID. Zmeny urobené počas requestu zostanú vo fronte a prejdú do ďalšej dávky.

Pri stratenej odpovedi dávka ostane zmrazená. Ďalší pokus najprv vyhľadá receipt. Ak existuje a patrí rovnakému listu, neopakuje zápis. Je to ochrana retry protokolu; nie všeobecná distribuovaná transakcia medzi zariadeniami.

## Oprávnenia a životný cyklus

Identita účtu klienta je po vytvorení nemenná. Google adaptér pred/po requeste porovná účet a token z pasívneho provideru. Aplikácia musí overiť Google `sub` pri získaní tokenu; knižnica nevie overiť tvrdenie aplikácie bez ďalšieho identity flow. Na token neukazuje žiadny uložený record.

`pause`/`dispose` zvyšuje generáciu klienta. Rozpracované kroky pred zápisom alebo lokálnym ackom kontrolujú túto generáciu. Už odoslaný request sa môže na Googli dokončiť; nemení to potrebu ponechať lokálny batch pre neskoršie bezpečné potvrdenie.

Zámok tabuľky serializuje čítanie a synchronizáciu medzi klientmi používajúcimi rovnaký storage. Zámok súboru koordinuje tabuľky toho istého súboru a vytváranie spoločného ledgeru. `set()` zámok siete nepotrebuje — používa atomický storage update a môže prebehnúť počas requestu.

## Obmedzenia zámerne ponechané otvorené

- Kľúč je vždy stĺpec A; čítanie bez hlavičky a ľubovoľné relačné dotazy nie sú podporované.
- Schéma má fingerprint, ale migračný protokol zatiaľ nie. SDK chybu neskrýva vymazaním cache.
- Žiadne fyzické mazanie riadkov. Dynamické zmeny stĺpcov sú explicitné; staré formáty konvertuje aplikácia cez `table.import()`.
- Automatické opakované pokusy sú konečné; bežná chyba 400/schema nie je dôvod na nekonečný retry.
- IndexedDB synchronizácia používa Web Locks alebo obnovované leases v store `leases` (verzia databázy 2).
- Zámky nefungujú medzi nezávislými zariadeniami. Súbežná zmena štruktúry medzi index read a zápisom zostáva konfliktom.
- Žiadne serverové tajomstvá, proxy, analytika, OAuth UI alebo publikovaný endpoint.

Pred produkčným použitím treba doplniť zvolenú stratégiu migrácií, kontraktové testy proti vyhradenej živej tabuľke a overenie konkrétnych prehliadačov. Dokumentačná ukážka overuje lokálny IndexedDB tok bez prístupu k účtu používateľa.
