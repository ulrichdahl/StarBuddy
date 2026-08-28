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
| `blueprints-matrix.html` | Website blueprints page, option B · Matrix + quick add (approved 2026-08-28): grid with Type/Grade/Owners columns, your column clickable, quick-add field | same canvas |

The scan-window pages are the artboards of the design canvas exported as plain
HTML; the canvas itself (editable) lives at the artifact link. Design decisions
are recorded in `spec.html`; the implementation is `client/src/overlay/`.
