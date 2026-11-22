# Screen reading

The client can read two in-game panels for you: refinery orders and mining scan signatures. All reading happens on your own machine. Frames are read and dropped, and nothing leaves your computer unless you send it.

## Switch screen reading on

Press `F10`, or `Turn on` in the **Screen** box on Home. The first time, pick the game's window. The choice is remembered, so switching on again asks nothing.

On Windows a yellow border round the game shows that the window is being captured. Windows 11 lets StarBuddy switch it off. See [Troubleshooting](troubleshooting) if it stays.

## Read a refinery order

![The refinery order window](screens/client-refinery-order.png)

1. Open the work order at the refinery terminal in the game.
2. Press `F8`. The refinery order window shows what was read: station, method, every material with quality, amount and yield, the cost and the time.
3. If the list is longer than the panel, scroll it in the game and press `F8` again. The reads are merged.
4. Check anything marked for checking, and correct it in the window.
5. Press `Save order`. It is on your [Refinery](refinery) page on the website.

If the reader misses the panel, frame it: `Settings` › `Screen reading` › **Refinery order area** › `Frame area`, and drag across the panel including its title bar.

## Read mining scans

![The scan window](screens/client-scan.png)

Press `F7`, or switch on the scan window under overlays. Opening the scan window starts everything: it switches screen reading on if it is off, then the live scan. While it runs, the client watches the signature badge near the middle of the screen and reads it about once a second. Ping a rock in scan mode and the scan window names the mineral, or the cluster, with its share, resistance and quality band.

On an open scan window, `F7` turns the live scan off and on, like the `Live: on` button in the window. Closing the window ends the live scan. Screen reading stays on, because `F8` uses it too.

### When the scan cannot start

![The scan window when screen capture is off](screens/client-scan-setup.png)

If screen capture cannot start, the scan window shows **Screen capture is off** and the one step that fixes it:

- **Windows, first time:** choose the game's window in the list and press `Start scanning`. The choice is remembered, so the next time the scan starts as soon as the window opens.
- **Windows, the last window failed** (the game was closed, for example): press `Start scanning` again, or choose the window in `Settings` › `Screen reading`. The reason is shown in red.
- **Linux:** press `Start scanning`, then pick the game's window in your desktop's dialog. The choice is remembered.

A scan window left open when the client quit comes back at start-up, but waits for `Start scanning`.

If no scan area is framed, the window says the badge is looked for mid-screen. `Frame area` lets you drag across the badge's spot, which reads more reliably.

Ground deposits and debris carry only their size in the signature: the mineral follows from where you are.

## Help improve the reader

Testers can press `F9` to send the game's frame to [Scan training](training). In `Settings` › `Screen reading`, `Share F8 refinery reads` also sends the refinery panels you read. It is off by default.
