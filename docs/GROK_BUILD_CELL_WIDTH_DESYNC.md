# Grok Build terminal inline redraw stabilization

**Status:** patched on 2026-07-05.

This note documents the Grok Build terminal corruption fix that was validated
against the user-visible left-edge text artifact. It is intentionally
privacy-safe: screenshots and local machine paths are omitted.

## Symptom

When running **Grok Build** (`grok`) inside the app terminal, Korean/mixed-width
TUI output could leave stale fragments at the **front/left edge** of lines. The
rest of the line usually rendered correctly, but the first few cells could keep
old words after Grok wrote new progress or markdown-like frames.

The symptom was strongest in Grok Build panes and could reappear after Grok
wrote more output or after scrolling. A manual window resize could temporarily
make the pane look correct, which pointed at an xterm/WebView redraw or terminal
cell-state mismatch rather than broken shell data.

## Root cause model

The final fix treats this as a combined terminal-embedding problem:

1. Grok Build uses an inline TUI renderer that emits relative cursor moves,
   carriage-return redraws, and partial line updates.
2. xterm's newer Unicode width table can disagree with the renderer's effective
   cell-width assumptions for ambiguous punctuation and symbol cells.
3. xterm `convertEol` is useful for plain non-PTY streams, but LLM TUIs already
   own cursor movement and line redraw. Injecting CR behavior into their output
   can make inline diffs easier to desync.
4. Bare carriage-return redraws do not automatically erase cells left over from
   a previous, longer frame.
5. xterm WebGL can leave stale glyph/compositor fragments in this specific TUI
   path; clearing shared WebGL glyph state is too risky for other terminals.

The app therefore aligns the embedded terminal behavior around Grok instead of
trying to parse or rewrite Grok's full TUI protocol.

## Applied patch

### Grok-only launcher contract

Grok launcher panes now get a reduced embedded-terminal contract:

- `TERM=xterm`
- empty `COLORTERM`
- `LANG=C.UTF-8`
- `LC_ALL=C.UTF-8`
- `NO_COLOR=1`
- `FORCE_COLOR=0`
- forced `grok --no-alt-screen`

This is scoped to Grok launcher panes. Other shells and other LLM launchers keep
their existing command behavior.

### Grok-only DOM renderer in auto mode

When the global terminal renderer is `auto`, Grok panes now use xterm's DOM
renderer instead of WebGL. Other panes can still use WebGL.

This avoids the stale glyph fragments seen in Grok's aggressive redraw path
without clearing shared WebGL glyph atlases or disturbing healthy GL terminals.

### Grok-only Unicode width fallback

Grok panes use xterm's built-in Unicode 6 width provider. Other panes keep the
Unicode 11 add-on.

This is intentionally surgical: it targets Grok/OpenTUI-style inline redraw
desync without changing emoji or wide-symbol behavior in normal shells, Claude,
Codex, or other panes.

### Disable `convertEol` for LLM TUI panes

LLM launcher panes now use `convertEol: false`; plain shell panes keep the
previous behavior.

Reason: LLM TUIs own cursor movement and line redraw. xterm's `convertEol`
compatibility mode is more appropriate for simple streams and can interfere
with relative-cursor TUI output.

### Grok carriage-return cleanup

Grok output is normalized so bare carriage-return redraws clear to end-of-line
before the next partial repaint. This prevents stale cells from an older,
longer frame remaining at the left/front edge.

The cleanup is Grok-only and runs before xterm writes.

### Grok post-write and scroll refresh

After xterm's write queue drains, Grok panes get a throttled viewport refresh.
Scroll events can also trigger the same Grok-only refresh path.

The refresh is deliberately narrow and delayed until the write pipeline is
drained, so it does not add heavy synchronous work to normal terminal output.

## Verification

Repository-side verification for the patch:

- `npm run check`
- `npm run build`
- `git diff --check`

Runtime observation during the debugging session: after applying the Grok DOM
renderer, Grok Unicode width fallback, LLM `convertEol` change, CR cleanup, and
post-write refresh, the user observed the Grok Build left-edge artifact as
fixed. Continue to treat real Grok Build output as the authoritative smoke test,
because this bug depends on live TUI output and WebView rendering behavior.

## Non-goals and caution

- Do not switch Grok to fullscreen alt-screen as the fix. The app relies on
  inline scrollback/status parsing for Grok working/waiting detection.
- Do not change every terminal to Unicode 6. Keep the width fallback scoped to
  Grok panes only.
- Do not globally disable WebGL. Only Grok's redraw path needs DOM in auto mode.
- Do not add per-frame observers or heavy synchronous width recomputation on the
  terminal write path; terminal responsiveness is product-critical.

## Relevant code anchors

Search by symbol name rather than line number:

- `LLM_LAUNCHERS.grok`
- `terminalUnicodeVersionForLlm`
- `terminalConvertEolForLlm`
- `applyTerminalCompatibilityForLlm`
- `normalizeTerminalOutputForPaneWrite`
- `terminalLlmShouldUseWebglRenderer`
- `scheduleGrokTerminalViewportRefresh`
- `refreshTerminalViewportIfRecentOutput`
