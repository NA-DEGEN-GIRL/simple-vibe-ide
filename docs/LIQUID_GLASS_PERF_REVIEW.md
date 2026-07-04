# Liquid Glass Performance Review (2026-07-02)

Performance optimization plan for the app-wide liquidGL glass implementation.
**Audience: an LLM (or engineer) implementing these changes.** Every claim below was
verified against the actual code by adversarial review (one pass attacking
code-applicability, one pass hunting for pixel-difference scenarios). Line numbers
are anchors from the review date — re-locate by function name if the file has drifted.

## Hard constraints (do not violate)

- Do **not** visually degrade the glass effect. Target is pixel-identical output.
- Do **not** replace real liquidGL with CSS `backdrop-filter` fallback.
- Do **not** reintroduce renderer caps or lower snapshot resolution / effective DPR.
- Terminal responsiveness is product-critical: no new synchronous heavy work on the
  WebView main thread; prefer removing work from input paths.
- Prefer narrow changes in `src/main.ts` / `src/styles.css`. The vendored
  `public/vendor/liquidgl/liquidGL.js` may be patched (it is vendored), but keep diffs minimal.

---

## 1. Verified architecture facts (read before changing anything)

These facts are load-bearing for every recommendation:

1. **One renderer per glass target.** Every app-glass target (titlebar, each
   window-control button, profile/actions cards, each floating panel, **each terminal
   card**) gets its own isolated `liquidGLRenderer` — a separate WebGL context and a
   **full-viewport canvas** (`createAppGlassRendererForTarget` `src/main.ts:7911`,
   `appGlassRenderers` map `src/main.ts:3330`, isolation trick
   `createIsolatedWorkspaceLiquidGL` `src/main.ts:6865`). Additionally:
   `window.__liquidGLRenderer__` = workspace dock rows renderer,
   `window.__sviWorkspaceContainerLiquidGLRenderer__` = container renderer,
   `explorerLiquidGlassRenderer` = one shared renderer for all explorer rows.
2. **The snapshot source is background-only.** All renderers snapshot the same
   `#ide-glass-snapshot-stage` (`src/main.ts:3368`), which contains only the
   procedural gradients / wallpaper `<img>` / grid+noise pseudo-elements set by
   `applyIdeBackgroundSettings` (`src/main.ts:5791-5824`). Its pixels change **only**
   when background settings change, the wallpaper loads, viewport size changes, or
   `--ide-scale` changes. Widget drag/create/visibility **cannot** change it — yet
   those events currently schedule full recaptures.
3. **Full recapture is N sequential html2canvas passes of identical content.**
   `applyAppLiquidGlass(recapture=true)` (`src/main.ts:7865-7909`) loops all renderers
   and sequentially `await`s `captureSnapshot()` on each — with 10–20 targets that is
   10–20 identical main-thread rasterizations. The `liquidGLRenderer` constructor
   *also* auto-captures (`liquidGL.js:182`), so renderer creation double-captures.
   `captureSnapshot`'s `_capturing` guard (`liquidGL.js:477`) **silently drops**
   concurrent requests (returns `undefined` while another capture is in flight).
4. **App/explorer renderers are event-driven; the two workspace renderers are not.**
   `disableAppGlassRendererInternalObservers` (`src/main.ts:7994`) cancels the vendored
   RAF loop, scroll-poll RAF, resize listener and ResizeObserver — but it is only
   applied via `ensureAppGlassRendererLayer` (`:8296`) and
   `ensureExplorerLiquidGlassCanvasLayer` (`:8613`). The **workspace rows + container
   renderers run a permanent 60fps RAF** (`liquidGL.js:2100-2106`) plus a second
   scroll-poll RAF (`liquidGL.js:118-132`) forever while dock glass is on.
5. **`render()` has no dirty flag and does heavy layout reads per call**
   (`liquidGL.js:637-708`): per lens `updateMetrics()` = `getBoundingClientRect` +
   `getComputedStyle` (+ shadow-sync second gBCR); `_renderLens` reads
   `snapshotTarget.getBoundingClientRect()` **twice per lens** (`:735-736`);
   `_updateDynamicNodes` has **no early-out when empty** (`:918-925`) and pays a stage
   gBCR + `_getMaxLensZ()` (an `effectiveZ` `getComputedStyle` ancestor walk per lens)
   even though the app registers zero dynamic nodes and zero videos.
