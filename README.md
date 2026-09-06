# Fakturace — Tulec Trend Foto

Statická fakturační aplikace s tiskem, PDF, QR platbou a serverovou historií posledních 10 faktur.

## Spuštění a nasazení

Hlavní soubor je `index.html`. Produkce: https://fakturace-tulec-trend-foto.netlify.app . Netlify nasazuje větev `main` repozitáře https://github.com/tomas-tulec/fakturace . Funkce jsou v `netlify/functions`; vyžadují Netlify Blobs a proměnnou `FAKTURA_TOKEN`. Hodnota tokenu nepatří do repozitáře.

## Stav k 6. 9. 2026

- Doplněno potvrzované mazání jednotlivých záznamů historie; čítač se nemění, stažená PDF se nemažou.
- Ověřena syntaxe pěti skriptů HTML a serverové funkce.
- Lokální simulované testy: kontrola tokenu, validace vstupu, přesné mazání, opakování při souběžném zápisu, opakované mazání a zachování ostatních faktur.
- Produkce vrací HTTP 200 a obsahuje tlačítko mazání. Faktura 260091 byla na výslovné přání odstraněna; odpověď serveru potvrzuje zachování ostatních devíti faktur i čítače.
- Ověřeno také chování potvrzení v simulovaném klientovi: zrušení nic neposílá, potvrzení maže přesné číslo bez načtení faktury do formuláře.
- Stávající Netlify Lambda kontext nepodporuje strong consistency. Používá se původní režim čtení a podmíněné zápisy s ETag; změny mohou při novém čtení mít prodlevu až 60 sekund.
- Stávající netrackované soubory zůstaly nedotčené. `fakturace.html` se touto změnou neupravuje; produkční vstup je `index.html`.

Další krok: uživatelská kontrola tlačítka Smazat v panelu Historie. Při staré verzi obnovit stránku. Stažená PDF nejsou mazáním historie dotčena.
