# Terminal GL renderer left-edge glyph flicker — investigation notes (2026-07-05)

**Audience: an LLM (or engineer) fixing the bug.** Self-contained, diagnosis
only — **no fix has been applied yet**. Line numbers are anchors from the
2026-07-05 working tree (`src/main.ts`, `src/styles.css`); re-locate by symbol
name if files drift.

## Symptom (user-reported)

- In the Windows/Tauri app terminal, glyph fragments briefly appear near the
  **left edge** of the terminal viewport and then disappear (flicker/artifact).
- Observed while a Korean-heavy TUI (LLM CLI under tmux) was repainting.
  The fragments matched content visible elsewhere on screen (box-drawing `─`
  runs, line prefixes like `1980`, `TR`, ASCII-cat pieces) but rendered at
  column ~0, outside the TUI's own left gutter.
- The renderer badge showed `GL` the whole time.
- Local-only reference screenshot (not committed):
  `.vibe-ide-temp/attachments/20260705080502/image02.png`
- Related history: the Korean glyph-vanish issue is a *different* render-side
  problem in the same renderer layer (tracked separately; upstream PR #4921 is
  render-only). Same layer, different symptom — do not conflate the fixes.

## Environment facts

- `@xterm/xterm@6.0.0`, `@xterm/addon-webgl@0.19.0`, `@xterm/addon-fit@0.11.0`
  (`package.json:38-41`).
- Terminal is created with `allowTransparency: true` and a glass-mode-dependent
  theme background (`createTerminalTab`, `src/main.ts:30442-30451`).

## 1. How the `GL` badge is decided (verified)

`terminalRendererBadgeState` (`src/main.ts:31469-31503`):

- `pane.webgl` truthy → badge `GL`.
- `pane.webgl` is set exactly once at pane creation:
  `maybeLoadTerminalWebglAddon` (`src/main.ts:29048-29057`) — only when
  `state.ideSettings.terminalRenderer === 'auto'` and
  `new WebglAddon()` + `term.loadAddon()` did not throw.
- It is cleared only by the context-loss handler
  (`registerTerminalWebglContextLoss`, `src/main.ts:29060-29080`), which also
  updates the badge (`GL!` = lost, DOM fallback active). There is **no addon
  re-creation path** after a loss.

Conclusion: `GL` accurately means "WebglAddon attached, no context loss".
Caveats: a software-rasterized context (WebView2 GPU blocklist → SwiftShader)
still shows `GL`, and internal renderer malfunction (atlas corruption etc.) is
not detected. A "badge says GL but DOM is actually rendering" mismatch is not
possible from this code.

## 2. Artifact cause candidates (ranked)

### Candidate A — forced full-viewport refresh racing chunked writes (app code, most likely)

The write pipeline deliberately splits large TUI repaints into chunks across
rAF ticks (`flushTerminalWriteBuffer` chunking, `src/main.ts:33485-33493`).
While a repaint is only partially applied, several app paths force a
full-viewport redraw:

- Render watchdog: `refreshTerminalViewportIfRecentOutput` →
  `term.refresh(0, rows-1)` (`src/main.ts:33586-33598`), fired periodically
  while output is streaming (`runTerminalRenderWatchdog`,
  `src/main.ts:33561-33584`).
- IME composition guard full refresh (`src/main.ts:31641-31643`) — its own
  comment says it exists to paper over glyph-vanish during Korean composition,
  so it fires constantly during Korean input.
- Post-fit refresh (`fitTerminal`, `src/main.ts:32128-32130`).

A frame committed at a chunk boundary can show a **half-applied buffer state**:
rows from the previous scroll position, or partially rewritten lines whose
leftmost cells were just written — i.e. transient fragments near column 0 that
vanish when the next chunk lands. Matches the screenshot. The GL renderer
presents frames faster than DOM, making these torn frames more visible.

### Candidate B — upstream xterm 6.0 WebGL renderer CJK/wide-char/scroll path (upstream, plausible)