6. **Tilt is default-on and installs one document-level `pointermove` listener per
   lens** (`liquidGL.js:1917-1941`, defaults `tilt: true, tiltFactor: 20` at
   `src/main.ts:2016-2017`). Each listener calls `this.el.getBoundingClientRect()` on
   **every mouse move anywhere in the app**. While hovering a lens, `_applyTilt` writes
   transforms then calls `renderer.render()` per move. Active tilt mirrors copy the
   **entire full-viewport WebGL canvas** into a 2D canvas per render
   (`liquidGL.js:667-679`).
7. **Specular (`u_time`) matters for one decision only:** the shader animates specular
   highlights with time (`liquidGL.js:360-367`). App renderers are event-driven so their
   specular is already frozen between events; the workspace renderers' 60fps loop makes
   *their* specular genuinely animate. Any change that stops the workspace loop must
   gate on specular to preserve this (see P0-3).
8. **The only cross-task WebGL canvas readback** is the container composite
   `ctx.drawImage(rendererCanvas, ...)` at `src/main.ts:6944`
   (`syncWorkspaceGlassContainerSnapshotSurface`). Mirror copies happen *inside*
   `render()` (same task). This matters for P1-9 (`preserveDrawingBuffer`).

---

## 2. Prioritized recommendations

Legend — **Visual risk**: none = verified pixel-identical / low = safe with listed
corrections / ⚠ = has a real trap, corrections mandatory. **Complexity**: low/medium/high.

### P0 — capture pipeline (largest wins)

#### P0-1. Capture the stage ONCE per recapture wave; fan the canvas out to all renderers
- **Change (`src/main.ts`, small patch in `liquidGL.js`):**
  - Add `captureSharedStageSnapshot()`: run html2canvas **once** on
    `#ide-glass-snapshot-stage` per wave; feed the resulting canvas to each renderer via
    the existing `renderer._uploadTexture(canvas)` (`liquidGL.js:567`).
  - Use it in `applyAppLiquidGlass` (both the reuse branch `:7901` and creation `:7953`),
    explorer creation (`:8729`), and the container renderer (`:6961`).
  - Fix the drop-guard race in `captureSnapshot` (`liquidGL.js:476-564`): store and
    return the in-flight promise instead of returning `undefined` when `_capturing`.
  - For renderer creation, support an `initialSnapshot` canvas option so the constructor
    (`liquidGL.js:182`) does not rasterize again. **Never pass a bare
    "defer initial snapshot" flag without providing `initialSnapshot`** — a renderer with
    no texture renders nothing until the next wave.
- **Benefit:** window-resize recapture: ~14+ html2canvas passes → 1. Terminal-create:
  2 → 0–1. Removes the single largest main-thread stall class.
- **Visual risk:** none (same pixels, same uploads). **Complexity:** medium.
- **Validation:** `console.count('h2c')` before the html2canvas call
  (`liquidGL.js:528`) and `console.count('upload')` in `_uploadTexture`. Toggle the
  notes panel / resize window / create a terminal → capture counts collapse as above
  while upload counts stay N. Screenshot A/B (titlebar + one panel + one terminal card):
  pixel-identical.

#### P0-2. Skip recaptures when the stage provably didn't change (stage version counter)
- **Change (`src/main.ts`):** keep a module-level `ideGlassStageVersion`, bumped in:
  `applyIdeBackgroundSettings`, wallpaper `<img>` load/error listeners (`:5851-5852`),
  viewport size / DPR change, and **both `--ide-scale` writers** (`setIdeScale`
  ~`:18170` and the workspace-snapshot restore that sets `--ide-scale` ~`:14317` —
  verified easy-to-miss invalidation sources). More robustly: store the stage's
  `scrollWidth/scrollHeight` alongside the cached canvas and treat any size mismatch at
  reuse time as a cache miss. Each renderer records the version it last uploaded;
  `applyAppLiquidGlass` skips capture+upload when current.
- **Mandatory correction (from verification):** only skip renderers whose
  `snapshotTarget === el.ideGlassSnapshotStage`. When
  `workspaceGlassUsesContainerSnapshot()` is true, the rows renderer samples the
  **container** stage — always run its capture (`:7149-7154`) on recapture passes.
  Do **not** gate `applyWorkspaceDockSettings`'s recapture call (`:8903`) by this
  mechanism alone (see Rejected R2 for why that call site is special).
