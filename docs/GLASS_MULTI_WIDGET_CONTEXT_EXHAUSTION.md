# Glass reload/vanish when opening many widgets — root cause (2026-07-04)

**Audience: an LLM (or engineer) fixing the bug.** Self-contained. Line numbers
are anchors from the 2026-07-04 **uncommitted** working tree (`src/main.ts`,
`public/vendor/liquidgl/liquidGL.js`) — re-locate by symbol name if files drift.

## Symptom (user-reported)

With app glass enabled, opening several glass widgets (e.g. multiple shells /
terminal cards) makes the glass effect "reload as if refreshing" and **some
widgets lose their glass entirely** — sometimes permanently, even after the
others finish reloading.

## Root cause (one line)

**App glass creates one WebGL context per glass plane with no cap.** Opening
enough widgets exceeds the browser/WebView2 active-WebGL-context ceiling
(~16 in Chromium). The browser force-evicts the oldest contexts
(`webglcontextlost`); the rebuild-on-loss handler then creates a fresh context,
which evicts *another* old one — a self-sustaining eviction cascade. Planes that
fail context creation outright are marked `init-failed` and **never retried**,
so they stay permanently on the flat CSS fallback.

This is the concrete manifestation of **F-6** (WebGL context budget has no owner)
and **G-3** (init-failed planes never recover) from
`docs/IDE_PERFORMANCE_REVIEW.md`.

## Verified architecture facts (read before changing anything)

1. **One renderer = one WebGL context, per plane.**
   `createAppGlassRendererForTarget` (`src/main.ts`, `async function` head near
   the `createIsolatedWorkspaceLiquidGL({ target: '[data-app-glass-id="..."]' })`
   call) builds an isolated `liquidGL` renderer per plane id; the vendored
   renderer allocates its own context via
   `canvas.getContext("webgl2"/"webgl")` (`liquidGL.js:93-96`) and throws
   `"liquidGL: WebGL unavailable"` (`liquidGL.js:96`) when the browser refuses a
   new context.

2. **No cap exists.** `prioritizedAppGlassTargets` (`src/main.ts:9229`) only
   **sorts** targets by `appGlassTargetPriority` (`src/main.ts`, terminal-widgets
   = priority 0 … window-controls = 12) — it never slices/limits the count.
   There is no `APP_GLASS_MAX_*` constant anywhere (grep: 0 hits). Every active
   plane attempts its own context.

3. **Steady-state context count (glass on), before any shell:** titlebar (1) +
   profile split cards (2) + window buttons (3) + workspace-tab renderer (1) +
   container renderer (1, if container glass on) + explorer-rows renderer (1, if
   open) ≈ **7-8 contexts**. **Each terminal card / shell adds one more.** So
   ~7-8 shells crosses the ~16 ceiling.

4. **A `webglcontextlost` handler now exists** (`bindAppGlassRendererContextEvents`,
   `src/main.ts:9702`). On loss it `removeAppGlassRenderer(id)` then
   `scheduleAppGlassOwnerRefresh(owner, { recapture: true, delay: 220, reason:
   'context-lost' })`. It logs `app glass context-lost scope=… owner=…` via
   `appendDiagnosticLog('glass', …, 'warn', { force: true })` — **this log line
   is how you confirm the bug at runtime** (enable glass diagnostics / debug log
   and watch it fire repeatedly while opening shells).

5. **Rebuild is triggered by a lost context.**
   `appGlassRendererNeedsRebuild` (`src/main.ts:9251`) returns true when
   `renderer.gl.isContextLost()` (`appGlassRendererContextLost`,
   `src/main.ts:9247`). `applyAppLiquidGlass` / `applyAppLiquidGlassForOwner`
   then `removeAppGlassRenderer(id)` and recreate it.

6. **No capture dedup yet.** Each renderer runs its own `captureSnapshot()`
   (html2canvas) — see `docs/LIQUID_GLASS_PERF_REVIEW.md` P0-1 (still pending).
   So every rebuild wave is N full-page rasterizations = a visible reload flash.

