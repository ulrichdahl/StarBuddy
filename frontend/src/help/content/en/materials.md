# Materials

The Materials page holds your raw and refined materials and gems: what, at which quality, how much and where.

![Materials](screens/web-materials.jpg)

## Add stacks

Press `Add materials`. A sheet opens with one line per stack:

![Adding materials](screens/web-materials-add.jpg)

1. **Location:** where the stacks are stored. It applies to the whole sheet.
2. **Material:** start typing and pick it from the list.
3. **Amount:** in SCU for ores and refined materials, in pieces for gems. `Ctrl`+`↑` `↓` and `Shift`+`↑` `↓` step it.
4. **Quality:** the number on the crate. The known quality bands for the material are shown beside it.
5. **Visibility:** `Only you` or `Org-visible`. `Space` switches it. A new line takes the one from the line above.

`Enter` saves the line and moves to the next. `Ctrl`+`Enter` repeats the line with the amount cleared, handy for the same material at several qualities. Arrow keys move between cells, and `Tab` walks them.

Press the save button at the bottom when you are done. Lines the server refuses stay in the sheet with the reason, so you can fix them and save again.

## Find and change stacks

- Filter by name, quality range, system or location, and visibility.
- Click a stack of yours to edit it. Set the amount to 0 to use it up.
- `Only mine` hides other members' stacks.
- A stack marked **(refining)** is still in a refinery. Collect it on the [Refinery](refinery) page.

## Stacks and Org views

- **Stacks** lists every stack you can see, one per row.
- **Org** sums what members have made org-visible, per material and quality, with who holds it.

## Move, share or sell

Tick stacks of yours, then press `Move, share or sell`:

- **Move:** give them a new location.
- **Share:** set them private or org-visible.
- **Sell:** hand them to another player, with a price, or 0 to give them away. If the handle belongs to a StarBuddy player, the stacks move to them, private. If not, they simply leave your inventory and the sale is recorded.

You can move only part of a stack: type how much of each goes.

The **Sales** view lists what you sold or gave away, and what was sold to you.
