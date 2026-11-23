# StarLabels and StarConfig

UnitedDanes makes two tools for Star Citizen on uniteddanes.org:

- **StarLabels:** better ship and item names in the game, in the game's `global.ini`.
- **StarConfig:** your game settings, in the game's `user.cfg`.

You set them up on uniteddanes.org. StarBuddy links your account to that setup, and the desktop client installs the files into your game folder. Installing needs the desktop client: see [Install and pair the client](client-setup).

## On the website

Open your name in the top right corner, choose `Profile & desktop client`, and find **Ship names & game settings**.

1. Press `Open UDI StarLabels setup`. uniteddanes.org opens on your own settings.
2. Choose your names and settings there, then press **Send to StarBuddy**.
3. Your desktop clients pick up the new settings.

The line at the top of the section says where you are:

- **Not linked:** nothing set up yet.
- **Linked · waiting for Send:** the setup is open, but you have not pressed Send yet.
- **Linked · revision 3:** your settings are sent. Each Send counts up.
- **Linked · UDI not reachable:** uniteddanes.org did not answer. Try again later.

## In the desktop client

The card **UnitedDanes StarLabels and StarConfig** is on the **Tools** page.

1. Press `Set up on uniteddanes.org`. Once linked, the buttons are `Open StarLabels` and `Open StarConfig`.
2. The client waits for you to press **Send to StarBuddy** on the page. It looks every few seconds, for up to half an hour.
3. When new settings arrive, the card says so. Press `Install`.

Tick **Install new settings and game versions by themselves** to skip pressing `Install`. The client then also fetches new names when the game updates.

The files take effect the next time the game starts. If you had your own `user.cfg`, it is kept as `user.cfg.before-starbuddy`. If uniteddanes.org can't build the names just then, the names already installed stay, and the client tries again later.

## Unlink

`Unlink` on the website or in the client removes the link and deletes the settings stored at uniteddanes.org. The files already installed in the game folder stay.
