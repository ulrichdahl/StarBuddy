# Install and pair the client

The StarBuddy desktop client runs beside Star Citizen on Windows and Linux. It:

- reads the game's `Game.log` and sends new blueprints, finished missions, refinery jobs and travel to StarBuddy, which is where your org's points come from;
- reads refinery orders and mining scans off the screen, on your own machine;
- shows small windows over the game: server status, your refinery orders, your shopping list and more.

## 1. Install

Sign in to the website. Use **Get started** on the dashboard, or press `Desktop client` in the top bar. The download button picks the file for your system: `Download for Windows`, or for Linux the AppImage (deb or rpm on distributions that use them). The other files are listed under it. Install and start it.

![The Desktop client page](screens/web-client.jpg)

The `Desktop client` button in the top bar has an orange dot until a client of yours is connected. Its page also lists your **Paired devices**, with when each last synced: remove one you no longer use. The ship names and game settings the client installs are linked there too: see [StarLabels and StarConfig](starlabels).

The client checks for updates by itself and offers to install them. See [Settings](client-settings).

## The first start

![The setup on the first start](screens/client-setup.jpg)

The first time you start it, the client walks you through four steps, one card at a time: `Sign in`, `Find Game.log`, `Choose the game window` and `Try a hotkey`. Each one can be skipped, and `Skip setup. Everything is in Settings.` leaves straight away. The last card shows what is set up and what you skipped. An org is optional: StarBuddy works for a solo player too.

Run it again any time from `Settings` › `General` › **Setup** › `Run setup again`.

## 2. Sign in

![Signing in with the browser](screens/client-sign-in-browser.jpg)

1. In the setup, or under `Settings` › `General` › **Server**, check the address (it is filled in) and press `Sign in with browser`.
2. Your browser opens the website. Sign in with Discord if it asks.
3. Check that the page shows the same code as the client, and press `Connect`.

The client then shows **Paired as** with your name. The code works for 10 minutes. `Open the page again` opens it once more if you closed it. Unpair under **Server**, or remove the device from the website.

If the website no longer accepts the computer, because you removed the device there or deleted your account, every page in the client says so. Press `Sign in again` and sign in with the browser. Game events not sent yet are kept and sent after you sign in.

**With a pairing code instead:** press `Enter a pairing code instead` in the client. On the website's `Desktop client` page, press `Use a pairing code instead`, then type the address and the code in the client and press `Pair`.

![Settings › General in the client](screens/client-settings-general.jpg)

## 3. Point it at the game

![Settings › Game install](screens/client-settings-game.jpg)

Open `Settings` › `Game install`. The client finds the usual installation by itself. If it does not, press `Find your installation…` and pick the `StarCitizen` folder or one channel in it (`LIVE`, `PTU`).

- `Scan log history` reads the old logs once, so the blueprints you already got are added.
- `Start watching` follows `Game.log` while you play. New events are sent as they happen.

## 4. Set your handle

Make sure your Star Citizen handle is set in your [profile](profile) on the website. Only events from your own characters score points.

Next: [The Home page](client-home).
