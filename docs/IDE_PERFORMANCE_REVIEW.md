# IDE Performance Review (2026-07-04)

Whole-IDE performance audit: responsiveness (no lag/jank), freeze points, crash
points, and memory growth. **Audience: an LLM (or engineer) implementing fixes.**

Method: four parallel subsystem audits (terminal/PTY data path, UI-thread hot
paths & leaks, Rust backend, glass/CSS pipeline), findings cross-checked, and
every P0/P1 claim spot-verified against the actual working tree on the review
date. Line numbers are anchors from the 2026-07-04 **uncommitted** working tree
(`src/main.ts` ≈ 34.8k lines, `src-tauri/src/lib.rs` ≈ 9.4k lines) — re-locate
by symbol name if files drift.

Scope note: the liquid-glass optimization plan already exists in
`docs/LIQUID_GLASS_PERF_REVIEW.md` (capture dedup, workspace 60fps ticker, tilt
dispatcher, `preserveDrawingBuffer`, etc.). That document remains **canonical
for glass optimization** — its items are NOT repeated here. Section 4 lists only
glass findings *absent* from that document. Its hard constraints (no visual
degradation, no renderer caps, terminal responsiveness is product-critical)
apply to everything below.

Severity legend: **P0** = user-visible freeze/crash/blank likely in normal use ·
**P1** = noticeable lag in normal use · **P2** = lag/failure under load or edge
conditions · **P3** = hygiene/scaling debt. Symptom tags: `freeze` (UI thread
blocked), `crash` (process dies or renderer lost), `lag` (jank/latency),
`memory` (unbounded growth).

---

## 1. Freeze / crash points (fix first)

### F-1 [P0][freeze] Sync Tauri commands run long blocking I/O on the main thread
Non-async `#[tauri::command]` fns execute on the main thread in Tauri v2, and
several do unbounded blocking work:
- `copy_dropped_files` (`lib.rs:3715`) → `copy_local_path_to_remote`
  (`:7350-7371`): full `fs::read` per file + **one `ssh`/`wsl.exe` spawn per
  file** via `write_remote_file` (`:7373-7386`), each with a 90s timeout
  (`REMOTE_SHELL_COMMAND_TIMEOUT`, `:144`). Dropping a folder onto an SSH
  workspace freezes the whole window for seconds-to-minutes.
- `copy_profile_paths` (`:3741`), `save_clipboard_image_file` (`:3684`),
  `save_attachment` (`:3899`, base64 decode/encode + ssh spawn),
  `stop_port_forward` (`:4670`, waits on `taskkill /T /F`),
  `start_port_forward` (`:4652`, spawns `ssh.exe`),
  `probe_local_http_url` (`:4574`, 450ms connect timeout).

**Fix:** convert to `async fn` + the existing `run_blocking_command` wrapper
(already used by file ops at `:3080+`). Recursive remote copies: one
`tar | ssh` pipe instead of a process per file.

### F-2 [P0][freeze] `list_wsl_profiles` calls `wsl.exe` with no timeout on the main thread
`detect_wsl_distros()` (`lib.rs:5228-5244`, verified) runs
`wsl.exe -l -q` via `.output()` with **no** `command_output_with_timeout`
(unlike its siblings `:5266`, `:5281`), from a sync command (`:1554`). A wedged
WSL service — a common Windows condition — hangs the UI indefinitely at
startup/profile refresh.
**Fix:** async + `run_blocking_command`, 2-4s timeout, cache the result.

### F-3 [P1][freeze] `write_terminal` blocks the main thread on PTY backpressure
Sync command (`lib.rs:4628`, verified) → `write_terminal_bytes` (`:4104-4113`)
holds the per-session writer mutex across blocking `write_all` + `flush`, no
timeout. The frontend flushes keystroke batches every 4ms
(`TERMINAL_INPUT_BATCH_MS`, `main.ts:1569`), so this runs constantly while
typing. If the conpty/WSL pipe stops draining (paused pager, Ctrl+S, wedged
distro) the entire window blocks indefinitely.
**Fix:** per-session write queue drained by a dedicated writer thread; the
command just enqueues.

