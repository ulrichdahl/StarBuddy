# Tools

Small standalone scripts for looking into Star Citizen game files. None of them are part of the app.

## Find-SubscriberPerks.ps1

Lists the subscriber perks in a Star Citizen build:

- the `cig_subscriber.*` settings, with their default values and descriptions;
- the perk feature switches;
- the subscriber tiers, as badges;
- the log lines the perks and the party subscriber tier can write to `Game.log`.

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

PTU 5.0.202.10025 (changelist 13248297) prints this. Some log lines are left out here.

```
PTU build 5.0.202.10025, changelist 13248297, built Fri Nov 20 2026

Settings:

Setting                               Default         Description
-------                               -------         -----------
cig_subscriber.insuranceclaim.cost    1.0, 0.9, 0.85  Multiplier for insurance claim costs of different tiers of subscriber: vehicle, individual item and repair claims (index 0 = non-sub).
cig_subscriber.insuranceclaim.time                    Multiplier for insurance claim cooldown and delivery times of different tiers of subscriber: vehicle and individual item claims (index 0 = non-sub).
cig_subscriber.reputation.boost       1.0, 1.1, 1.15  Multiplier for subscriber reputation bonuses (index 0 = non-sub).
cig_subscriber.reputation.boost.group 1.0, 1.05, 1.05 Multiplier for group subscriber reputation bonuses (index 0 = non-sub).
cig_subscriber.log                                    Enable/disable subscriber perks logging
g_activate_subscriber_perk                            Activates the subscriber perk feature.
g_enable_discount_perk                                Enables reputation based item discount perk.

Tiers (badges):
  RSI_BADGE_SUBSCRIBER
  RSI_BADGE_SUBSCRIBER_CENTURION
  RSI_BADGE_SUBSCRIBER_IMPERATOR

Log lines:
  [Subscriber][$$] Reputation boost subscriber perk applied for $$[$$] before $$ after $$ multiplier $$ (personal $$, group $$)
  Requesting pricing info with subscriber perks for player $$. Cost multiplier: $$ Time multiplier: $$
  $$[$$] party subscriber tier changed to $$ (was $$)
  ...
```

LIVE 4.10.201 has only the two switches and the `RSI_BADGE_SUBSCRIBER` badge. It has no `cig_subscriber.*` settings and no log lines. A build with none of it prints `No subscriber perks in this build.`.

How to read the output:

- **Default lists** have one value per tier. The first value is for non-subscribers. The other values are for the subscriber tiers, lowest first. The badges suggest those tiers are Centurion and Imperator; this is not confirmed.
- **`$$`** in a log line is a value the game fills in when it writes the line.
- **Log lines in `Game.log`:** setting `cig_subscriber.log = 1` in the channel's `user.cfg` should make the game write the `[Subscriber]` lines there. This is not confirmed yet.

### How it works

The script searches the whole exe for:

- `cig_subscriber.` setting names. Each setting's default value and description are stored next to its name.
- The switches `g_activate_subscriber_perk` and `g_enable_discount_perk`, by exact name. Each one's description is stored just before it.
- `RSI_BADGE_SUBSCRIBER` badge names.
- Log lines containing `[Subscriber][`, "subscriber perk" or "party subscriber tier".

A later build may add switches under other names. The script won't show them until they are added to `$switches` at the top of the script. The script loads the whole exe into memory, which takes about 600 MB.
