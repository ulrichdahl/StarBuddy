# Location beacons

**Experimental.** The client can read where you are in the game and steer you back to a place you marked, like a car GPS. A marked place is a *beacon*.

## Before you start

1. In the game, open the console with `` ` `` and type `r_DisplayInfo 1`, or let the client add it to `user.cfg` (see *Game settings* below). The debug text in the corner must show the `Zone` lines with your position.
2. In the client, switch screen reading on (`F10`). See [Screen reading](client-screen-reading).
3. Open the location window: `Open location window (experimental)` under **Windows over the game** on Home, or give `Location window (experimental)` a key in `Settings` › `Hotkeys`.

The window says what is missing when it cannot read a position, for example when r_DisplayInfo is off.

## Set a beacon

Press `Set beacon here` in the location window. It suggests a name from the place the game shows plus a number, such as `Area18 #2`: change it if you like, tick `Share with my org` to let your org mates use it, and press `Save beacon`. The `Set location beacon` key saves one at once with the suggested name. You can rename, share and delete your beacons later under `My beacons` in the window, or on the website's [Beacons](beacons) page.

## Steer to a beacon

Choose a beacon from the list: your own, and the ones your org mates share. The window shows:

- an arrow pointing the way to go,
- the distance,
- which way to turn (`Turn right 32°, down 6°` or `Straight ahead`),
- the arrival time at your current speed.

Sitting in a ship in a planet's atmosphere with game telemetry (below) on, the turn is counted from your ship's nose, so it works hovering still and follows you as you turn. Otherwise it is counted from the way you are moving, and standing still the arrow shows the direction in the planet's or system's own axes: start moving to get a heading. A beacon on a planet, moon or Lagrange point you are not near says so, by the name the star map uses (ArcCorp, Ita, ARC L2): fly there to get directions.

A beacon on a planet or moon turns with it, so a beacon at a landing zone stays at the landing zone while the planet spins. A beacon in space stays put in the star system.

## Manage your beacons

Press `My beacons` at the bottom of the window to see the beacons you saved:

- **Rename:** click the name, type, and press `Enter` or `Save`. `Escape` keeps the old name.
- **Share:** tick `Shared` to let your org mates steer to it; untick to stop sharing.
- **Delete:** press `×`, then `Delete?` to confirm.

Your org mates' beacons are theirs to change. Exporting and importing beacons is on the website's [Beacons](beacons) page. Press `Done` to close the list.

## Game telemetry

Star Citizen can share some of what the ship's instruments show with programs on your own computer. With it on, the beacon window gets:

- your ship's compass heading inside a planet's atmosphere, for directions while hovering still,
- the game's own speed while you sit in a ship, more exact than the one worked out from the position.

The position itself still comes from `r_DisplayInfo`. On foot and in space the window works as without it.

## Game settings

The client asks once, on Home, whether to add two lines to the game's `user.cfg`. Tick the ones you want:

- **Position text:** `r_DisplayInfo = 1`, so the debug text is on from the start and you need not type it in the console. A higher level you set yourself is kept.
- **Game telemetry:** `grpc.client.server.enabled = 1`, for the heading and speed above. The game shares it with your own computer only.

You can change your answers under `Settings` › `Game install` › `Game settings for the beacon window`. The client keeps the lines in `user.cfg`, also when StarConfig from United Danes writes that file. The game reads `user.cfg` as it starts, so restart the game after a change.

## Shards

Every game server group (*shard*) has its own copy of the universe. The coordinates of a place are the same on every shard, but what players left there is not: a ship, a crate or a crash site exists only on the shard it was on. A beacon set on another shard shows a warning, and you can still steer to it. A beacon in another star system gives no directions.

The client tells the website which shard you are on, so the [Beacons](beacons) page can mark beacons on other shards.