### F-4 [P1][freeze] `run_profile_shell_once` writes stdin before spawning readers — deadlock window
`lib.rs:7586-7596` (verified): `stdin.write_all(&data)` completes **before**
stdout/stderr reader threads exist, and before the 90s deadline loop starts. A
child that fills its output pipe while stdin is still pending deadlocks both
sides, and the timeout never fires because the parent is stuck in `write_all`.
Reachable from the F-1 sync commands ⇒ permanent UI freeze.
**Fix:** spawn readers first; write stdin from a helper thread (or chunked with
deadline checks between chunks).

### F-5 [P1][freeze] Startup synchronously parses up to 16MB of image-store JSON before first paint
`loadWorkspaceStore()` inside `init()` runs `loadWorkspaceImageStore()` →
`JSON.parse(localStorage.getItem(...))` with a 16MB budget
(`WORKSPACE_IMAGE_STORE_MAX_CHARS`, `main.ts:1526`, single values up to 6MB),
then computes signatures for all snapshots and a full persist-JSON prewarm
(`main.ts:4784-4805`). The code's own comment (`:5082-5084`) records that a
huge localStorage parse "can surface as a plain white/OOM renderer page".
**Fix:** lazy-parse the image store (first image-tab hydration or
`runWhenUiIdle`); defer the persist prewarm to idle. Only the compact main
store should block first render.

### F-6 [P0][crash/blank] WebGL context budget has no owner and no loss handling
Browsers cap live WebGL contexts (~16, oldest silently evicted). Current
allocators, each independent:
- Glass: one renderer **per plane** — titlebar + profile bar/2 cards + 3 window
  buttons + 8 floating panels + every terminal card + explorer-rows renderer +
  workspace-tab renderer + container renderer ⇒ **17+N contexts** (6 terminals
  ≈ 23). No cap exists (`APP_GLASS_MAX_LIQUID_RENDERERS` was removed; grep: 0
  hits — note `LIQUID_GLASS_PERF_REVIEW.md` forbids reintroducing caps, so the
  remedy is leak-fixing + loss-handling + the capture/consolidation work
  planned there).
- xterm: one `WebglAddon` context per pane (`main.ts:26325`); on
  `onContextLoss` the addon is disposed and `pane.webglContextLost = true`
  **permanently** — no re-acquire, pane falls back to the slow DOM renderer
  forever (`:26334-26351`).
- `webglcontextlost` is handled **nowhere**: 0 hits in both `src/main.ts` and
  `public/vendor/liquidgl/liquidGL.js` (verified). When eviction happens, glass
  planes silently freeze/blank with no recovery path.

**Fix (layered):** (1) fix the two glass context leaks (G-1, and dispose-order
issues already fixed for app renderers); (2) add `webglcontextlost`/`restored`
listeners that trigger CSS fallback + re-init; (3) xterm: load the WebGL addon
only on visible panes (dispose on hide, re-load on show) — bounds context count
AND restores lost contexts; (4) longer term, a central context registry so
glass/xterm/browser preview budgets are coordinated.

### F-7 [P2][crash] Startup `expect()` panics
`lib.rs:613-616` (verified): `TcpListener::bind(...).expect("bind local SSH
askpass broker")` + `.local_addr().expect(...)` — firewall policy or ephemeral
port exhaustion kills the whole app at launch. Also
`main_webview_window(...).expect("main window")` (`:9340`),
`window.set_title(...).expect(...)` (`:9375`).
**Fix:** log-and-degrade (askpass broker optional; skip title on failure).
Other runtime paths are clean — poisoned locks are handled via
`map_err`/`let Ok`.

### F-8 [P2][freeze] Agent bridge: `0.0.0.0` bind, inline accept handling, no read timeout
`lib.rs:1815` (verified): `TcpListener::bind(("0.0.0.0", 0))`; each connection
is handled inline in the accept loop (`:1831-1843`) with no
`set_read_timeout` on the stream. One stalled client (or any LAN host, given
the bind address) blocks all subsequent agent status events forever.
**Fix:** bind `127.0.0.1`, `set_read_timeout(2-5s)`, handle connections on
short-lived threads.

### F-9 [P2][freeze] Image-store persistence stringifies up to 16MB synchronously
`persistWorkspaceImageStoreIfNeeded()` (`main.ts:5074-5079`) does one
`JSON.stringify` + `localStorage.setItem` of the whole 16MB-budget store
whenever dirty (any image paste; ref churn during snapshot compaction) — a
multi-hundred-ms stall.
**Fix:** move image blobs to Tauri fs / IndexedDB (async), or persist per-key
entries so one paste writes only the new image.