- **Benefit:** composes with P0-1 — visibility toggles and terminal creation reach
  **zero** captures. Existing trigger sites keep their semantics (safer than rewiring
  each trigger).
- **Visual risk:** low — only failure mode is a missed invalidation source; the
  size-tag fallback covers geometry, the listed bumps cover content. **Complexity:** medium.
- **Validation:** with P0-1 counters: toggle a panel 5× → 0–1 captures total
  (baseline ~10 each). Change background base color → exactly 1 shared capture.
  Resize → 1. Wallpaper set → 1 after load event.

#### P0-3. Take the workspace rows + container renderers off the vendored 60fps loop
- **Change (`src/main.ts`):** apply `disableAppGlassRendererInternalObservers` to
  `window.__liquidGLRenderer__` and the container renderer; drive them event-driven
  like app renderers. **Specular gate (mandatory for visual parity):** when any
  workspace lens has `specular: true`, keep ONE main.ts RAF ticker calling the
  **wrapped** `render()` (the hover-only filter wrapper at `:6791-6809` must stay
  effective); when specular is off, no loop at all.
- **Mandatory wiring fix:** `resizeAppGlassRendererCanvasForViewport` →
  `_resizeCanvas` (`liquidGL.js:420-427`) **blanks the canvas**. In
  `scheduleWindowResizeWork` (`src/main.ts:17015-17037`), immediately after resizing
  each workspace renderer's canvas, call that renderer's wrapped `render()` in the
  same RAF, unconditionally of specular/ticker state — resize events fire ~per frame
  during a drag, so this reproduces today's per-frame tracking and prevents glass
  vanishing mid-gesture.
- **Also:** the vendored per-renderer resize listener + ResizeObserver
  (`liquidGL.js:134-161`) currently cause **duplicate recaptures** on window resize for
  workspace renderers; disabling them removes that duplication (window-resize recapture
  is already scheduled by main.ts at `:17035`).
- **Benefit:** removes a permanent 60fps loop of per-lens layout reads + GL draws on
  two renderers — the largest *continuous* CPU drain in the steady state.
- **Visual risk:** none **with** the specular gate + resize fix; **without the gate it
  is a real visible change** (dock-row specular highlights freeze). **Complexity:** medium.
- **Validation:** `console.count` inside the rows renderer's wrapped render. Idle
  Performance trace: ~60 calls/s → 0 (specular off) with empty flame chart; specular
  on → still 60/s and highlight animation unchanged. Live window-resize drag: dock
  glass stays painted every frame.

### P1 — hot paths (cheap, high leverage)

#### P1-4. Slim the vendored `render()` (pixel-identical)
- **Change (`liquidGL.js`):**
  1. Early-return `_updateDynamicNodes` when `this._dynamicNodes.length === 0`
     (guard at `:921` currently only checks `!this.texture || !this._dynMeta`, and
     `_dynMeta` is an always-present WeakMap).
  2. Hoist the duplicated `this.snapshotTarget.getBoundingClientRect()` out of
     `_renderLens` (`:735-736`) — compute once per `render()` pass and pass it down /
     cache on a per-pass token.
- **Benefit:** per-render forced-layout reads drop from ~3N+2 to ~N+1 for N lenses;
  biggest effect on the multi-lens renderers (explorer rows, dock rows). Also removes
  the per-render `effectiveZ` `getComputedStyle` ancestor walks from `_getMaxLensZ`.
- **Visual risk:** none (verified identical — dynamic-node and video paths are dead
  code in this app: no `registerDynamic` callers, zero `<video>` elements).
  **Complexity:** low.
- **Validation:** wrap `Element.prototype.getBoundingClientRect` with a counter in
  devtools; call `window.__liquidGLRenderer__.render()` once with N dock tabs → count
  drops as above. Screenshot A/B: dock, floating panel, explorer rows (specular on and
  off) — pixel-identical.

#### P1-5. Delete redundant pre-render `updateMetrics` loops in main.ts
- **Fact:** `render()` unconditionally re-runs `updateMetrics` on every lens
  (`liquidGL.js:659-660`), so explicit loops immediately before `render()` are double
  work.