7. **`preserveDrawingBuffer: true`** (`liquidGL.js:90`) inflates per-context GPU
   memory (each canvas is full-viewport), which makes the browser hit its
   context/memory budget sooner. See `LIQUID_GLASS_PERF_REVIEW.md` P1-9.

## Failure cascade (maps each symptom to code)

1. Open shells until active contexts > browser cap (~16).
2. Browser force-loses the **oldest** context → `webglcontextlost` fires on that
   canvas.
3. Handler (`src/main.ts:9705`): `removeAppGlassRenderer(id)` +
   `scheduleAppGlassOwnerRefresh({ recapture: true })`.
4. The refresh rebuilds that plane → **allocates a new context** → browser evicts
   **another** old context → step 2 again on a different widget. → **This is the
   "some widgets' glass vanishes then reloads" flicker.**
5. Because `appGlassRendererNeedsRebuild` keys off `gl.isContextLost()`, every
   `applyAppLiquidGlass` pass tears down + recreates the rotating set of
   lost-context renderers. With N > cap, a subset is *always* lost → **permanent
   thrash**; whichever planes are currently lost-and-not-yet-rebuilt show **no
   glass**.
6. The reload is heavy/visible because each rebuild recaptures via its own
   html2canvas pass (fact 6).

## Why some widgets stay gone permanently

When context creation fails outright, `window.liquidGL()` yields no
renderer/lenses and the plane is marked `init-failed`:

```
// createAppGlassRendererForTarget:
if (!renderer || !lenses.length) { markAppGlassTargetCssFallback(target, 'init-failed'); return; }
// ...and the catch block also marks 'init-failed'.
```

That marker is then **permanently skipped** on every subsequent apply pass:

```
// applyAppLiquidGlass (src/main.ts:9573) and applyAppLiquidGlassForOwner (src/main.ts:9520):
if (!rendererExists && lensState === 'css' && target.dataset.appGlassFallbackReason === 'init-failed') continue;
```

`cleanupAppGlassTarget` deliberately preserves the css/`init-failed` marker
(`src/main.ts:10075`, `:10103`); only a full glass-off (`removeAppLiquidGlass`)
clears it. **Consequence:** closing shells later frees WebGL contexts, but the
planes that failed are never promoted back to liquid glass — they stay on the
flat CSS `backdrop-filter` fallback, which looks visibly different (no
refraction/bevel). This is the "일부가 사라진 채로 안 돌아옴" part.

## Contributing factors (amplifiers, not the root)

- **No capture dedup** (fact 6) → each reload wave is expensive and flickery.
- **`preserveDrawingBuffer: true`** (fact 7) → contexts evicted sooner.
- **The `webglcontextlost` handler treats a symptom, not the cause.** It cannot
  succeed while N > cap: every recovery allocation re-triggers eviction. It
  makes the thrash *self-sustaining* rather than a one-shot failure.

## Fix options (ranked by effectiveness)

Legend — Visual risk: none / low / ⚠. Complexity: low / medium / high.

### Fix 1 (root, recommended): consolidate to one renderer with many lenses
`liquidGL` supports N lenses per renderer, and the app already relies on this
for workspace/explorer glass. App glass deliberately isolates each plane via
`createIsolatedWorkspaceLiquidGL` (`createAppGlassRendererForTarget`), which is
what multiplies contexts. Call `liquidGL` **once** against a multi-element
selector (e.g. `target: '.app-glass-plane.app-glass-active'`) so **one WebGL
context + one full-viewport canvas** covers titlebar, panels, and *all* shells.
- **Benefit:** context count becomes O(1) regardless of shell count →
  exhaustion, eviction cascade, and `init-failed` all disappear.
- **Traps:** app glass currently sets per-scope effect options
  (`effectiveAppGlassEffectSettings(scope)`), owner-local overlay containers, and
  the owner-scoped refresh path (`applyAppLiquidGlassForOwner`) — a single shared
  renderer must still apply per-lens options and reposition per-owner. The
  owner-local canvas positioning (see
  `LIQUID_GLASS_PERF_REVIEW.md` / prior alignment work:
  `positionAppGlassViewportLayer`, `appGlassOverlayContainerForTarget`) assumes
  one canvas per owner — reconcile this (e.g. keep one canvas parented to
  `el.shell`, clip per lens) before switching.
