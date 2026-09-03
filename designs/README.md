# Design references

Static HTML copies of the design artifacts the overlay work was decided on.
Open them in a browser; fonts load from Google Fonts (Rajdhani, Exo 2, Share
Tech Mono — the same faces the client bundles).

| File | What | Artifact |
|---|---|---|
| `overlays.html` | Overlay direction study: A · Launcher Glass (chosen) and B · Signal Strip, status/maintenance and scan windows on a mock viewport, with the original reference scan entry (Bexalite (Raw), two quality bands) | https://claude.ai/code/artifact/5f7ef148-a715-415f-ba8f-fae2b0d5a37c |
| `window-modes.html` | Window modes (floating / dock left·right·top·bottom), size states, the size · placement · opacity · close cluster and the icon set (`client/src/overlay/icons.tsx`) | https://claude.ai/code/artifact/a3ce556a-85e5-4ccb-93a6-657a170d2468 |
| `scan-window-ledger.html` | Chosen scan window layout "A · Ledger" (2026-08-27): mineral headline with grey cluster count, rarity + signature chips, one ledger row per composition band | https://claude.ai/code/artifact/0e55c0bd-2865-42a6-9f09-0afc5769e259 |
| `scan-window-cluster.html` | The same window in its cluster state (Lindinium × 3, legendary) | same canvas |
| `blueprints-checklist.html` | Website blueprints page, option A · Fabricator checklist (approved 2026-08-28): all blueprints grouped in fabricator order, live Mine tick, craft-list filters and owners column, full pager | https://claude.ai/code/artifact/baf435b3-321f-497b-9f59-1be1d4c42674 |
| `blueprints-matrix.html` | Website blueprints page, option B · Matrix + quick add (approved 2026-08-28): grid with Type/Grade columns, your column clickable, quick-add field | same canvas |
| `material-entry-grid.html` | Materials quick entry as a spreadsheet grid (tester proposal, assessed 2026-08-31): live keyboard-driven grid — arrows navigate, only the focused cell edits, Material is an autocomplete over the resource catalog and Quality a select of that material's known bands, Enter opens a new line, Ctrl+Enter repeats the line with Amount cleared, Amount before Quality — beside the sketch as proposed, the keystroke comparison and the open decisions | local only |

| `refinery-dialog/` | Refinery order dialog (approved 2026-09-03): one dialog whose single action follows the order's state — in progress edits and saves, ready freezes and collects, collected is a record; visibility, the commit and Close in the action bar; totals aligned under the In and Yield columns they total, with the return % | https://claude.ai/code/artifact/079dda38-38d5-47c9-aac1-264255242dfb |

The scan-window pages are the artboards of the design canvas exported as plain
HTML; the canvas itself (editable) lives at the artifact link. `refinery-dialog/`
keeps its artboards as the `.dc.html` sources the canvas is seeded from, with
`canvas.json` for their layout — the packaged canvas is not committed. Design decisions
are recorded in `spec.html`; the implementation is `client/src/overlay/`.
