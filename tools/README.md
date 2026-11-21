# Tools

Small standalone scripts for looking into Star Citizen game files. None of them are part of the app.

## Find-SubscriberPerks.ps1

Lists the subscriber perk settings in a Star Citizen build, with their default values and descriptions. It also lists the log lines the perks can write to `Game.log`.

It reads two files and changes nothing:

- `<channel>\Bin64\StarCitizen.exe`
- `<channel>\build_manifest.id`

No admin rights are needed.

### Run

In PowerShell (Windows PowerShell 5.1 or PowerShell 7):

```powershell
# PTU, from the default install folder
powershell -ExecutionPolicy Bypass -File .\tools\Find-SubscriberPerks.ps1

# LIVE
powershell -ExecutionPolicy Bypass -File .\tools\Find-SubscriberPerks.ps1 -Channel LIVE

# Another install folder
powershell -ExecutionPolicy Bypass -File .\tools\Find-SubscriberPerks.ps1 -Root 'D:\Games\StarCitizen'
```

| Parameter | Default | Meaning |
|---|---|---|
| `-Root` | `C:\Program Files\Roberts Space Industries\StarCitizen` | The folder that holds `LIVE`, `PTU` and the other channels. |
| `-Channel` | `PTU` | The channel folder to read. |

On Linux with Wine, run it with `pwsh`, or with Docker:

```sh
docker run --rm \
  -v "$HOME/Games/star-citizen/drive_c/Program Files/Roberts Space Industries/StarCitizen:/sc:ro" \
  -v "$PWD/tools/Find-SubscriberPerks.ps1:/s.ps1:ro" \
  mcr.microsoft.com/powershell pwsh -NoProfile -File /s.ps1 -Root /sc -Channel PTU
```

### Output

PTU 5.0.202.205 (changelist 13238477) prints this. Some log lines are left out here.

```
PTU build 5.0.202.205, changelist 13238477, built Thu Nov 19 2026

Settings:

Setting                               Default         Description
-------                               -------         -----------
cig_subscriber.vehicleclaim.cost      1.0, 0.9, 0.85  Multiplier for how much it costs different tiers of subscriber to claim vehicles (index 0 = non-sub).
cig_subscriber.vehicleclaim.time                      Multiplier for how long it takes different tiers of subscriber to claim vehicles (index 0 = non-sub).
cig_subscriber.reputation.boost       1.0, 1.1, 1.15  Multiplier for subscriber reputation bonuses (index 0 = non-sub).
cig_subscriber.reputation.boost.group 1.0, 1.05, 1.05 Multiplier for group subscriber reputation bonuses (index 0 = non-sub).
cig_subscriber.log                                    Enable/disable subscriber perks logging
g_activate_subscriber_perk                            Activates the subscriber perk feature.
g_enable_discount_perk                                Enables reputation based item discount perk.

Log lines:
  Requesting pricing info with subscriber perks for player $$. Cost multiplier: $$ Time multiplier: $$
  [Subscriber][$$] Reputation boost subscriber perk applied for $$[$$] before $$ after $$ multiplier $$ (personal $$, group $$)
  ...
```

A build without the perks prints `No subscriber perks in this build.`. LIVE 4.10.201 is one such build.

How to read the output:

- **Default lists** have one value per tier. The first value is for non-subscribers. The other values are for the subscriber tiers, lowest first.
- **`$$`** in a log line is a value the game fills in when it writes the line.
- **Log lines in `Game.log`:** setting `cig_subscriber.log = 1` in the channel's `user.cfg` should make the game write the `[Subscriber]` lines there. This is not confirmed yet.

### How it works

The script finds the `cig_subscriber.*` strings in the exe and reads the strings stored around them. Each setting's default value and description sit next to its name. It also searches the whole exe for:

- the "subscriber perk" log lines stored elsewhere;
- the switches `g_activate_subscriber_perk` and `g_enable_discount_perk`, by exact name.

A later build may add switches under other names; the script won't show them until they are added to its list. The script loads the whole exe into memory, which takes about 600 MB.
