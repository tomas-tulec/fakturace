# Fakturace — Tulec Trend Foto

Statická fakturační aplikace s tiskem, PDF, QR platbou a serverovou historií posledních 10 faktur.

## Spuštění a nasazení

Hlavní soubor je `index.html`. Produkce: https://fakturace-tulec-trend-foto.netlify.app . Netlify nasazuje větev `main` repozitáře https://github.com/tomas-tulec/fakturace . Funkce jsou v `netlify/functions`; vyžadují Netlify Blobs a proměnnou `FAKTURA_TOKEN`. Hodnota tokenu nepatří do repozitáře.

## Stav k 6. 9. 2026

- Doplněno potvrzované mazání jednotlivých záznamů historie; čítač se nemění, stažená PDF se nemažou.
- Ověřena syntaxe pěti skriptů HTML a serverové funkce.
- Lokální simulované testy: kontrola tokenu, validace vstupu, přesné mazání, opakování při souběžném zápisu, opakované mazání a zachování ostatních faktur.
- V produkční historii ověřena přítomnost faktury 260091. Její odstranění a ověření nasazení zatím čeká.
- Stávající netrackované soubory zůstaly nedotčené. `fakturace.html` se touto změnou neupravuje; produkční vstup je `index.html`.

Další krok: nasadit změnu, odstranit schválenou duplicitu 260091 a ověřit živý výsledek.