- **Hard-constraint note:** `LIQUID_GLASS_PERF_REVIEW.md` forbids *renderer caps*
  and *visual degradation*. Consolidation is **not** a cap and is pixel-neutral,
  so it is compatible; it is in fact the same direction as that doc's P0-1.
- Visual risk: low (same shader, same snapshot). Complexity: high.

### Fix 2 (alternative): hard budget + LRU eviction + fallback promotion
If consolidation is too invasive, bound live contexts to a budget (e.g. 12) using
the existing `appGlassTargetPriority` ordering: keep the highest-priority planes
on liquid glass, demote the rest to CSS fallback **gracefully**, and **re-promote
when contexts free up**.
- **Mandatory:** clear the `init-failed` marker when a renderer is removed / a
  slot frees, or on a settings-driven retry — otherwise demoted planes never come
  back (this is the current permanent-loss bug).
- **Tension:** this is close to a "renderer cap", which `LIQUID_GLASS_PERF_REVIEW.md`
  explicitly forbids. Prefer Fix 1; only take Fix 2 with product sign-off, and
  frame it as "graceful degradation above budget" rather than a hard visual cap.
- Visual risk: ⚠ (low-priority planes show flat fallback above budget).
  Complexity: medium.

### Fix 3 (cheap mitigation, do regardless): stop the permanent loss
Make `init-failed` recoverable even without Fix 1/2. Clear
`target.dataset.appGlassFallbackReason === 'init-failed'` whenever a renderer is
removed (a slot frees) or on the next settings/topology change, so closing shells
restores glass on the planes that had failed.
- **Benefit:** removes the "닫아도 안 돌아옴" behavior with a 1-2 line change.
  Does **not** fix the flicker (that needs Fix 1/2 + Fix 4).
- Visual risk: none. Complexity: low.

### Fix 4 (cheap mitigation): capture dedup + preserveDrawingBuffer
Apply `LIQUID_GLASS_PERF_REVIEW.md` **P0-1** (capture the shared
`#ide-glass-snapshot-stage` once per wave, fan the canvas out to all renderers)
and **P1-9** (`preserveDrawingBuffer: false`). This shrinks each rebuild wave from
N html2canvas passes to 1 (much less visible flash) and delays eviction.
- **Benefit:** greatly reduces the *visibility* of reloads and pushes back the
  ceiling; does **not** by itself stop exhaustion once N > cap.
- Visual risk: none / low (per that doc). Complexity: medium.

## Recommended path

1. **Fix 3** now (stops permanent loss, ~2 lines).
2. **Fix 4** (P0-1 + P1-9) to make any remaining rebuilds cheap and delay the
   ceiling.
3. **Fix 1** (consolidation) as the real cure — after which the eviction cascade
   cannot happen. Fix 2 only if Fix 1 is deferred and product accepts graceful
   degradation.

## How to confirm / reproduce

- Enable app glass, open shells one at a time; around the 7-8th, watch glass on
  earlier widgets blink/vanish.
- Turn on glass diagnostics (or `debugLogEnabled`) and watch the diagnostic log
  for repeated `app glass context-lost scope=… owner=…` lines
  (`src/main.ts:9714`) — that is the smoking gun.
- In DevTools / `chrome://gpu`, watch for `WARNING: Too many active WebGL
  contexts. Oldest context will be lost.`
- After the cascade, close several shells: planes marked `init-failed` stay flat
  (CSS fallback) — confirming G-3 / the permanent-loss path.

## Cross-references

- `docs/LIQUID_GLASS_PERF_REVIEW.md` — canonical glass optimization plan
  (P0-1 capture dedup, P1-9 `preserveDrawingBuffer`; hard constraints: no
  renderer caps, no visual degradation).
- `docs/IDE_PERFORMANCE_REVIEW.md` — F-6 (WebGL context budget has no owner,
  zero loss handling at review time) and G-3 (init-failed planes never retry).
  Note: since that review, the `webglcontextlost` handler (fact 4) was added, but
  it addresses the symptom, not the root cause described here.
