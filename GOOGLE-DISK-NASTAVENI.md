# Nastavení ukládání faktur na Google Disk

Tento postup používá pouze Google Drive API a stávající Netlify Free. Aplikace žádný přístupový token neukládá do repozitáře, URL ani trvalého úložiště prohlížeče. Token zůstává pouze v paměti otevřené stránky a po vypršení je nutné účet znovu připojit. Složku aplikace vytváří jako soukromou složku na firemním Disku; sdílení nemění.

## 1. Google Cloud projekt a API

1. Přihlaste se do Google Cloud Console účtem `tulectrendfoto@gmail.com`.
2. Vytvořte samostatný projekt, například `Fakturace Tulec Trend Foto`.
3. V projektu povolte Google Drive API. Google Picker API ani API klíč nejsou pro aktuální verzi potřeba.

## 2. Souhlas OAuth

1. V části Google Auth Platform nastavte název aplikace `Fakturace Tulec Trend Foto`.
2. Jako kontaktní a podpůrný e-mail použijte `tulectrendfoto@gmail.com`.
3. Typ uživatelů nastavte na **External**, protože jde o běžný účet Gmail.
4. Přidejte pouze rozsah:
   - `https://www.googleapis.com/auth/drive.file`
5. Pro první neveřejné ověření ponechte aplikaci v režimu Testing a jako testovacího uživatele přidejte pouze `tulectrendfoto@gmail.com`.
6. Účet `tomas761975@gmail.com` nepřidávejte mezi testovací uživatele ani jej nepoužívejte při přihlášení.

Rozsah `drive.file` dovoluje aplikaci pracovat se soubory a složkami, které sama vytvoří. Kvůli tomuto úzkému oprávnění aplikace nenabízí libovolné dřívější složky na Disku; vybírá se z vlastních složek aplikace. Aplikace nežádá plný přístup k celému Disku a nemění sdílení souborů.

## 3. OAuth Client ID

1. Vytvořte OAuth Client ID typu **Web application**.
2. Do Authorized JavaScript origins vložte přesně:
   - `https://fakturace-tulec-trend-foto.netlify.app`
3. Pro případné lokální ověřování přes Netlify CLI lze později přidat také přesný lokální origin, například `http://localhost:8888`. Nepřidávejte jej, pokud ho nebudete používat.
4. Redirect URI není pro použitý Google Identity Services token model potřeba.
5. Zkopírujte Client ID. Klientské tajemství se v této aplikaci nepoužívá a nikam se nevkládá.

## 4. Proměnné prostředí v Netlify

V nastavení existujícího webu Netlify je potřeba jediná proměnná pro Google přihlášení. Její skutečnou hodnotu nevkládejte do zdrojových souborů ani do chatu.

| Název | Hodnota |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Client ID končící na `.apps.googleusercontent.com` |

Dříve nastavené proměnné `GOOGLE_PICKER_API_KEY` a `GOOGLE_CLOUD_PROJECT_NUMBER` nejsou po bezpečnostní opravě používány ani vraceny do prohlížeče. Omezený API klíč a Google Picker API lze po ověření této verze odstranit v Google Cloud Console; není to podmínka používání aplikace.

Stávající `FAKTURA_TOKEN` zachovejte beze změny. Po vložení proměnných je nutné provést nové nasazení, aby je serverové funkce načetly.

## 5. Kontrola funkce

1. Připojte pouze účet `tulectrendfoto@gmail.com`.
2. Tlačítkem výběru složky vytvořte soukromou složku aplikace nebo vyberte dříve vytvořenou složku aplikace.
3. Zkontrolujte, že rozhraní před uložením zobrazuje tento účet a zvolenou složku.
4. Nahrajte nejprve výhradně testovací PDF `TEST_Faktura_999001_NEHRADIT.pdf`.
5. Na Disku otevřete soubor a ověřte fiktivní údaje, označení `TEST – NEHRADIT` a absenci QR platby.
6. Opakujte testovací export a potvrďte, že se nevytvořil druhý soubor.
7. Odpojte Google Disk a ověřte srozumitelnou výzvu k novému připojení. Běžné stažení musí zůstat dostupné.

Uložení na Disk ani běžné stažení neposílá e-mail, pozvánku ani nemění kalendář. Skutečná faktura se vystaví až po zobrazení souhrnu a výslovném potvrzení uživatele.
