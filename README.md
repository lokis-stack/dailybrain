# DailyBrain

Osobni learning Telegram bot, ktery ti 3x denne posila zajimave fakty a vecer kviz. Bezi zdarma na GitHub Actions a Turso databazi. Zadny server, zadne naklady.

Bot se postupne uci tvoje preference — hodnotis fakty 1-10 a on ti pak posila vic toho, co te bavi. Kvizy pouzivaji spaced-repetition system (Leitner), takze se k informacim vracis v optimalnim intervalu.

Fakty generuje Gemini AI v cestine. Bot je solo — funguje jen pro jeden hardcoded Telegram chat, ostatni uzivatele ignoruje.

## Jak to zprovoznit

### Predpoklady

Potrebujes mit pripravene:
- **Telegram Bot Token** — vytvoris pres [@BotFather](https://t.me/BotFather) v Telegramu
- **Telegram Chat ID** — posli botovi zpravu a zjisti ID pres `https://api.telegram.org/bot<TOKEN>/getUpdates`
- **Gemini API Key** — ziskej na [Google AI Studio](https://aistudio.google.com/apikey)
- **Turso databaze** — registruj se na [turso.tech](https://turso.tech), vytvor databazi a ziskej URL + auth token
- **GitHub repo** — tento projekt pushnuty do GitHub repozitare

### Krok za krokem

1. **Pushni kod do GitHub repozitare**
   ```
   git add .
   git commit -m "Initial DailyBrain setup"
   git push
   ```

2. **Nastav GitHub Secrets**
   Jdi do repozitare na GitHubu → Settings → Secrets and variables → Actions → New repository secret.
   Pridej tyto secrety:
   - `TELEGRAM_BOT_TOKEN` — token z BotFathera
   - `TELEGRAM_CHAT_ID` — tvoje chat ID (cislo)
   - `GEMINI_API_KEY` — API klic z Google AI Studio
   - `TURSO_DATABASE_URL` — URL tvoji Turso databaze (zacina na `libsql://`)
   - `TURSO_AUTH_TOKEN` — auth token z Turso

3. **Spust workflow poprve rucne**
   Jdi do repozitare → Actions → "DailyBrain Tick" → "Run workflow" → zelene tlacitko.
   Tohle inicializuje databazi a zacne posilat fakty.

4. **Posli botovi `/start`**
   Otevri chat s botem v Telegramu a posli `/start`. Mel bys dostat uvitaci zpravu.

## Jak overit ze to bezi

- V GitHub Actions uvidis workflow "DailyBrain Tick" bezici kazdych 10 minut
- Klikni na posledni beh a zkontroluj logy — mel bys videt "Zadny aktivni slot" nebo "Fact odeslán"
- V Telegramu posli `/stats` a bot ti odpovi statistikami
- Prvni fact prijde v nejblizsim slotu (9:00, 12:00, 15:00 nebo 20:00 praskeno casu)

## Rozvrh

| Cas (Praha) | Co se deje |
|---|---|
| 09:00 | Novy fact |
| 12:00 | Novy fact |
| 15:00 | Novy fact |
| 20:00 | Kviz (nebo fact pokud neni z ceho) |
| Nedele 20:30 | Tydenni statistika |

## Jak vypnout / zapnout

- **Vypnout**: Jdi do repozitare → Actions → "DailyBrain Tick" → tri tecky vpravo nahore → "Disable workflow"
- **Zapnout**: Stejne misto → "Enable workflow"

## Troubleshooting

**Bot neposila zpravy**
- Zkontroluj ze jsou vsechny GitHub Secrets spravne nastavene
- Podivej se do Actions logu — cervene behy znamenaji chybu
- Over ze `TELEGRAM_CHAT_ID` je spravne cislo (muze byt i zaporne pro skupiny)

**Zpravy chodi pozdni**
- GitHub Actions cron neni uplne presny — muze byt zpozdeni az 10-15 minut
- Workflow bezi kazdych 10 minut a kontroluje cas v Europe/Prague — drobne zpozdeni je normalni

**Kviz neprichazi**
- Kviz se posila az kdyz mas aspon jeden ohodnoceny fact starsi 3 dnu
- Prvni dny bude chodit fact misto kvizu — to je v poradku

**Chyba "Gemini API"**
- Over ze `GEMINI_API_KEY` je platny
- Free tier ma limity — pokud jsi je precerpal, pockej do dalsiho dne

**Bot nereaguje na tlacitka**
- Tlacitka se zpracovavaji az pri dalsim ticku (max 10 minut)
- Tohle neni real-time webhook, ale polling kazdych 10 minut