### F-10 [P2][memory] Unbounded whole-file reads returned as single JSON responses
`read_text_file` (`lib.rs:3222-3243`) and `read_file_data_url` (`:3308-3329`)
read entire files (remote: unbounded `read_to_end`, `:7771-7775`),
base64-encode (+33%), and return one giant string — clicking a large file
allocates hundreds of MB and stalls webview deserialization.
**Fix:** stat first, enforce a 10-50MB cap with a clear error; stream big
previews via a custom URI scheme instead of data URLs.

---

## 2. Terminal responsiveness (input/output path)

The good news first (verified, keep): Rust batches output at 4ms/16KB; JS
rAF-batches `term.write`; keyboard input batches at 4ms/4KB with an immediate
path for control input — **no per-keystroke sync IPC**; ResizeObserver→fit→PTY
resize is rAF-debounced with dims-unchanged early-out; scrollback defaults to
1000 rows (max 10k); SerializeAddon unused. The problems are in what runs *per
IPC event* on top of that, and in flow control.

### T-1 [P1][lag] LLM status detection runs a multi-regex battery per IPC chunk
`handleTerminalData` (`main.ts:30553-30570`, verified) calls
`updateWorkspaceLlmTitleFromTerminalData` + `updateWorkspaceLlmWaitingFromOutput`
+ activity marking on **every** IPC event.
`normalizeTerminalOutputForLlmWaitingDetection` (`:13347-13356`, 8 regex
passes) executes up to 3× per chunk; classifiers run ~30-50 regexes, several
over the accumulated 6KB waiting buffer
(`WORKSPACE_LLM_WAITING_BUFFER_CHARS`, `:1614`) and 4KB title buffer with
`[\s\S]{0,900}`-class patterns. Detection is keyed to **IPC event arrival**,
not to the rAF write batching below it — under fast output (Rust emits per
16KB) this runs hundreds-thousands of times/sec on the UI thread.
**Fix:** throttle detection per pane (run at most every 150-250ms over the tail
accumulated since the last run); normalize once and pass the normalized text to
all classifiers.

### T-2 [P1][lag] History cache processes every output byte char-by-char, per event, on by default
`appendTerminalHistoryCache(pane, data)` is the first thing in
`handleTerminalData` (`main.ts:30561`). It runs
`stripTerminalHistoryControlSequences` (4 global regexes over the chunk,
`:27239`) then a per-character loop (`for (let index = 0; index <
text.length; index += 1)`, `:27248`, verified) building `currentLine` by
string concat. Default `terminalHistoryCache: 'balanced'` (`:2632`); runs at
IPC rate even for hidden panes whose xterm writes are deferred 900ms.
**Fix:** feed the history cache from the batched flush path (or an idle queue);
replace the per-char loop with `indexOf('\n')` segment scanning with a
control-char fast path.

### T-3 [P1][memory→lag] `pane.writeBuffer` is unbounded while drain is capped per flush
`pane.writeBuffer += data` (`main.ts:30612`, verified — no cap anywhere);
consumption is **one chunk per flush**: 16KB visible
(`TERMINAL_VISIBLE_WRITE_CHUNK_CHARS`, `:1585`) but only **2KB** during the
900ms window after user input (`:1587`, `:1610`). Right after pressing Enter on
a fast command, each event can append 16KB while flushes drain 2KB — the string
balloons; even steady-state drain (~1MB/s) is far below `yes`/`cat big.log`
throughput ⇒ multi-second display lag and potentially hundreds of MB in one JS
string.
**Fix:** cap the buffer (4-8MB, drop the middle with a `[... output trimmed
...]` marker) and drain with a per-frame **time budget** (loop `term.write`
chunks until ~4-6ms spent) instead of one fixed chunk.