Same renderer layer as the known Korean glyph-vanish family. A Korean-heavy
buffer under scroll/rewrite could hit an upstream texture-atlas / row-draw bug
that transiently draws glyphs at a wrong (column-0-ish) x. Needs an upstream
issue sweep for `@xterm/xterm@6.0.0` + `addon-webgl@0.19.0` (keywords: left
edge, stale glyph, wide char, scroll, atlas).

### Candidate C — transparent background stack showing lower layers (glass interplay, less likely)

- `allowTransparency: true` (`src/main.ts:30443`) +
  `terminalBackgroundForCurrentGlassMode` alpha (`src/main.ts:7416-7420`) +
  `background: transparent !important` on `.xterm/.xterm-screen/.xterm-viewport/.xterm-rows`
  (`src/styles.css:4613-4617`).
- Below the GL canvas sit the app-glass local mirror (z=1) and the host-stack
  background. **Verified:** the glass refraction source
  `#ide-glass-snapshot-stage` is background-only
  (`syncWorkspaceGlassSnapshotStage`, `src/main.ts:8539-8550`), so glass cannot
  synthesize text glyphs. C can only produce glyph-shaped artifacts if stale
  DOM row content remains in `.xterm-rows` and shows through alpha cells.
- Secondary amplifier: terminal cards are glass tilt-follower owners — hover
  tilt applies a 3D transform to `.terminal-host-stack`
  (`installAppGlassTiltFollowers` direct-follower collection,
  `src/main.ts:10159-10183`), forcing canvas re-composits near edges.

## 3. Minimal verification per candidate

Common setup: capture the offending output once with `script`/asciinema and
replay via `cat` for a deterministic byte-identical repro. Enable debug log —
watchdog diagnostics already exist (`watchdog ... refreshed=yes`,
`src/main.ts:33576-33582`).

- **A:** 60fps screen recording + diagnostic log timestamp correlation — do
  artifact frames coincide with `refreshed=yes` or chunk continuations? Local
  experiment: enlarge `TERMINAL_WRITE_FORCE_FLUSH_CHARS`/chunk size and disable
  the watchdog refresh temporarily; artifact should disappear.
- **B:** switch `terminalRenderer` to `dom` **as a diagnostic only** and replay
  the same capture. If DOM never shows it, the renderer layer is confirmed;
  then cross-check upstream issues before touching anything.
- **C:** while reproducing, in devtools (1) `display:none` on
  `canvas[data-app-glass-mirror]` and `.app-glass-plane`, (2) inspect whether
  `.xterm-rows` still contains row elements under GL, (3) replay with glass
  fully off. Artifact surviving glass-off eliminates C. Toggle terminal-scope
  tilt separately to check hover correlation.
- **DOM-internal vs glass-composite discrimination** (the general question):
  step C-(1) is the discriminator — artifact survives mirror hiding → xterm
  internal; disappears → glass compositing.

## 4. Safest first fix direction (once verified)

Skip the watchdog's full-viewport refresh while output is still streaming
(`pane.writeBuffer` non-empty or `pendingTerminalWrites > 0`) — a one-condition
change in `refreshTerminalViewportIfRecentOutput`
(`src/main.ts:33586-33598`). Async-only, no main-thread work added, harmless
even if candidate A turns out wrong. If B is confirmed instead: pin/patch the
vendored xterm WebGL version — do not work around it with render loops.

## 5. Do NOT do these

- Remove write chunking / write large output synchronously (explicitly banned
  in `AGENTS.md`; freezes the whole IDE).
- Dispose/recreate `WebglAddon` on artifact detection — WebGL context churn
  can re-ignite the eviction cascade documented in
  `docs/GLASS_MULTI_WIDGET_CONTEXT_EXHAUSTION.md`.
- Force the DOM renderer globally as the "fix" — performance regression on
  large TUIs, and it hides the actual cause.
- Include terminal content in the glass snapshot pipeline (breaks the
  background-only snapshot design; perf + recursion hazards).
- Add per-frame MutationObserver/rAF watchers, or reintroduce a background
  terminal host (both conflict with the terminal-responsiveness constraint and
  `AGENTS.md`).

## Status

- 2026-07-05: investigation only. No files changed. Candidates unverified —
  run section 3 before choosing a fix.
