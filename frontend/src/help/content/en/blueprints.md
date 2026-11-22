# Blueprints

The Blueprints page lists every blueprint in the game, with who in your org owns it and how to get the ones you miss.

![Blueprints](screens/web-blueprints.jpg)

## Mark the blueprints you own

The desktop client adds blueprints by itself when the game logs that you received one. To add the ones you already had:

- **Checklist view:** walk your fabricator list in the game and tick along. Every tick saves at once. `Space` ticks the highlighted row, `↑` `↓` move.
- **Quick add:** type a name, pick it, press `Enter`. The field keeps focus for the next one. `✕` on a chip undoes.
- `Mark all shown as owned` ticks every blueprint the filters show.

Default blueprints are owned by everyone.

## Find blueprints

Filter by name, type and grade, and by who owns it with four toggles:

| Toggle | Shows |
| --- | --- |
| Person with a tick | Only owned by me |
| Group with a tick | Owned in the org, me included |
| Person struck through | Not owned by me |
| Group struck through | Not owned by anyone in the org |

A toggle that contradicts another switches it off. "Owned in the org" and "Not owned by me" together show what the org has and you do not. The client's Blueprints page has the same toggles.

The **Matrix** view shows the org's members as columns.

## Blueprint details

Click a blueprint to open its details.

![Blueprint details](screens/web-blueprint-info.jpg)

- **Who has it:** org members who own it.
- **Where it drops:** the reward pools that hand it out, fewest missing first, with the missions and events that award each pool. Switch between your progress and the org's.
- `Track this pool`, with the eye, puts the pool on your dashboard and in the client's blueprint pools window. An eye beside a pool means you track it.
- **Needed to craft:** the recipe, checked against your stock and the org's best.
- `Pin as craft target`, with the pin, sends its materials to [Gathering](gathering). A pin beside a blueprint's name means it is a craft target.

Everywhere in StarBuddy, the eye means a tracked reward pool and the pin means a craft target.
- **Stats:** the item's stats, and how far crafting can move them.
