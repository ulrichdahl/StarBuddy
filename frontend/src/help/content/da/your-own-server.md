# StarBuddy til din Discord-server

Hver StarBuddy-installation hører til præcis én Discord-server. Kun medlemmer af den server kan logge ind, dens bot skriver i den servers kanaler, og org'er, lager og point bliver i det fællesskab. Vil du bruge StarBuddy med din egen Discord-server, kører du din egen installation.

StarBuddy er fri software under GNU AGPL-3.0. Enhver ejer af en Discord-server må installere den, køre den og koble den til sin server, gratis og uden at spørge nogen. Dine medlemmers data bliver på din egen maskine.

## Hvad en StarBuddy-installation er koblet til

| Indstilling | Hvad den bestemmer |
| --- | --- |
| Din Discord-servers id | Hvem der må logge ind: medlemmer af den server, ingen andre |
| Din egen Discord-applikation og bot | Log ind med Discord, slash-kommandoer og advarsler i dine kanaler |
| Din hjemmesides adresse | Hvor dine medlemmer logger ind, og hvad de parrer desktop-klienten med |

Desktop-klienten er den samme for alle installationer. Dine medlemmer downloader den og parrer den med din hjemmesides adresse.

## Det skal du bruge

- En Linux-server med Docker og Docker Compose, eller en platform som Coolify.
- Et domæne med HTTPS foran.
- En Discord-server, hvor du er administrator.

## Sådan sætter du den op

1. **Opret en Discord-applikation** i Discords udviklerportal. Notér dens application id, client id og secret, og tilføj log ind-adressen `https://dit-domæne/api/auth/discord/callback`. Opret dens bot, hold den privat, og invitér den til din server.
2. **Kopiér din servers id:** slå udviklertilstand til i Discord, højreklik på serveren og vælg *Kopiér server-id*.
3. **Hent StarBuddy** fra GitHub og udfyld dens indstillingsfil: dit domæne, Discord-oplysningerne og din servers id.
4. **Start den**, kør opsætningen, der kun skal køres én gang, og log ind med Discord for at se, at det virker.
5. **Opret jeres org'er:** en administrator på Discord-serveren kører `/starbuddy org create` og `/starbuddy org manager` i Discord. Medlemmerne anmoder så om at blive medlem på hjemmesiden, og managerne godkender dem.

Den fulde vejledning med alle kommandoer er [HOSTING.md på GitHub](https://github.com/ulrichdahl/StarBuddy/blob/main/HOSTING.md) (på engelsk).

## Valgfrit

- **Server-advarsler:** en kanal, hvor botten skriver RSI's meddelelser om vedligehold og nedbrud, så snart de kommer, så spillerne når at parkere deres skibe.
- **Raffinaderi-beskeder:** en kanal, der får besked, når et medlems raffinaderiordre er færdig.
- **Indkøbslister:** en kanal, medlemmerne kan sende deres [Indsamling](gathering)-liste til.
- **Testere:** en Discord-rolle, hvis medlemmer kan se [Scanningstræning](training).

## Opdateringer

StarBuddy kan opdatere sig selv hver nat: et script henter den nye version, tager først en sikkerhedskopi af databasen og genstarter. På Coolify bliver en ny udgivelse sat i drift af sig selv.

Spørgsmål? Spørg på GitHub eller på United Danes' Discord.
