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

Press `F7` to start the live scan. While it runs, the client watches the signature badge near the middle of the screen and reads it about once a second. Ping a rock in scan mode and the scan window names the mineral, or the cluster, with its share, resistance and quality band. Press `F7` again to stop.

Ground deposits and debris carry only their size in the signature: the mineral follows from where you are.

## Help improve the reader

Testers can press `F9` to send the game's frame to [Scan training](training). In `Settings` › `Screen reading`, `Share F8 refinery reads` also sends the refinery panels you read. It is off by default.