### T-4 [P1][freeze-adjacent] No PTY→frontend backpressure; events broadcast to all webviews
Reader thread (`lib.rs:4020-4065`): 8KB reads; the batcher force-flushes
synchronously at 16KB (`:388-398`, `TERMINAL_OUTPUT_EVENT_FORCE_CHARS`
`:135`) ⇒ under `yes`, thousands of events/sec, each JSON-escaped into the
webview (ESC bytes inflate ~6× as ``). Emission uses `app.emit`
(`:424`) — `emit_to` appears **0 times** — so every payload is delivered to
every webview including browser previews. The frontend never acks; combined
with T-1/T-2 this saturates the main thread.
**Fix:** ack-window flow control (frontend acks consumed bytes; reader pauses
after N unacked — the xterm.js/VS Code pattern) and/or a per-terminal
`tauri::ipc::Channel` carrying raw bytes; `emit_to` the main window only; skip
the `from_utf8_lossy(...).to_string()` copy when UTF-8 is valid (`:9083`).

### T-5 [P1][lag] Output batcher spawns a new OS thread per 4ms flush window
`AppOutputBatcher::push` (`lib.rs:405-409`, verified):
`thread::spawn(|| { sleep(4ms); flush(); })` on every scheduled window — one
thread per keystroke echo during typing, up to ~250 threads/sec per trickling
terminal.
**Fix:** one long-lived flusher (channel + timer / condvar-parked thread) per
terminal or per app.

### T-6 [P1][lag] Process spawn per status poll: tmux titles polled every 1.2s per pane
`WORKSPACE_LLM_TMUX_TITLE_POLL_MS = 1200` (`main.ts:1624`), loop at
`:12717-12767` reschedules while status is `working` — exactly when terminals
are busiest. Each poll → `llm_tmux_pane_title` → `run_profile_shell_once`
(`lib.rs:7540-7628`): a **fresh `wsl.exe`/`ssh` spawn** + 2 reader threads + a
50ms `try_wait` poll loop. No SSH ControlMaster/ControlPath anywhere
(`push_ssh_background_options`, `:1188-1197`) ⇒ SSH profiles pay full TCP+KEX
per poll. The 12s freeze probe (`main.ts:1562`) and per-batch
`directory_signatures` spawns (`lib.rs:6042+`) ride the same connection-less
path.
**Fix:** one persistent control channel per profile — `tmux -C` control mode
or `ssh -o ControlMaster=auto -o ControlPersist=60s`; for WSL a persistent
helper process answering probes over stdin/stdout.

### T-7 [P2][lag] Per-chunk O(20k) array copy from history line counting
`terminalHistoryLineCount(pane)` runs **before** the `lineCount % 100 === 0`
gate (`main.ts:27316`) and `terminalHistoryLines` (`:27300`) returns
`[...cache.lines, cache.currentLine]` — a spread copy of up to 20k entries
whenever `currentLine` is non-empty (i.e. most of the time mid-stream). With
the history overlay open, `renderTerminalHistoryOverlay` also runs per chunk.
**Fix:** track the line count as an integer on the cache (it already tracks
`charCount`); throttle overlay re-render to ~250ms while streaming.

### T-8 [P2][lag] Snapshot replay pushes the whole backlog through the per-chunk pipeline as one string
`handleTerminalSnapshotData` (`main.ts:30590-30604`) calls
`handleTerminalData` with the full restored scrollback — one synchronous
strip+per-char history pass over everything (LLM detection at least is capped
to an 8KB tail).
**Fix:** slice replay into ~64KB segments through `runWhenUiIdle`, or bypass
the history cache for replayed content (it originated from history anyway).

### T-9 [P3][lag] DSR (`ESC[6n`) handling force-splits batches and force-drains 64KB synchronously
Every DSR occurrence triggers `batcher.flush()` + a separate cursor-query event
(`lib.rs:4122-4134`); the frontend then synchronously loops
`flushTerminalWriteBuffer` up to 64KB (`main.ts:20978-20988`,
`TERMINAL_CURSOR_QUERY_FLUSH_LIMIT_CHARS` `:1589`) before answering. TUI apps
that poll cursor position defeat the batching.
**Fix:** coalesce consecutive DSR queries per chunk; answer from parser-side
position after a normal batched write.