- **Corrected scope (mandatory):**
  - DELETE the loop in `refreshLiquidGlassGeometryForOwner` (`src/main.ts:7833-7835`;
    keep `ensureAppGlassRendererLayer` and `renderer.render()`) — this is the
    per-drag-frame win.
  - In the `applyAppLiquidGlass` reuse branch (`:7900`), run the loop **only when**
    `recaptureSnapshot` is true.
  - **KEEP** the loop in `applyWorkspaceLiquidGlass` (`:7147-7149`) — the hover-only
    render wrapper filters lenses, so this pre-loop is the only metrics writer for
    filtered-out lenses.
- **Benefit:** halves layout reads on the widget drag/resize/focus/z-order path.
- **Visual risk:** none with the corrected scope. **Complexity:** low.
- **Validation:** gBCR counter during a widget drag: reads per frame halve; drag /
  drop / z-order / tilt-suspend visuals unchanged.

#### P1-6. One shared tilt pointermove dispatcher (replaces K document listeners)
- **Change:** patch `_bindTiltHandlers` / `_unbindTiltHandlers` (vendored, or app-side
  patching like the existing mirror patches at `src/main.ts:8095`) so lenses register
  in a Set consumed by ONE document `pointermove` handler running two phases:
  read phase (all rect hit-tests), then write phase (tilt transforms), then **one**
  coalesced `renderer.render()` per affected renderer per event.
- **Constraints (from verification, all mandatory):**
  1. Do NOT remove `renderer.render()` from `_applyTilt` / `_smoothReset` — they are
     also invoked by element-local mousemove (`liquidGL.js:1868`), touch handlers
     (`:1870-1886`) and the enter RAF follow-up (`:1858-1861`); coalesce only within
     the dispatcher invocation (per-renderer defer flag around phase 2).
  2. All tilt state stays on the lens object (`_tiltActive`, `_tiltInteracting`,
     `tiltX`, `tiltY`) — main.ts writes these directly
     (`resetHoverOnlyLiquidGlassLens` `:6766-6769`, `resetLiquidGlassLensTilt`
     `:7753-7756`). The dispatcher owns only the Set + installed flag.
  3. Snapshot the Set before iterating (handlers can unbind lenses mid-dispatch).
- **Benefit:** mouse movement anywhere (incl. over the terminal) goes from K×gBCR with
  write→read layout thrash to one batched pass. Direct input-latency win.
- **Visual risk:** none (enter/leave/tilt semantics preserved). **Complexity:** medium.
- **Validation:** Performance trace waving the cursor over the terminal with ~12 glass
  targets: forced-layout count per event drops from K to ~1 batch. Hover enter/leave
  tilt behavior unchanged, including rapid re-entry (mirror cleanup timer path
  `liquidGL.js:1838-1846`).

#### P1-7. Memoize glass settings normalization + hover-only flags
- **Fact:** `workspaceGlassHoverOnlyEnabled()` (`src/main.ts:6738-6742`) builds a
  ~95-field normalized object + clone on EVERY call; it runs per document pointermove
  (`:6855`, listener `:16668`), per pointerover/out (`:6840/:6846`), and per render of
  the rows renderer (inside the wrapper `:6798`). Explorer twin
  `explorerGlassHoverOnlyEnabled` (`:8424`) normalizes appGlass per call.
- **Change:** memoize `normalizeWorkspaceGlassSettings` and `normalizeAppGlassSettings`
  keyed on a **revision counter bumped in `setSettingValueAtPath`** (`:6462-6473`, the
  single choke point covering nested `effect.*` writes) **and** at the in-place write
  in `updateWorkspaceGlassEnabled` (`:6656`). Bumping only in `applyIdeSettings` is NOT
  sufficient (reads at `:6594-6601` happen before it runs). Cache the hover-only
  booleans off the same revision. Coalesce the per-pointermove
  `document.elementFromPoint` hit-tests to one per animation frame.
- **Benefit:** removes a per-pointermove allocation storm (GC pressure on the input
  path) present whenever workspace glass is eligible — even with hover-only OFF.
- **Visual risk:** none with revision-counter keying. **Complexity:** low.
- **Validation:** devtools allocation sampling while moving the mouse → normalized-
  object allocations reach zero. Toggle hover-only and glass settings → behavior
  switches immediately (proves the bump sites are sufficient).

