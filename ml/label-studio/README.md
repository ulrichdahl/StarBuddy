# Annotating captures

```sh
uvx label-studio start
```

1. Create a project, then paste `config.xml` into Settings -> Labeling Interface
   (Code view).
2. Import the captures. Local files work via Settings -> Cloud Storage -> Local
   files pointed at `screenshots/`, which avoids duplicating them into Label
   Studio's own storage.
3. For each capture: click the four corners of the panel's **display area** —
   the lit screen, not the physical bezel around it — then pick the screen, the
   HUD colour, whether the panel is partly blocked, and the patch.
4. Export as **JSON** (not JSON-MIN; the converter reads the full result list).

Guidance that keeps the labels consistent:

- Trace the lit display area. The bezel varies by kiosk model and carries no text.
- When a corner is off the edge of the capture, click where it *would* be. The
  training code deliberately does not clamp corners to the frame, and clamping
  them by hand would teach the model to stop at the frame edge.
- Curved or multi-segment panels: label the largest flat region that holds the
  content. A quad cannot represent a curve, and a quad stretched over one
  rectifies to mush.
- Mark `occluded: yes` generously — player model, ship geometry, glare, a tooltip
  hanging off the panel. It is how you will find the detector's failure cases
  later.
