# Positionsfyr i klienten

**Eksperimentelt.** Klienten kan læse, hvor du er i spillet, og føre dig tilbage til et sted, du har markeret, som en GPS i bilen. Et markeret sted er et *positionsfyr*.

## Før du går i gang

1. Åbn konsollen i spillet med `` ` `` og skriv `r_DisplayInfo 1`, eller lad klienten tilføje det til `user.cfg` (se *Spilindstillinger* nedenfor). Debugteksten i hjørnet skal vise `Zone`-linjerne med din position.
2. Slå skærmaflæsning til i klienten (`F10`). Se [Skærmaflæsning](client-screen-reading).
3. Åbn positionsvinduet: `Åbn positionsvindue (eksperimentelt)` under **Vinduer over spillet** på Hjem, eller giv `Positionsvindue (eksperimentelt)` en tast i `Indstillinger` › `Genvejstaster`.

Vinduet siger, hvad der mangler, når det ikke kan læse en position, for eksempel når r_DisplayInfo er slået fra.

## Sæt et positionsfyr

Tryk `Set beacon here` i positionsvinduet (vinduet er kun på engelsk endnu). Det foreslår et navn efter stedet, spillet viser, plus et nummer, for eksempel `Area18 #2`: ret det, hvis du vil, sæt flueben i `Share with my org` for at lade dine org-kammerater bruge det, og tryk `Save beacon`. Tasten `Sæt positionsfyr` gemmer et med det samme med det foreslåede navn. Du kan omdøbe, dele og slette dine fyr bagefter under `My beacons` i vinduet eller på hjemmesidens side [Positionsfyr](beacons).

## Styr mod et positionsfyr

Vælg et fyr på listen: dine egne og dem, dine org-kammerater deler. Vinduet viser:

- en pil, der peger den vej, du skal,
- afstanden,
- hvilken vej du skal dreje (`Turn right 32°, down 6°` eller `Straight ahead`),
- ankomsttiden med din nuværende fart.

Når du sidder i et skib i en planets atmosfære med spillets telemetri (se nedenfor) slået til, regnes drejningen fra skibets næse, så den virker, mens du står stille i luften, og følger med, når du drejer. Ellers regnes den fra den vej, du bevæger dig, og når du står stille, viser pilen retningen i planetens eller systemets egne akser: begynd at bevæge dig for at få en kurs. Et fyr på en planet, du ikke er nær, siger det: flyv til planeten for at få vejvisning.

Et fyr på en planet eller måne drejer med den, så et fyr ved en landingszone bliver ved landingszonen, mens planeten drejer. Et fyr i rummet bliver liggende i stjernesystemet.

## Administrér dine fyr

Tryk `My beacons` nederst i vinduet for at se de fyr, du har gemt:

- **Omdøb:** klik på navnet, skriv, og tryk `Enter` eller `Save`. `Escape` beholder det gamle navn.
- **Del:** sæt flueben i `Shared` for at lade dine org-kammerater styre mod det; fjern det for at stoppe delingen.
- **Slet:** tryk `×` og derefter `Delete?` for at bekræfte.

Dine org-kammeraters fyr er deres at ændre. Eksport og import af fyr sker på hjemmesidens side [Positionsfyr](beacons). Tryk `Done` for at lukke listen.

## Spillets telemetri

Star Citizen kan dele noget af det, skibets instrumenter viser, med programmer på din egen computer. Når det er slået til, får positionsvinduet:

- skibets kompaskurs i en planets atmosfære, så du får vejvisning, mens du står stille i luften,
- spillets egen fart, mens du sidder i et skib, mere præcis end den, der regnes ud fra positionen.

Selve positionen kommer stadig fra `r_DisplayInfo`. Til fods og i rummet virker vinduet som uden.

## Spilindstillinger

Klienten spørger én gang på Hjem, om den skal tilføje to linjer til spillets `user.cfg`. Sæt flueben ved dem, du vil have:

- **Positionstekst:** `r_DisplayInfo = 1`, så debugteksten er der fra start, og du ikke skal skrive det i konsollen. Et højere trin, du selv har sat, beholdes.
- **Spillets telemetri:** `grpc.client.server.enabled = 1`, til kursen og farten ovenfor. Spillet deler den kun med din egen computer.

Du kan ændre dine svar under `Indstillinger` › `Spilinstallation` › `Spilindstillinger til positionsvinduet`. Klienten holder linjerne i `user.cfg`, også når StarConfig fra United Danes skriver den fil. Spillet læser `user.cfg`, når det starter, så genstart spillet efter en ændring.

## Shards

Hver gruppe af spilservere (*shard*) har sin egen kopi af universet. Et steds koordinater er de samme på alle shards, men det, spillere har efterladt der, er ikke: et skib, en kasse eller et vragsted findes kun på den shard, det var på. Et fyr, der er sat på en anden shard, viser en advarsel, og du kan stadig styre mod det. Et fyr i et andet stjernesystem giver ingen vejvisning.

Klienten fortæller hjemmesiden, hvilken shard du er på, så siden [Positionsfyr](beacons) kan markere fyr på andre shards.