### T-10 [P3][lag] Split-group fit fans out to all panes during widget drag
`scheduleFitTerminalWidget` with `activeOnly` still iterates all panes of a
multi-pane group (`main.ts:29102-29118`); drag/resize paths call it per
gesture frame ⇒ 4 xterm `fit()` reflows/frame on a 4-split widget. The rAF
guard + dims-unchanged early-out prevent IPC storms, so this is minor.
**Fix:** defer fits to gesture end during widget-frame drags (the
`terminalSplitResizeWidgetIds` suppression already does this for split drags —
extend it).

---

## 3. UI-thread hot paths (typing / drag / resize / idle)

### U-1 [P1][lag] Notes typing runs a full-store `JSON.stringify` per keystroke
`handleNoteInput` → `upsertNoteMemoryRecord` → `compactNoteMemoryRecords`,
whose while-condition stringifies the **entire** note store (2MB budget,
`NOTES_MEMORY_STORE_MAX_CHARS` `main.ts:1532`) at least once per invocation
(`main.ts:16068`, verified) — i.e. per keystroke whenever ≥2 notes exist. The
420ms-debounced persist then repeats compact + stringify + synchronous
`localStorage.setItem` of up to 2MB (`:16081`).
**Fix:** in the upsert path only dedupe/count-limit; do the byte-budget check
once inside the debounced persist, tracking approximate size incrementally
(sum of `content.length`).

### U-2 [P1][lag] Glass settings fully re-normalized on every document pointermove — even with the feature off
`pointerover/pointerout/pointermove` are bound on `document`
(`main.ts:18012-18014`); `handleWorkspaceHoverOnlyPointerMove` first calls
`workspaceGlassHoverOnlyEnabled()` which builds a ~50-field normalized settings
object per event (`:7506-7510`, `:7622-7627`); when enabled it adds
`document.elementFromPoint` (forced hit-test) per move. Explorer twin:
`:22632-22637` → `normalizeAppGlassSettings` per move. This is
`LIQUID_GLASS_PERF_REVIEW.md` P1-7 — cross-referenced here because it fires
**even when glass is off** and sits directly on the input path.
**Fix:** revision-counter memoization per that doc; order the cheap boolean
eligibility check before any normalization; prefer pointerover/out targets over
elementFromPoint.

### U-3 [P2][lag] Floating-panel drag/resize: per-pointermove style writes + layout read, no rAF coalescing
Drag/resize `move` handlers run per raw pointer event (125-1000Hz mice) and
call `applyPanelRect` — writes `left/top/width/height` then immediately reads
`workspace.clientWidth/clientHeight` for the layout ratio (write→read forced
reflow per event) (`main.ts:20377-20389`, `:20533-20539`). Terminal split
resize was already fixed with rAF coalescing (`:28076-28088`); panel drag,
panel resize, and editor split resize (`:24945-24950`) were not. (The *glass*
refresh on this path IS rAF-coalesced — the residual cost is the raw style
write + ratio read.)
**Fix:** apply the `startTerminalSplitResize` latest-coords + rAF pattern;
hoist workspace client size into the drag-start capture (already read there).

### U-4 [P2][lag] Browser panel drag: full webview re-show chain + awaited IPC per frame
`scheduleNativeBrowserWebviewSync()` fires per drag move; the rAF callback runs
the full `showNativeBrowserWebview(tab, { boundsOnly: true })` path —
`hideAllBrowserFrames()`, CDP disconnect, double `getBoundingClientRect`, and
an awaited `api.showBrowserWebview` IPC with only a sequence counter (no
in-flight gate) ⇒ a new IPC per frame while previous ones are pending
(`main.ts:32145-32198`).
**Fix:** bounds-only fast path (skip frame-hide/CDP teardown) calling a cheap
`setBrowserWebviewBounds` IPC with an in-flight flag collapsing to one trailing
sync.

### U-5 [P2][lag] Workspace dock resizer rewrites a `:root` CSS variable per raw pointermove
`applySize()` runs per pointermove with no rAF and calls
`setRootStyleProperty('--workspace-dock-size', ...)` — invalidating layout for
the whole app grid — plus `syncWorkspaceDockSettingsForm()` per move
(`main.ts:13801-13815`).
**Fix:** rAF-coalesce with a latest-value variable; move the form sync to
pointerup.

