# Refinery

The Refinery page lists your refinery work orders and the ones your org shares: where, which method, what goes in, and how long is left.

![Refinery](screens/web-refinery.jpg)

## Record an order

The easiest way is the desktop client: open the order at the refinery terminal in the game and press `F8`. See [Screen reading](client-screen-reading).

To type one in, press `New order`, then fill in the sheet the way the terminal shows it: refinery, method, each material with quality and amount in, the yield, the cost and the processing time (`22m 28s`, `1h 30m`).

## Order details

Click an order to open it.

![A refinery order](screens/web-refinery-order.jpg)

The sheet works like a spreadsheet: arrow keys move, typing edits, `Enter` fills the next empty cell, `Tab` walks the cells. Correct anything the reader got wrong.

## Collect an order

When the terminal says the job is done:

1. Open the order.
2. Under **Collect to**, pick where the materials actually went.
3. Under **Visible to**, pick who sees the haul.
4. Press `Collected`.

The refined materials are added to your [Materials](materials). Every material needs a name first. If one did not match the catalogue, fix its name in the sheet.

`Delete order` removes an order the refinery never ran. For a collected order, the materials it produced stay.
