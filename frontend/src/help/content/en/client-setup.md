# Install and pair the client

The StarBuddy desktop client runs beside Star Citizen on Windows and Linux. It:

- reads the game's `Game.log` and sends new blueprints, finished missions, refinery jobs and travel to StarBuddy, which is where your org's points come from;
- reads refinery orders and mining scans off the screen, on your own machine;
- shows small windows over the game: server status, your refinery orders, your shopping list and more.

## 1. Install

Sign in to the website. Use **Get started** on the dashboard, or open your name in the top right corner and choose `Profile & desktop client`. The download button picks the file for your system: `Download for Windows`, or for Linux the AppImage (deb or rpm on distributions that use them). The other files are listed under it. Install and start it.

The `Desktop client` button in the top bar has an orange dot until a client of yours is connected.

The client checks for updates by itself and offers to install them. See [Settings](client-settings).

## 2. Pair it with the website

![Settings › General in the client](screens/client-settings-general.jpg)

1. On the website, in `Profile & desktop client`, press `Generate pairing code`.
2. In the client, open `Settings` › `General`.
3. Under **Server**, type the website's address (`https://…`) and the code, and press `Pair`.

The code works once, for 10 minutes. The client then shows **Paired as** with your name. Unpair it here, or remove the device from the website.

## 3. Point it at the game

![Settings › Game install](screens/client-settings-game.jpg)

Open `Settings` › `Game install`. The client finds the usual installation by itself. If it does not, press `Find your installation…` and pick the `StarCitizen` folder or one channel in it (`LIVE`, `PTU`).

- `Scan log history` reads the old logs once, so the blueprints you already got are added.
- `Start watching` follows `Game.log` while you play. New events are sent as they happen.

## 4. Set your handle

Make sure your Star Citizen handle is set in your [profile](profile) on the website. Only events from your own characters score points.

Next: [The Home page](client-home).