### U-6 [P2][lag] Workspace tab drag: `elementFromPoint` + all-tab rects + class rewrites per move
`updateWorkspaceTabPointerDrag` → `workspaceDropTargetAt`
(`main.ts:13693-13716`): `document.elementFromPoint`, then on miss
`getBoundingClientRect()` for every tab; `setWorkspaceDropTarget` then rewrites
classes across all tabs — interleaved reads/writes per move.
**Fix:** cache tab rects at drag start (invalidate on reorder), rAF-coalesce,
touch only the two tabs whose marker changed.

### U-7 [P2][lag] Diagnostic log: per-entry synchronous persist + full popover rebuild
`appendDiagnosticLog` (`main.ts:11698-11705`) synchronously persists a
120-entry JSON snapshot (`:11761-11780`) and, when the popover is open,
rebuilds the full 400-entry text per entry (`:11846-11853`). With
`debugLogEnabled`, agent heuristics log per transition during output bursts.
**Fix:** debounce the persist 1-2s trailing (the 10s heartbeat is the floor);
append-only panel rendering.

### U-8 [P3][lag] Always-on timers doing avoidable work while idle/hidden
Verified inventory — only 4 `setInterval`s exist (good discipline), but:
(a) app clock 1s (`main.ts:4523`) writes DOM with no `document.hidden` gate;
(b) diagnostic heartbeat 10s (`:11790`) JSON.stringify + localStorage write
even when hidden and nothing changed; (c) saved-workspace auto-update 30s
(`:10934`) rebuilds the full snapshot + signature even when nothing changed;
(d) market-ticker REST fallback refetches every 30s even while the WebSocket
is live (`:10173`). (Renderer heartbeat 5s is an intentional watchdog;
explorer watch correctly backs off when hidden — keep both.)
**Fix:** `document.hidden` gates + dirty-flag checks + skip REST while
`marketTickerConnected`.

### U-9 [P3][lag] `saveActiveWorkspaceSnapshot` is O(entire workspace) per flush
60+ call sites; each debounced flush (260ms cadence during interaction,
`WORKSPACE_SNAPSHOT_DEBOUNCE_MS` `main.ts:1533`) rebuilds the complete
snapshot (all terminals/editor/image/note/browser tabs + histories) and a
~50-section signature string just to detect "no change"
(`:14413-14470`, `:14658-14709`). Acceptable today; scales linearly with
workspace size on the UI thread.
**Fix:** per-section dirty flags reusing unchanged section objects + cached
signature fragments.

### U-10 [P3][memory] Duplicate listeners accumulate on the reused primordial `.editor-pane`
`editorPaneElement()` re-adopts the existing DOM node after
`clearWorkspacePanels()` clears the cache on every workspace switch, and
unconditionally re-adds `pointerdown`/`focusin` listeners with stale `paneId`
closures (`main.ts:24895-24913`, cache clear `:21481`).
**Fix:** `dataset.listenersBound` guard; read pane id from
`dataset.editorPaneId` inside the handler.

---

## 4. Glass pipeline — findings NOT in LIQUID_GLASS_PERF_REVIEW.md

That doc's plan (P0-1/2 capture dedup, P0-3 workspace ticker, P1-4..9, P2-10..14
+ rejected ideas R1-R4) stands. The following are **additions** discovered in
this audit:

### G-1 [P0][memory/leak] Container renderer is never disposed — context + rAF loops leak per rebuild
`removeWorkspaceContainerGlassLenses` (`main.ts:8198-8210`, verified) filters
lenses, removes the canvas, and nulls
`__sviWorkspaceContainerLiquidGLRenderer__` — but never calls
`renderer.dispose()`. The vendored per-frame render loop
(`liquidGL.js:2126-2132`), constructor scroll-poll rAF (`:120-132`), window
resize listener, and ResizeObserver keep running against a detached canvas, and
the WebGL context is never released. Every container-glass rebuild leaks one
context + two rAF loops — accelerating F-6 context exhaustion.
**Fix (1 line):** call `renderer.dispose?.()` before nulling the global.

