# Skærmaflæsning

Klienten kan læse to paneler i spillet for dig: raffinaderiordrer og signaturer fra minescanninger. Al aflæsning sker på din egen maskine. Billederne bliver læst og smidt væk, og intet forlader din computer, medmindre du sender det.

## Slå skærmaflæsning til

Tryk `F10`, eller `Slå til` i boksen **Skærm** på Hjem. Første gang vælger du spillets vindue. Valget huskes, så næste gang spørger den ikke.

På Windows viser en gul ramme om spillet, at vinduet bliver optaget. Windows 11 lader StarBuddy slå den fra. Se [Fejlfinding](troubleshooting), hvis den bliver.

## Læs en raffinaderiordre

![Vinduet med raffinaderiordren](screens/client-refinery-order.png)

1. Åbn arbejdsordren ved raffinaderiterminalen i spillet.
2. Tryk `F8`. Vinduet med raffinaderiordren viser, hvad der blev læst: station, metode, hvert materiale med kvalitet, mængde og udbytte, prisen og tiden.
3. Er listen længere end panelet, så rul den i spillet og tryk `F8` igen. Aflæsningerne lægges sammen.
4. Tjek det, der er markeret til tjek, og ret det i vinduet.
5. Tryk `Gem ordre`. Den står nu på din side [Raffinering](refinery) på hjemmesiden.

### Arbejdsordrens område

![Raffinaderivinduet tilbyder det område, det fandt](screens/client-refinery-area.png)

Du behøver ikke indramme panelet selv. Første gang du trykker `F8`, læser klienten hele skærmen og finder arbejdsordren på dens tekst. Raffinaderivinduet spørger så, om det område skal bruges til de næste aflæsninger, som bliver hurtigere og mere sikre: tryk `Brug dette område` eller `Nej tak`. Stationens navn læses selv fra toppen af skærmen.

Er panelet ikke helt på skærmen, gemmes intet, og vinduet siger, hvad der manglede, f.eks. bunden med **TOTAL COST** og **PROCESSING TIME**. Rul panelet eller gå tættere på, og tryk `F8` igen.

![Raffinaderivinduet, når panelets bund manglede](screens/client-refinery-guide.png)

Vil du indramme det i hånden, så tryk `Vælg område` dér, eller gå til `Indstillinger` › `Skærmaflæsning` › **Raffinaderiordre-område** › `Indram område`. Træk fra titlen **WORK ORDER** ned til **TOTAL COST** og **PROCESSING TIME**, med hele materialetabellen indenfor.

Flytter panelet sig senere ud af dit område, f.eks. efter et skift af opløsning, finder klienten det én gang på hele skærmen og spørger, om det skal bruges, hvor det er nu.

## Læs minescanninger

![Scanningsvinduet](screens/client-scan.png)

Tryk `F7`, eller slå scanningsvinduet til under overlays. Når scanningsvinduet åbner, starter det hele: det slår skærmaflæsning til, hvis den er slået fra, og derefter live-scanningen. Mens den kører, holder klienten øje med signatur-mærket nær midten af skærmen og læser det cirka én gang i sekundet. Ping en sten i scanningstilstand, så viser scanningsvinduet mineralet, eller klyngen, med andel, modstand og kvalitetsbånd.

Når scanningsvinduet er åbent, slår `F7` live-scanningen fra og til, ligesom knappen `Live: til` i vinduet. Lukker du vinduet, stopper live-scanningen. Skærmaflæsning bliver ved med at være slået til, fordi `F8` også bruger den.

### Når scanningen ikke kan starte

![Scanningsvinduet, når skærmaflæsning er slået fra](screens/client-scan-setup.png)

Kan skærmaflæsning ikke starte, viser scanningsvinduet **Skærmaflæsning er slået fra** og det ene trin, der løser det:

- **Windows, første gang:** vælg spillets vindue på listen og tryk `Start scanning`. Valget huskes, så næste gang starter scanningen, så snart vinduet åbner.
- **Windows, sidste vindue fejlede** (spillet var f.eks. lukket): tryk `Start scanning` igen, eller vælg vinduet i `Indstillinger` › `Skærmaflæsning`. Årsagen står med rødt.
- **Linux:** tryk `Start scanning`, og vælg spillets vindue i skrivebordets dialog. Valget huskes.

Et scanningsvindue, der stod åbent, da klienten lukkede, kommer igen ved opstart, men venter på `Start scanning`.

Er der ikke indrammet et scanningsområde, siger vinduet, at mærket søges midt på skærmen. Med `Indram område` trækker du hen over mærkets plads, så aflæsningen bliver mere sikker.

Forekomster på jorden og vragrester viser kun deres størrelse i signaturen: mineralet afhænger af, hvor du er.

## Hjælp med at forbedre aflæsningen

Testere kan trykke `F9` for at sende spillets billede til [Scanningstræning](training). I `Indstillinger` › `Skærmaflæsning` sender `Del F8-raffinaderiaflæsninger for at forbedre aflæsningen` også de raffinaderipaneler, du læser. Den er slået fra fra start.
