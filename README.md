# Fakturace — Tulec Trend Foto

Statická fakturační aplikace s tiskem, PDF, QR platbou, serverovou historií posledních 10 faktur a volitelným přímým uložením PDF na Google Disk.

## Spuštění a nasazení

Hlavní soubor je `index.html`. Produkce: https://fakturace-tulec-trend-foto.netlify.app . Netlify nasazuje větev `main` repozitáře https://github.com/tomas-tulec/fakturace . Funkce jsou v `netlify/functions`; vyžadují Netlify Blobs a proměnnou `FAKTURA_TOKEN`. Hodnota tokenu nepatří do repozitáře.

## Stav pracovní kopie k 5. 10. 2026

- Připraveno samostatné ukládání stejného PDF na Google Disk. Běžné tlačítko „Uložit PDF (do Stažených)“ zůstává nezávislé a nevyžaduje připojení Google.
- Google přihlášení používá pouze rozsah `drive.file`, kontroluje přesný účet `tulectrendfoto@gmail.com`, před uložením zobrazuje účet a složku a nemění sdílení souborů.
- Pro skutečnou fakturu se před vystavením zobrazuje souhrn. Export do zařízení, tisk i Disk používají jedno idempotentní přidělení čísla; změna obsahu již vystaveného čísla je odmítnuta.
- Čítač i rezervace souboru používají podmíněné zápisy s ETag. Současné pokusy z více zařízení nemohou úspěšně přidělit stejné další číslo dvěma různým fakturám.
- Testovací doklad `999001` používá pouze fiktivní údaje, výrazné označení „TEST – NEHRADIT“, neobsahuje QR platbu a nezapisuje se do číselné řady ani historie skutečných faktur.
- Lokálně prošlo 10 automatizovaných testů: bezpečný výchozí bod i starší číselný stav `260124` v simulovaném úložišti, idempotentní opakování, ochrana změněného obsahu, souběžné přidělení, historie, test `999001`, rezervace jednoho souboru na Disku a veřejná konfigurace bez aplikačního tokenu.
- V prohlížeči bylo ověřeno stažení testovacího PDF bez připojeného Googlu, responzivní rozložení při šířce 390 px a srozumitelná chyba při pokusu o Disk bez přihlášení. Vygenerované PDF má jednu stranu A4 a vizuálně prošlo kontrolou diakritiky a rozložení.
- Dne 5. 10. 2026 byl na účtu `tulectrendfoto@gmail.com` vytvořen samostatný Google Cloud projekt `fakturace-tulec-trend-foto` bez připojeného fakturačního účtu. Jsou zapnutá pouze potřebná Google Drive API a Google Picker API; OAuth je v režimu Testing s jediným testovacím uživatelem `tulectrendfoto@gmail.com` a rozsahem `drive.file`. Webový OAuth klient má jako povolený původ pouze produkční adresu aplikace. Picker API klíč je omezen na tuto adresu a jediné API.
- V Netlify jsou u existujícího projektu uložené proměnné `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_PICKER_API_KEY` a `GOOGLE_CLOUD_PROJECT_NUMBER`; první dvě jsou označené jako tajné. Netlify účet je na plánu Free bez uložené platební karty. Žádný klíč ani token není v tomto přehledu ani v repozitáři.
- Skutečné přihlášení, výběr složky a nahrání testovacího PDF na Google Disk zatím nebyly ověřeny: nové serverové funkce nejsou nasazené. Postup a zbývající kontrolní body jsou v `GOOGLE-DISK-NASTAVENI.md`.
- Produkční nasazení nebylo provedeno. Při čtení živé aplikace dne 5. 10. 2026 se ve formuláři po načtení zobrazilo číslo `999003`; nebyla vystavena ani uložena faktura. Uživatel si nastavení skutečného čísla provede následně sám přímo v aplikaci, proto zde číslování dále neřešíme. Produkční nasazení vyžaduje jeho výslovné schválení.

## Předchozí produkční stav k 7. 9. 2026

- Opravena příčina dvojího zápisu stejné faktury pod dvěma čísly: opakované uložení PDF nebo následný tisk nyní zachovají již přidělené číslo. Nové číslo se přidělí až po použití tlačítka „Nová faktura“.
- Oprava je v commitu `d11452c` a byla nasazena z větve `main`. Syntaxe všech pěti skriptů v `index.html` prošla kontrolou a veřejná aplikace byla 7. 9. 2026 znovu načtena s dalším číslem `260094`.
- V historii byla před opravou potvrzena duplicita paní Štaffové: správná faktura `260092` a chybná `260093`, obě na 1 000 Kč. Záznam `260093` byl 7. 9. 2026 odstraněn a nové načtení historie potvrdilo zachování `260092`.
- Čítač byl po odstranění chybného záznamu jednorázově vrácen z `260094` na `260093`. Živá aplikace potvrdila `260093` jako další číslo; dočasné servisní tlačítko i serverová metoda byly následně odstraněny.
- Doplněno potvrzované mazání jednotlivých záznamů historie; čítač se nemění, stažená PDF se nemažou.
- Ověřena syntaxe pěti skriptů HTML a serverové funkce.
- Lokální simulované testy: kontrola tokenu, validace vstupu, přesné mazání, opakování při souběžném zápisu, opakované mazání a zachování ostatních faktur.
- Produkce vrací HTTP 200 a obsahuje tlačítko mazání. Faktura 260091 byla na výslovné přání odstraněna; ostatních devět faktur zůstalo zachováno.
- Čítač byl následně na výslovné přání jednorázově vrácen z 260092 na 260091. Živá funkce potvrdila 260091 jako další číslo a dočasná servisní možnost resetu byla z kódu opět odstraněna.
- Ověřeno také chování potvrzení v simulovaném klientovi: zrušení nic neposílá, potvrzení maže přesné číslo bez načtení faktury do formuláře.
- Stávající Netlify Lambda kontext nepodporuje strong consistency. Používá se původní režim čtení a podmíněné zápisy s ETag; změny mohou při novém čtení mít prodlevu až 60 sekund.
- Stávající netrackované soubory zůstaly nedotčené. `fakturace.html` se touto změnou neupravuje; produkční vstup je `index.html`.

Další krok pro integraci Disku: v izolovaném náhledu provést přihlášení a nahrání výhradně testovacího PDF na firemní Disk. Produkční nasazení čeká na samostatné schválení. Uživatel si skutečné číslo následně upraví sám přímo v aplikaci. Běžné smazání z historie čítač automaticky nevrací a stažená PDF nejsou mazáním dotčena.
