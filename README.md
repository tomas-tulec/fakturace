# Fakturace — Tulec Trend Foto

Statická fakturační aplikace s tiskem, PDF, QR platbou, serverovou historií faktur za aktuální rok a volitelným přímým uložením PDF na Google Disk.

## Místní úprava oprav faktur a roční historie k 8. 10. 2026

- Otevřenou fakturu lze opravit a znovu uložit jako PDF, vytisknout nebo exportovat na Google Disk pod původním číslem. Nová faktura se stejným číslem zůstává odmítnuta. Oprava ukládá jméno osoby, čas a změněné údaje; v běžné historii se zobrazuje jen aktuální podoba.
- Nově vystavené faktury se ukládají jednotlivě, bez limitu posledních deseti záznamů. Historie zobrazuje faktury s datem vystavení v aktuálním roce. Nejvýše deset starších záznamů, které jsou dosud ve starém úložišti, zůstává dostupných; dříve vytlačené záznamy změna neobnoví.
- Opravený export na Google Disk používá stejné ID souboru a aktualizuje jeho obsah. Starší místní stažená PDF aplikace nemaže. Skutečný export opravené faktury na Disk dosud nebyl ověřen.
- Čítač při určení dalšího čísla zohledňuje i nové jednotlivé záznamy, aby řada zůstala zachována po omezení starého seznamu přidělení.
- Dne 8. 10. 2026 prošlo 17 místních testů na fiktivních údajích, kontrola syntaxe pěti vložených skriptů a tří upravených serverových funkcí. Test skutečné faktury ani produkčního Google Disku se neprováděl.
- Úprava vznikla v oddělené pracovní kopii `C:\Users\tulec\Documents\Codex\2026-10-08\referenced-chatgpt-conversation-this-is-an\work\fakturace-edit` a commitem `64b7c5f` byla 8. 10. 2026 přenesena do hlavní místní složky na větev `main`. Nasazení do produkce zbývá po samostatném schválení a ověření.

## Místní oprava číselné řady k 6. 10. 2026

- Živý formulář před opravou zobrazoval `999003`, zatímco nejvyšší skutečně uložená faktura v historii byla `260124`. Stav byl ověřen v produkční aplikaci bez vystavení faktury.
- Místní serverová funkce nyní určuje další číslo z historie, platných přidělení a skutečného čítače. Testovací čítač řady `999xxx` ignoruje; navazující číslo je `260125` a po přidělení následují `260126`, `260127`.
- Ruční přidělení čísla z testovací řady `999xxx` je v místní úpravě odmítnuto. Samostatný testovací export `999001` zůstává oddělený.
- Dne 6. 10. 2026 prošlo všech 12 místních testů včetně simulace zjištěného stavu `999003` a historie `260124`. Oprava byla nasazena z větve `main` v commitu `6497400`.
- Nově načtený živý formulář dne 6. 10. 2026 zobrazil `260125` v poli čísla faktury i v náhledu. Žádná skutečná faktura při kontrole nebyla vystavena.
- Další krok: běžně vystavit první fakturu po kontrole údajů; číslo `260126` se živě ověří až po jejím skutečném přidělení.

## Kontrola Google Disku k 6. 10. 2026

- V živém formuláři tlačítko „Uložit PDF na Google Disk“ bez připojeného účtu zobrazilo výzvu k připojení a výběru složky. Po připojení povoleného účtu a výběru existující složky otevřelo správný potvrzovací souhrn. Ten byl zrušen; skutečná faktura nebyla vystavena a další číslo zůstalo `260125`.
- Bezpečný testovací export na Disk neprošel: rezervovaný soubor `TEST_Faktura_999001_NEHRADIT.pdf` se nachází od 5. 10. 2026 v koši firemního Disku, zatímco cílová složka je prázdná. Aplikace odmítla použít rezervaci pro soubor mimo cílovou složku. Žádný soubor nebyl obnoven ani nově nahrán.
- Uživatel potvrdil, že testovací PDF vložil do koše záměrně; soubor se neobnovuje. Testovací export není součástí běžné číselné řady. Uložení skutečné faktury na Disk nebylo při této kontrole provedeno; pro ověření této poslední části je nutné pracovat s konkrétní skutečnou fakturou a jejím potvrzením.
- Schválená úprava v commitu `561f186` zobrazuje hlášení Google Disku také přímo pod tlačítkem pro uložení skutečné faktury. Dne 6. 10. 2026 prošlo 12 místních testů a kontrola syntaxe pěti skriptů. Na živé stránce bylo po kliknutí bez připojeného Disku vizuálně ověřeno upozornění přímo pod tlačítkem; číslo zůstalo `260125`.

## Spuštění a nasazení

