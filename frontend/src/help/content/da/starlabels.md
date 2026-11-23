# StarLabels og StarConfig

UnitedDanes laver to værktøjer til Star Citizen på uniteddanes.org:

- **StarLabels:** bedre skibs- og genstandsnavne i spillet, i spillets `global.ini`.
- **StarConfig:** dine spilindstillinger, i spillets `user.cfg`.

Du sætter dem op på uniteddanes.org. StarBuddy forbinder din konto med den opsætning, og desktop-klienten installerer filerne i din spilmappe. Installationen kræver desktop-klienten: se [Installér og par klienten](client-setup).

## På hjemmesiden

Tryk `Desktopklient` i topbjælken, og find **Skibsnavne og spilindstillinger**.

1. Tryk `Åbn UDI StarLabels-opsætning`. uniteddanes.org åbner på dine egne indstillinger.
2. Vælg dine navne og indstillinger dér, og tryk så **Send til StarBuddy**.
3. Dine desktop-klienter henter de nye indstillinger.

Linjen øverst i afsnittet siger, hvor du er:

- **Ikke forbundet:** intet sat op endnu.
- **Forbundet · venter på Send:** opsætningen er åben, men du har ikke trykket Send endnu.
- **Forbundet · revision 3:** dine indstillinger er sendt. Hver Send tæller op.
- **Forbundet · UDI kan ikke nås:** uniteddanes.org svarede ikke. Prøv igen senere.

## I desktop-klienten

Kortet **UnitedDanes StarLabels og StarConfig** ligger på siden **Værktøjer**.

1. Tryk `Sæt op på uniteddanes.org`. Når du er forbundet, hedder knapperne `Åbn StarLabels` og `Åbn StarConfig`.
2. Klienten venter på, at du trykker **Send til StarBuddy** på siden. Den kigger efter med få sekunders mellemrum i op til en halv time.
3. Når nye indstillinger kommer, siger kortet det. Tryk `Installér`.

Sæt flueben ved **Installér nye indstillinger og spilversioner af sig selv**, så slipper du for at trykke `Installér`. Klienten henter så også nye navne, når spillet opdateres.

Filerne virker næste gang spillet starter. Havde du din egen `user.cfg`, gemmes den som `user.cfg.before-starbuddy`. Kan uniteddanes.org ikke lave navnene lige da, bliver de installerede navne, og klienten prøver igen senere.

## Fjern forbindelsen

`Fjern forbindelse` på hjemmesiden eller `Afkobl` i klienten fjerner forbindelsen og sletter de indstillinger, der ligger på uniteddanes.org. Filerne, der allerede er installeret i spilmappen, bliver liggende.