### G-2 [P1][lag] Per-lens `_sizeObs` ResizeObserver stays active for the renderer's whole life
Each lens installs a ResizeObserver → `updateMetrics()` + `renderer.render()`
(`liquidGL.js:1502-1508`). `disableAppGlassRendererInternalObservers` clears
only renderer-level observers; `lens._sizeObs` is disconnected **only at
removal** (`main.ts:9218`). During panel resize the app path already renders
once per frame (rAF-coalesced owner refresh), and `_sizeObs` fires again ⇒ ≥2
renders + duplicate `ensureAppGlassRendererLayer` work (computed-style clip,
tilt-follower re-install, mirror repositioning) per frame.
**Fix:** disconnect `lens._sizeObs` at adoption in
`createAppGlassRendererForTarget` (geometry is already driven app-side).

### G-3 [P2][blank] `init-failed` CSS-fallback planes never retry
Planes marked `appGlassLens='css'` + `appGlassFallbackReason='init-failed'` are
skipped forever (`main.ts:8677`, `:8720`; `cleanupAppGlassTarget` preserves the
marker `:9170-9173`); only full glass-off clears it. With no renderer cap,
capacity problems manifest as init failures — and those planes are never
promoted back when contexts free up.
**Fix:** clear `init-failed` whenever a renderer is removed (slot freed) or on
settings-driven retry.