Hlavní soubor je `index.html`. Produkce: https://fakturace-tulec-trend-foto.netlify.app . Netlify nasazuje větev `main` repozitáře https://github.com/tomas-tulec/fakturace . Funkce jsou v `netlify/functions`; vyžadují Netlify Blobs a proměnnou `FAKTURA_TOKEN`. Hodnota tokenu nepatří do repozitáře.

## Stav produkce a pracovní kopie k 5. 10. 2026

- Připraveno samostatné ukládání stejného PDF na Google Disk. Běžné tlačítko „Uložit PDF (do Stažených)“ zůstává nezávislé a nevyžaduje připojení Google.
- Google přihlášení používá pouze rozsah `drive.file`, kontroluje přesný účet `tulectrendfoto@gmail.com`, před uložením zobrazuje účet a složku a nemění sdílení souborů.
- Pro skutečnou fakturu se před vystavením zobrazuje souhrn. Export do zařízení, tisk i Disk používají jedno idempotentní přidělení čísla; změna obsahu již vystaveného čísla je odmítnuta.
- Čítač i rezervace souboru používají podmíněné zápisy s ETag. Současné pokusy z více zařízení nemohou úspěšně přidělit stejné další číslo dvěma různým fakturám.
- Testovací doklad `999001` používá pouze fiktivní údaje, výrazné označení „TEST – NEHRADIT“, neobsahuje QR platbu a nezapisuje se do číselné řady ani historie skutečných faktur.
- Lokálně prošlo 10 automatizovaných testů: bezpečný výchozí bod i starší číselný stav `260124` v simulovaném úložišti, idempotentní opakování, ochrana změněného obsahu, souběžné přidělení, historie, test `999001`, rezervace jednoho souboru na Disku a veřejná konfigurace bez aplikačního tokenu.
- V prohlížeči bylo ověřeno stažení testovacího PDF bez připojeného Googlu, responzivní rozložení při šířce 390 px a srozumitelná chyba při pokusu o Disk bez přihlášení. Vygenerované PDF má jednu stranu A4 a vizuálně prošlo kontrolou diakritiky a rozložení.
- Dne 5. 10. 2026 byl na účtu `tulectrendfoto@gmail.com` vytvořen samostatný Google Cloud projekt `fakturace-tulec-trend-foto` bez připojeného fakturačního účtu. Google Drive API je zapnuté; OAuth je v režimu Testing s jediným testovacím uživatelem `tulectrendfoto@gmail.com` a rozsahem `drive.file`. Webový OAuth klient má jako povolený původ pouze produkční adresu aplikace.
- Původní Google Picker byl při živém testu shledán nevhodným, protože předával přístupový token v adrese vloženého okna. Dne 5. 10. 2026 jej nahradil vlastní výběr složek vytvořených aplikací; požadavky na Drive API posílají token jen v autorizační hlavičce. Konfigurační funkce již do prohlížeče nevrací API klíč ani číslo projektu. Dříve vytvořený omezený Picker klíč a zapnuté Picker API již aplikace nepoužívá.
- V Netlify zůstává použitý `GOOGLE_OAUTH_CLIENT_ID`; starší proměnné `GOOGLE_PICKER_API_KEY` a `GOOGLE_CLOUD_PROJECT_NUMBER` jsou nepoužívané. Netlify účet je na plánu Free bez uložené platební karty. Žádný klíč ani token není v tomto přehledu ani v repozitáři.
- Produkční verze v commitech `8a41cd0` a `5e9dbb2` byla 5. 10. 2026 nasazena. V Chrome na tomto počítači bylo skutečně ověřeno přihlášení pouze účtem `tulectrendfoto@gmail.com`, vytvoření soukromé složky `Faktury Tulec Trend Foto`, přímé nahrání fiktivního testovacího PDF a jeho otevření na Disku. Náhled ukázal jednu stranu, fiktivního dodavatele i odběratele, označení `TEST – NEHRADIT`, českou diakritiku a `BEZ QR PLATBY`; Drive zobrazil `Soukromé pouze pro mě`.
- Opakovaný testovací export vrátil stejný odkaz na soubor. V nové relaci bez připojeného Googlu se zobrazila srozumitelná výzva k připojení a nezávislé stažení testovacího PDF vytvořilo soubor v místní složce Stažené. Skutečné vypršení tokenu, mobilní telefon ani ChatGPT Work Cloud nebyly přímo otestovány.
- Žádná skutečná faktura nebyla v rámci těchto testů vystavena ani odeslána. Uživatel si aktuální skutečné číslo upraví sám přímo v aplikaci; zde jej dále neřešíme. Postup používání a nastavení je v `GOOGLE-DISK-NASTAVENI.md`.

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

Další krok: uživatel může aplikaci používat; před první skutečnou fakturou upraví požadované číslo a zkontroluje souhrn. Pro mobil a ChatGPT Work Cloud doporučujeme provést samostatný test bez vystavení skutečné faktury. Běžné smazání z historie čítač automaticky nevrací a stažená PDF nejsou mazáním dotčena.
