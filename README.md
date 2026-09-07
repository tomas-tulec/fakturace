# Fakturace — Tulec Trend Foto

Statická fakturační aplikace s tiskem, PDF, QR platbou a serverovou historií posledních 10 faktur.

## Spuštění a nasazení

Hlavní soubor je `index.html`. Produkce: https://fakturace-tulec-trend-foto.netlify.app . Netlify nasazuje větev `main` repozitáře https://github.com/tomas-tulec/fakturace . Funkce jsou v `netlify/functions`; vyžadují Netlify Blobs a proměnnou `FAKTURA_TOKEN`. Hodnota tokenu nepatří do repozitáře.

## Stav k 7. 9. 2026

- Opravena příčina dvojího zápisu stejné faktury pod dvěma čísly: opakované uložení PDF nebo následný tisk nyní zachovají již přidělené číslo. Nové číslo se přidělí až po použití tlačítka „Nová faktura“.
- Oprava je v commitu `d11452c` a byla odeslána na větev `main`. Syntaxe všech pěti skriptů v `index.html` prošla kontrolou; veřejné ověření zatím blokuje výpadek internetového připojení na pracovním počítači.
- V historii byla před opravou potvrzena duplicita paní Štaffové: správná faktura `260092` a chybná `260093`, obě na 1 000 Kč. Chybný záznam `260093` čeká na odstranění po obnovení připojení.
- Doplněno potvrzované mazání jednotlivých záznamů historie; čítač se nemění, stažená PDF se nemažou.
- Ověřena syntaxe pěti skriptů HTML a serverové funkce.
- Lokální simulované testy: kontrola tokenu, validace vstupu, přesné mazání, opakování při souběžném zápisu, opakované mazání a zachování ostatních faktur.
- Produkce vrací HTTP 200 a obsahuje tlačítko mazání. Faktura 260091 byla na výslovné přání odstraněna; ostatních devět faktur zůstalo zachováno.
- Čítač byl následně na výslovné přání jednorázově vrácen z 260092 na 260091. Živá funkce potvrdila 260091 jako další číslo a dočasná servisní možnost resetu byla z kódu opět odstraněna.
- Ověřeno také chování potvrzení v simulovaném klientovi: zrušení nic neposílá, potvrzení maže přesné číslo bez načtení faktury do formuláře.
- Stávající Netlify Lambda kontext nepodporuje strong consistency. Používá se původní režim čtení a podmíněné zápisy s ETag; změny mohou při novém čtení mít prodlevu až 60 sekund.
- Stávající netrackované soubory zůstaly nedotčené. `fakturace.html` se touto změnou neupravuje; produkční vstup je `index.html`.

Další krok: po obnovení připojení ověřit opravu ve veřejné aplikaci a odstranit z historie chybnou fakturu `260093`. Běžné smazání z historie čítač automaticky nevrací a stažená PDF nejsou mazáním dotčena.
