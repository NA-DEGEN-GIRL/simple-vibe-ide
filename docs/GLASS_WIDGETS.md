# Glass effects implementation notes

## Current supported target

- Workspace rows in the left/right workspace dock can use real liquidGL.
- Each `.workspace-tab` is its own lens target so each workspace can tilt independently.
- The side dock `+` button shares the same glass material for visual consistency, but tilt is forced off for that button.
- The side dock container is intentionally transparent by default. It is a separate tunable widget/container shell with its own padding, gap, background alpha/blur/saturation, side border, outline, shadow, header opacity, and header pill background settings. The glass surface still belongs to each workspace row, not to the group.
- The decorative IDE background also runs behind the titlebar/workspace chrome; those bars use a light translucent blur instead of an opaque dark strip.
- The snapshot target is a private `#ide-glass-snapshot-stage`, not the whole IDE. It mirrors only the safe IDE background. Workspace row text/icons remain the real DOM drawn above the lens, matching the static demo and keeping terminal text, browser content, editor text, file paths, and other private/runtime content out of the liquidGL capture path.
- The vendored liquidGL copy supports a local `preserveTargetOpacity` option. Workspace glass uses it so a failed or delayed snapshot cannot leave row labels hidden at opacity 0.
- The global liquidGL canvas, hover mirror canvas, and shadow overlay are moved under `.shell` and kept behind the transparent side dock stacking layer: the canvas renders the row-shaped lenses, while the real workspace row DOM stays above it for sharp labels/icons. If labels or glass disappear, enable Diagnostics log and look for `glass` entries with `hit`, `cp/cz`, `mp/mz`, `dz`, and `to/ti`.

## Why not apply the same effect to every widget yet?

Terminal responsiveness is the product constraint. Directly snapshotting large app areas or xterm/browser content can add main-thread and GPU work at exactly the wrong time.

High-risk targets:

- Terminal/xterm: direct glass over the terminal can obscure glyphs, fight xterm's renderer, and make scroll/resize latency worse.
- Browser preview iframe/native webview: iframe/native compositor content may not be captured reliably by html2canvas, and CORS can block external images.
- Large floating panels: frequent layout/resize changes can force repeated snapshot recaptures.

## Candidate approaches for later

1. CSS/backdrop panel chrome only
   - Apply glass styling to panel title/toolbars and static chrome.
   - Leave terminal/editor/browser content opaque and fast.

2. Wrapper lens over a controlled background layer
   - Keep a separate decorative background layer, as workspace glass does.
   - Lens only refracts that safe layer, not live widget content.

3. Per-widget opt-in with strict budgets
   - Disable by default.
   - Require small targets, no full-app snapshots, throttled recapture, and an easy off switch.

4. Terminal-specific overlay
   - Keep xterm text in the normal renderer.
   - Add a subtle non-capturing border/specular overlay above the card instead of distorting terminal pixels.

## Guardrails

- Do not snapshot terminal output, clipboard content, browser pages, raw file contents, or private paths.
- Do not add large synchronous work to the WebView main thread.
- Keep liquidGL `shadow` off by default for workspace rows to avoid the faint halo seen around small-radius tabs.
- Use left/right workspace dock only until top/bottom tab geometry has a separately tuned design.
