# Troubleshooting

## Sign-in

**"That Discord account is not a member of this StarBuddy's Discord server."** Join the community's Discord server with that account, then sign in again. If you have several Discord accounts, check which one the browser is signed in to.

**I cannot see my org's stock.** Your join request may still be pending. Open `Organizations` and check. A manager has to accept it.

## The desktop client

**Pairing fails.** The code works once, for 10 minutes: generate a new one. Check that the address is the website's own, starting with `https://`.

**Nothing is synced.** On Home, the **Game.log** box must say the watcher is running. In `Settings` › `Game install`, check that the right channel is picked (`LIVE` or `PTU`).

**My missions do not score.** Only events from your own characters count. Check that your Star Citizen handle in your [profile](profile) is exactly your in-game handle.

**A hotkey does nothing.**

- `Settings` › `Diagnostics` says which key last reached StarBuddy. If none did, another program may own the key: pick another.
- On Windows, StarBuddy also watches the keyboard directly. If nothing arrives at all, keyboard software that remaps keys for the game is the usual cause.
- On Linux under Wayland, the desktop may own the keys. They then show **Set in desktop settings**: give StarBuddy's actions a key in your desktop's keyboard shortcut settings.

**The overlay goes behind the game on KDE.** StarBuddy offers a KDE window rule the first time an overlay opens. Install it from `Settings` › `Diagnostics`.

**A yellow border round the game on Windows.** That is Windows saying the window is captured. On Windows 11, open Settings › Privacy & security › Screenshot borders and allow apps, and desktop apps, to turn off the border. The border goes the next time screen reading is switched on. Windows 10 cannot hide it.

**The refinery reader gets it wrong.** Frame the panel in `Settings` › `Screen reading`, including its title bar. Correct the read in the window before you save.

## Still stuck?

Copy the system report from `Settings` › `Diagnostics` and ask in the community's Discord.
