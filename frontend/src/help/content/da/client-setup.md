# Installér og par klienten

StarBuddys desktop-klient kører ved siden af Star Citizen på Windows og Linux. Den:

- læser spillets `Game.log` og sender nye blueprints, færdige missioner, raffinaderijob og rejser til StarBuddy, og det er derfra, din orgs point kommer;
- læser raffinaderiordrer og minescanninger fra skærmen, på din egen maskine;
- viser små vinduer over spillet: serverstatus, dine raffinaderiordrer, din indkøbsliste og mere.

## 1. Installér

Log ind på hjemmesiden. Brug **Kom i gang** på oversigten, eller åbn dit navn øverst til højre og vælg `Profil & desktopklient`. Download-knappen vælger filen til dit system: `Download til Windows`, eller til Linux AppImage (deb eller rpm på distributioner, der bruger dem). De andre filer står under den. Installér og start den.

Knappen `Desktopklient` i topbjælken har en orange prik, indtil en af dine klienter er forbundet.

Klienten søger selv efter opdateringer og tilbyder at installere dem. Se [Indstillinger](client-settings).

## Første start

![Opsætningen ved første start](screens/client-setup.jpg)

Første gang du starter den, fører klienten dig gennem fire trin, ét kort ad gangen: `Log ind`, `Find Game.log`, `Vælg spillets vindue` og `Prøv en genvejstast`. Hvert trin kan springes over, og `Spring opsætningen over. Alt findes i Indstillinger.` går ud med det samme. Det sidste kort viser, hvad der er sat op, og hvad du sprang over. En org er valgfri: StarBuddy virker også for en solospiller.

Kør den igen når som helst under `Indstillinger` › `Generelt` › **Opsætning** › `Kør opsætning igen`.

## 2. Log ind

![Log ind med browseren](screens/client-sign-in-browser.jpg)

1. I opsætningen, eller under `Indstillinger` › `Generelt` › **Server**: tjek adressen (den er udfyldt), og tryk `Log ind med browser`.
2. Din browser åbner hjemmesiden. Log ind med Discord, hvis den beder om det.
3. Tjek, at siden viser samme kode som klienten, og tryk `Forbind`.

Klienten viser så **Parret som** med dit navn. Koden virker i 10 minutter. `Åbn siden igen` åbner den igen, hvis du lukkede den. Fjern parringen under **Server**, eller fjern enheden på hjemmesiden.

**Med en parringskode i stedet:** tryk `Indtast en parringskode i stedet` i klienten. Tryk `Generér parringskode` under `Profil & desktopklient` på hjemmesiden, skriv så adressen og koden i klienten, og tryk `Par`.

![Indstillinger › Generelt i klienten](screens/client-settings-general.jpg)

## 3. Peg den på spillet

![Indstillinger › Spilinstallation](screens/client-settings-game.jpg)

Åbn `Indstillinger` › `Spilinstallation`. Klienten finder selv den sædvanlige installation. Gør den ikke, så tryk `Find din installation…` og vælg mappen `StarCitizen` eller én kanal i den (`LIVE`, `PTU`).

- `Scan loghistorik` læser de gamle logs én gang, så de blueprints, du allerede har fået, kommer med.
- `Start overvågning` følger `Game.log`, mens du spiller. Nye hændelser sendes, når de sker.

## 4. Skriv dit handle

Sørg for, at dit Star Citizen-handle står i din [profil](profile) på hjemmesiden. Kun hændelser fra dine egne karakterer giver point.

Næste: [Klientens Hjem-side](client-home).
