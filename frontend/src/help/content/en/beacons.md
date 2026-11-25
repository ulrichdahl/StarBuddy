# Beacons

The Beacons page lists the location beacons you set in the desktop client, and the ones your org mates share with you. You set beacons in the client, not here. See [Location beacons](client-beacons).

A place has the same coordinates on every game shard, but what players left there exists only on the shard it was set on. The page says which shard your client last reported, and marks beacons on another shard with `Other shard`. The shard column shows the last four digits; point at it to see the full name.

## Your beacons

- **Rename:** press the pencil next to the name, type, and press `Enter`. `Escape` keeps the old name.
- **Share:** the `Shared` switch shares a beacon with the members of your orgs. They can track it, but not change it.
- **Delete:** the bin icon, then confirm. A shared beacon is gone for your org mates too.

You do not need an org: beacons work just as well for solo play.

## Export and import

To give beacons to a player outside your org, export them to a file and send it.

1. Tick the beacons to export, or tick none to export them all.
2. Press `Export`. You get a `starbuddy-beacons.json` file.

The other player presses `Import` and chooses the file. The beacons become their own copies, not shared. If some of them are on another shard than the one their client is on, the page lists them in a warning. If their client has not reported a shard yet, open the location window in the client in-game to compare shards.