#### P1-8. `texSubImage2D` texture reuse when snapshot dimensions unchanged
- **Change (`liquidGL.js` `_uploadTexture` `:567-616`):** when
  `srcCanvas.width === this.textureWidth && srcCanvas.height === this.textureHeight`,
  use `gl.texSubImage2D` instead of the reallocating `gl.texImage2D`; move the four
  constant `texParameteri` calls (`:602-605`) into the allocation branch. (The texture
  object is created once at `:591` and never deleted — verified.)
- **Benefit:** avoids texture storage realloc / driver stalls on every recapture,
  multiplied across all renderers.
- **Visual risk:** none (verified identical). **Complexity:** low.
- **Validation:** change background color repeatedly with glass on: pixels identical;
  GPU memory graph stops sawtoothing on recaptures.

#### P1-9. Drop `preserveDrawingBuffer: true`
- **Fact (verified audit of every canvas read):** mirror copies happen inside
  `render()` (same task — spec-safe without preservation). The ONLY cross-task read is
  the container composite at `src/main.ts:6944`, and one of its callers
  (`syncWorkspaceGlassSnapshotStage:6896` →
  `syncWorkspaceGlassContainerSnapshotSurface`) reads without a same-task render.
- **Change:**
  1. Plumb the option through the vendored factory: `window.liquidGL` constructs via
    `new liquidGLRenderer(options.snapshot, options.resolution)` (`liquidGL.js:2084`)
    and forwards nothing else — pass a third argument (default `true` when undefined,
    to keep the library's standalone behavior).
  2. Pass `preserveDrawingBuffer: false` from every main.ts creation site
    (`:7016`, `:7068`, `:7108`, `:7919`, `:8694`).
  3. Add a synchronous same-task `renderer.render()` before the read inside
    `syncWorkspaceGlassContainerSnapshotSurface` (must execute in the same task as the
    `drawImage`, not scheduled).
- **Benefit:** enables double-buffered swaps on ~15 full-viewport WebGL contexts —
  real compositor + memory savings.
- **Visual risk:** low; the single risky path is covered by render-before-read.
  **Complexity:** low.
- **Validation:** container-glass mode on, toggle dock / change settings: composite
  canvas shows glass (never blank). Tilt a widget: mirror content correct mid-tilt.

### P2 — narrower or higher-effort

#### P2-10. Container composite once (not twice) per `applyWorkspaceLiquidGlass` pass
- **Change (`src/main.ts:7055-7064` + `:7150-7155`):** collapse to
  `if (wantsContainerSnapshot) { syncWorkspaceGlassSnapshotStage(); syncWorkspaceGlassRendererSnapshotTarget(); } await refreshWorkspaceContainerGlassComposite();`
  with a pass-local `containerCompositeDone` flag; skip the second
  `refreshWorkspaceContainerGlassComposite()` in the recapture tail when set. Keep the
  rows-renderer `captureSnapshot` at `:7154` (it consumes the composite stage).
  Note: the two branch bodies are **not** byte-identical — the if-branch has two extra
  sync calls; the collapsed form above preserves them.
- **Verified safe because:** zero awaits exist between the two composite calls
  (`window.liquidGL()` is fully synchronous), so no DOM mutation can interleave.
- **Benefit:** halves the container html2canvas capture + full-shell 2D composite
  (incl. a WebGL readback) per recapture in container mode.
- **Visual risk:** none. **Complexity:** low.
- **Validation:** `console.count` in `refreshWorkspaceContainerGlassComposite`; enable
  `containerGlassEnabled` + `rowSamplesContainer`, change background color → count per
  debounced apply drops 2 → 1. Dock-row pixels identical.

#### P2-11. Narrow the tilt-mirror `drawImage` to the lens rect
- **Change (`liquidGL.js:667-679`):** copy only `ln.rectPx` + ~32px margin instead of
  the full viewport canvas per render while tilting.
- **Mandatory corrections:** (1) NO `clearRect` — plain source-over region drawImage
  keeps per-pixel history byte-identical to today's full copy by induction. (2) Derive
  scale from the actual bitmap: `kx = this.canvas.width / innerWidth`,
  `ky = this.canvas.height / innerHeight` (not `devicePixelRatio`). (3) Guard
  `sw > 0 && sh > 0` (zero-size source rect throws `IndexSizeError`); fall back to the
  full copy (or skip) if `ln.rectPx` is missing.
- **Verified safe because:** during tilt, `rectPx` is pinned to `_baseRect`
  (`liquidGL.js:1486-1497`) and both clip implementations (vendored `:1996-2006`, app
  `clipAppGlassViewportMirror` `src/main.ts:8068-8079`) use the same `_baseRect`, so
  the clip region is always a subset of the copy region.
- **Benefit:** per-frame copy bandwidth during hover-tilt drops ~10–50×.
- **Visual risk:** none with corrections. **Complexity:** low.
- **Validation:** tilt a widget over a busy background; screenshot mid-tilt A/B;
  hide-while-tilting edge case does not throw.

#### P2-12. Cache computed border-radius in `updateMetrics` ⚠
- **Change (`liquidGL.js:1486-1518`):** cache the parsed border-radius per lens,
  recompute only when the rect size changed (covers `%` radii) or on explicit
  `lens.invalidateStyleCache()`. Reuse the `updateMetrics` rect in `syncShadow`
  instead of its second gBCR.
- **⚠ Mandatory corrections (this is the one item with a real subtle-visual trap):**
  1. Invalidate **synchronously in the same task** that writes radius CSS variables:
     `applyWorkspaceGlassSettings` (after `src/main.ts:5885`) and
     `applyAppGlassSettings` (after `:6100/:6113`) must iterate all live lenses and
     call `invalidateStyleCache()`. Without this, radius-slider changes lag one
     interaction.
  2. `syncShadow` is also registered as a window `resize` listener
     (`liquidGL.js:1630`) and called with no args (`:1634`) — accept the rect argument
     defensively (use it only if it has numeric left/top/width/height).
  3. Verified: styles.css has no border-radius transitions and no non-settings state
     class changes a lens element's radius — the settings hooks are the complete
     invalidation set today; re-verify if new hover/active radius styles are added.
- **Benefit:** removes the per-render `getComputedStyle` per lens (multiplied on
  multi-lens renderers). **Complexity:** medium. Do after P0/P1.
- **Validation:** drag every radius-affecting slider and confirm the glass radius
  updates within the same apply; hover/active states on rows/tabs unchanged.

#### P2-13. `createImageBitmap` upload path (only after P0-1)
- **Change:** in the shared-capture fan-out, `await createImageBitmap(snapCanvas, { premultiplyAlpha: 'none' })`
  once, then `texImage2D`/`texSubImage2D` from the ImageBitmap per renderer. Add an
  explicit ImageBitmap branch in `_uploadTexture` (today non-canvas sources round-trip
  through a temp 2D canvas, `liquidGL.js:570-586`). Keep `staticSnapshotCanvas` an
  HTMLCanvasElement (the dynamic/composite paths 2D-draw from it).
- **Mandatory gate:** startup runtime probe — build a 2×1 canvas (one opaque, one
  semi-transparent pixel), upload once via the legacy canvas path and once via the
  ImageBitmap path, `readPixels` both, enable the fast path **only on exact byte
  equality** (converts WebKit premultiply drift risk into identical-by-construction).
- **Benefit:** with P0-1: one decode → N near-free uploads; moves conversion cost off
  the interaction path. Standalone benefit is small — land P0-1 first.
- **Visual risk:** none with the probe gate. **Complexity:** medium.

#### P2-14. Explorer row lens pooling (highest effort — only if row glass is hot)
- **Fact:** the explorer list is virtualized; every scroll settle changes the pathKey
  signature (`src/main.ts:8495-8501`) and currently runs
  `disposeExplorerLiquidGlassRenderer()` (`:8687`) + full renderer recreation — a new
  WebGL context + constructor capture + second capture per scroll settle.
- **Change:** diff lenses on the live renderer instead of disposing the context:
  evict lenses whose element left the DOM **or** whose
  `el.dataset.explorerGlassLens !== 'liquidgl'` (the virtualizer recycles row
  elements); for added lenses replicate the full bookkeeping of `:8688-8692` +
  `:8720-8727` (`credit-card-glass` class, remove `explorer-glass-pending`, set
  `dataset.explorerGlassLens='liquidgl'`, clear fallback reason) — hover-only and
  eligibility checks key off that dataset (`:8437-8441`, `:8503-8507`).
- **Benefit:** eliminates WebGL context churn + double capture per explorer scroll
  settle. **Visual risk:** low with the bookkeeping corrections (also removes today's
  teardown flash). **Complexity:** high.
- **Validation:** scroll the explorer continuously: no context creation in
  `chrome://gpu` / no `WEBGL_lose_context` warnings; row glass appears on newly
  entered rows; hover-only mode still works on recycled rows.

---

## 3. Rejected ideas — verified false premises, do NOT implement

These were generated during review and **refuted** by verification. Recorded so they
are not re-attempted:

- **R1. "Recapture after wallpaper decode / the pre-decode capture is wasted or stale."**
  False: vendored html2canvas 1.4.1 loads images inside its document clone and awaits
  them (default `imageTimeout` 15s) before compositing, and the wallpaper `<img>` is
  `position:absolute` so the fixed-position ignore filter does not exclude it. The
  "pre-decode" capture already contains the wallpaper; no staleness bug exists.
- **R2. "Gate `applyWorkspaceDockSettings`'s recapture (`src/main.ts:8903`) on the dock
  signature to stop slider-drag recaptures."** Refuted twice: (a) zero benefit —
  `applyIdeSettings` always reaches `applyIdeBackgroundSettings:5823`, which schedules
  the same debounced workspace recapture anyway; (b) breaks correctness — `:8903` is
  the ONLY workspace recapture on window-resize (`:17021`) and `setIdeScale`
  (`:18175`), where the dock signature is unchanged → stale/mis-scaled dock glass.
- **R3. "Signature-gate `applyWorkspaceLiquidGlass` because LLM status polls run the
  full dock-glass pipeline continuously."** False premise: the LLM activity path
  deliberately bypasses `renderWorkspaceTabs` — `markWorkspaceLlmActivity`
  (`src/main.ts:10372`) renders only on indicator-state change via
  `renderWorkspaceLlmActivityTab*`, which updates the single tab element and re-syncs
  the render signature without scheduling glass refreshes.
- **R4. "Add CSS containment (`contain: strict` etc.) to glass canvases / mirrors /
  shadow layers."** Pixel-identical but useless: the per-frame writes are
  transform/clip-path/top-left on childless absolutely-positioned elements (no layout
  to contain; Blink's positioned-movement-only path already applies), and
  `.terminal-host` / `.terminal-host-stack` already carry containment.

---

## 4. Implementation order & regression suite

Suggested PR sequence:

1. **PR-1:** P0-1 + P0-2 (capture dedup — one coherent change).
2. **PR-2:** P1-4 + P1-5 + P1-8 (small render-path slimming, vendored + main.ts).
3. **PR-3:** P0-3 (workspace ticker; needs PR-2's render cheapness for best effect).
4. **PR-4:** P1-6 + P1-7 (input-path work).
5. **PR-5:** P1-9 (`preserveDrawingBuffer`).
6. **PR-6+:** P2 items by appetite (P2-10 and P2-11 are cheap; P2-12 needs the
   invalidation hooks; P2-13 after PR-1; P2-14 only if explorer row glass is hot).

After EVERY PR, run this fixed regression set (covers every verifier-identified
difference scenario):

1. **Counters:** the relevant `console.count` assertions listed per item above.
2. **Trace:** DevTools Performance trace of the specific interaction (panel toggle,
   window resize, widget drag, cursor wave over terminal, explorer scroll) — assert the
   targeted long tasks / forced-layout entries disappeared.
3. **Screenshot A/B** (same background, same window size): titlebar + window controls,
   one floating panel, one terminal card, workspace dock rows, explorer rows —
   each with specular ON and OFF, plus one mid-tilt capture and one mid-window-resize
   capture. All must be pixel-identical (mid-resize: glass must never blank).
4. **Terminal responsiveness:** type into a terminal during a recapture wave and while
   waving the cursor across widgets — no visible input lag (this is the product bar).

## 5. Known good properties to preserve

- Owner-local geometry refresh (`refreshLiquidGlassGeometryForOwner` /
  `scheduleLiquidGlassGeometryForOwner` `src/main.ts:7830-7851`) for widget
  click/focus/z/drag/resize/drop — already optimal (zero captures); P1-5 makes it
  cheaper, nothing should re-broaden it.
- `scheduleAppGlassRefresh`'s sticky-recapture debounce (`:7853-7863`) — recapture=true
  absorbing later topology-only requests is correct; keep it.
- The hover-only render wrapper filtering (`:6791-6809`, `:8452+`) — any new ticker or
  render call must go through the wrapped `render()`.
- `resizeAppGlassRendererCanvasForViewport`'s viewport signature guard (`:8020-8026`) —
  pattern to imitate for other idempotent work.