### G-4 [P2][lag] `ideBackground` sliders schedule full N-renderer recapture storms while scrubbing
`handleGlassSettingsControlChange` (`main.ts:7255-7277`) schedules workspace +
explorer + app recaptures for any `ideBackground.*` change; range inputs fire
`input` continuously and the 160-180ms debounce only coalesces per pause ⇒
repeated multi-second capture storms during a slow scrub (multiplied by the
missing capture dedup — see the canonical doc's P0-1).
**Fix:** recapture on `change` only; on `input` re-apply background CSS +
`render()`.

### G-5 [P2][hygiene] Dead-code footgun: geometry-recursive recapture path
`scheduleAppGlassGeometryRefresh` (`main.ts:9589`) has zero callers and
`refreshAppGlassGeometry` is only called without options (`:9598`) — but if
ever wired, the options path fires N un-awaited captures **and** schedules a
second full pass (`:9603-9609`) ⇒ 2N captures per invocation. No infinite
chain exists today (the apply/schedule ping-pong is bounded by the single
coalescing timer + `finally` flag clear).
**Fix:** delete the dead path, or fix it before someone wires it up. Add a
capture-generation token so a queued recapture is skipped when the just-finished
pass already covered it.

### G-6 [P3][memory] Every vendored renderer spawns a blob Worker that `dispose()` never terminates
Constructor creates an inline Worker whenever OffscreenCanvas exists
(`liquidGL.js:203-249`); `dispose()` (`:430-473`) removes the style element but
never `worker.terminate()`s nor revokes the blob URL. The app registers zero
dynamic nodes, so these are dead workers — one leaked per create/dispose cycle
(frequent for terminal-card renderers).
**Fix:** lazily create the worker on first dynamic-node registration; terminate
in `dispose()`.

### G-7 [P3][lag] CSS: fallback blur pile-up and infinite box-shadow pulses
- Base `.app-glass-plane` carries `backdrop-filter: blur(10px) saturate(1.18)`
  (`styles.css:846-860`); liquidGL-active planes escape via inline override —
  but in a mass-fallback scenario (context exhaustion) ~14+N simultaneous blur
  surfaces stack with titlebar/dock/overlay blurs (20 `backdrop-filter`
  declarations total).
- LLM status dots animate `box-shadow` on infinite 1.05-1.25s keyframes
  (`styles.css:1993-2023`, glass variants `:2414`, `:2433`, `:2750`) —
  continuous repaint per running-LLM tab, forever. (They live outside the
  snapshot stage, so they at least don't invalidate glass.)
**Fix:** scope plane blur to explicit fallback state; pulse via
opacity/transform on a pre-rendered glow pseudo-element.

---

## 5. Cross-cutting themes

1. **localStorage-as-database on the UI thread.** Notes (2MB), images (16MB),
   diagnostics (120 entries/entry-append), workspace snapshots — all persist
   via synchronous `JSON.stringify` + `localStorage.setItem` on interaction
   paths (U-1, F-5, F-9, U-7, U-9). Direction: async persistence (Tauri fs /
   IndexedDB), budgeted+debounced writes, incremental size accounting.
2. **Process-spawn-per-poll.** tmux titles (1.2s × panes), directory
   signatures, freeze probes — each a fresh `wsl.exe`/`ssh` with no connection
   reuse (T-6). Direction: persistent control channels (tmux -C, SSH
   ControlMaster, resident WSL helper).
3. **Work keyed to IPC event rate instead of the existing batching layer.**
   The rAF write batcher exists, but LLM detection (T-1) and the history cache
   (T-2) hook the raw event. Direction: move consumers behind the flush.
4. **No WebGL context budget owner** (F-6): glass, xterm, and previews allocate
   independently with zero loss handling. Direction: leak fixes → loss
   handlers → central accounting.
5. **Raw-pointermove handlers.** Several drag paths still do write→read layout
   per event (U-3, U-5, U-6, U-2); the codebase already has the correct
   pattern (terminal split resize, owner-scoped glass refresh) — apply it
   uniformly.

## 6. Quick wins (low risk, ordered by value/effort)

1. **G-1** container `dispose()` — 1 line, stops a context+rAF leak.
2. **F-2** `wsl.exe` timeout + async — small, kills a common whole-app freeze.
3. **U-8** idle-timer gates (`document.hidden`, dirty checks, WS-connected).
4. **T-5** persistent flusher instead of thread-per-4ms.
5. **U-1** move the notes byte-budget stringify into the debounced persist.
6. **G-2** disconnect `lens._sizeObs` at adoption.
7. **T-1/T-2** throttle LLM detection; feed history cache from the flush path.
8. **F-7** replace startup `expect()`s with log-and-degrade.
9. **G-4** recapture on `change` only for background sliders.
10. **T-4 (partial)** `emit_to` main window instead of `app.emit` broadcast.

## 7. Suggested implementation order

- **Phase 1 — stability (freeze/crash):** F-1, F-2, F-3, F-4, F-7, F-8, G-1,
  F-6 loss handlers (+ xterm addon lifecycle).
- **Phase 2 — terminal throughput:** T-3 (buffer cap + time-budget drain), T-4
  (flow control + emit_to), T-5, T-1, T-2; then T-6 (control channels).
- **Phase 3 — interaction smoothness:** U-1, U-3, U-4, U-5, U-6, U-2 (with the
  canonical doc's P1-7), G-2, G-4.
- **Phase 4 — hygiene/scaling:** F-5, F-9, F-10, U-7..U-10, T-7..T-10, G-3,
  G-5..G-7.
- **Glass optimization track** proceeds independently per
  `LIQUID_GLASS_PERF_REVIEW.md` PR-1..PR-6 (its P0-1/P0-2 capture dedup also
  neutralizes the multiplier behind G-4 and most recapture-storm costs).

Regression bar for every phase (same as the glass doc): type into a terminal
during the heaviest concurrent activity the phase touches — no visible input
lag. That is the product bar.

## 8. Verified clean — do not re-litigate

- **Input path:** keyboard batching 4ms/4KB with immediate control-input path;
  no sync IPC per keystroke (`main.ts:21033-21073`).
- **Output batching exists at both layers** (Rust 4ms/16KB; JS rAF chunked
  writes with visibility-aware chunk sizes).
- **Fit/resize chain** rAF-debounced, resizes PTY only on actual dims change
  (`main.ts:29322-29366`).
- **Explorer** is properly virtualized: windowed rows + spacers, incremental
  patching, rAF-gated scheduling with hidden-panel dirty flag, LRU row cache
  (768) with idle pruning (`main.ts:22231-22563`).
- **Workspace dock renders** are signature-guarded at three levels with a
  450ms open-detail throttle; no hot-path innerHTML rebuilds
  (`main.ts:13542-13553`).
- **LLM activity indicator path** bypasses full tab re-render (see canonical
  doc R3).
- **Leak hygiene** broadly strong: pruned element caches, WeakMap part caches,
  note timers cleared on workspace clear, agent-progress maps deleted on pane
  close, capped browser console logs, symmetric image-preview listeners.
- **Rust locks:** poisoned-lock handling via `map_err`/`let Ok`; no
  mutex-held-across-await found (the F-3 writer mutex issue is
  blocking-write-under-lock, not an await issue).
- **Snapshot stage is background-only** — html2canvas never walks the app DOM
  (`main.ts:3721`, `styles.css:553-568`); per-capture cost is gradient/noise
  rasterization (see canonical doc for the dedup plan).
