# Agent Alert & Workspace Rename — Root-Cause Analysis (2026-07-02)

Root-cause documentation for three user-reported bugs. **Audience: an LLM (or engineer)
implementing the fixes.** Every causal chain below was verified adversarially against the
actual working-tree code (one pass re-reading every cited line trying to refute the chain,
one pass hunting for alternative causes). Line numbers are working-tree anchors from the
review date — re-locate by function name if the file has drifted. None of these are
regressions from the uncommitted refactor; HEAD behaves the same or worse.

Reported symptoms (original, Korean):
1. "claude 일이 끝나도 알람이 안울림. input 대기에선 울림. 아마 일 끝나는거에 대한 판정이 이상한듯?"
2. "implement 할지 묻는거에서 알람이 codex finished라고 나옴. 이건 finished가 아닌데"
3. "llm이 일하는 중간에는 workspace rename이 안됨"

---

## 0. Shared background: how agent status & alerts work

All three issues live in the agent-status pipeline in `src/main.ts`:

- Per-pane status `'idle'|'working'|'waiting'|'error'|'exited'` (type at `:1101`) comes
  from competing **sources**: `'hook'` (CLI hook bridge; Claude/Grok, WSL-only, opt-in
  via `agentEventClaudeHooks`, default `'ask'` + confirm dialog `:17469-17488`),
  `'title'` (terminal/tmux title classification), `'output'` (PTY output scraping),
  `'launcher'`, `'heuristic'`.
- Dispatch: `handleTerminalData` `:28556-28565` — title + waiting + output scraping run
  only when the hook bridge is NOT active; **output-waiting detection is additionally
  gated by `!terminalPaneUsesTitleOnlyLlmStatus(pane)` at `:28562`**, and Codex is the
  one title-only CLI (`:11284-11286`). This single gate is load-bearing for Issue 2.
- Alerts: `maybeSendAgentProgressAlert` `:10520-10571`. Kind decision `:10531-10534`:
  `'waiting'` on any transition into waiting; `'done'` ONLY when next is idle/exited AND
  the (rewritten) previous status is `'working'`.
- The previous status is rewritten by `previousAgentSessionStatusForAlert` `:10588-10603`:
  on a working→idle transition, if the previous record is already **expired**
  (`expiresAt <= now`), the done alert survives only when
  `previous.doneAlertOnExpire === true` and the expiry is within
  `AGENT_ALERT_DONE_EXPIRE_GRACE_MS` (30s, `:1488`). Otherwise previous is rewritten to
  `'idle'` and the done alert dies.
- Expiry machinery: every working state schedules a timer
  (`scheduleAgentSessionProgressExpiry` `:11144-11157`) that fires at **expiresAt+40ms**
  → `expireAgentSessionProgress` `:11159-11193` patches the pane to idle and calls
  `maybeSendAgentProgressAlert` itself. So the expiry path always evaluates the done
  alert with `expired === true` — by construction, `doneAlertOnExpire` decides.
- `doneAlertOnExpire: true` is set in exactly ONE place in the app:
  `markWorkspaceLlmTitleActivityForPane` `:11487-11494` (title-source working —
  in practice Codex). The output-scrape working path hardcodes `false` (`:10361`).

**The shared design gap (Issues 1 & 2 are two faces of it):** for scrape-based status,
"the turn ended" is never detected explicitly — it is *guessed* by expiry. The guess is
suppressed for output-source states (`doneAlertOnExpire:false` → Claude's real finish
fires nothing) and armed for title-source states (`true` → Codex's unrecognized
confirm prompt fires a false "finished"). Explicit end-of-turn detection is the
principled fix direction; the minimal fixes below work within the existing machinery.

---

## 1. Claude finish never fires the "done" alert

### Root cause (confidence: high, adversarially confirmed)

For Claude panes without the hook bridge (the default configuration), `'working'` comes
exclusively from output scraping (`markWorkspaceLlmOutputActivityForPane`), which always
writes `doneAlertOnExpire: false` (`src/main.ts:10361`). No detector ever classifies
Claude's finished/idle prompt as an explicit idle patch — so the only working→idle
transition is the expiry timer, which by construction arrives with `expired = true`,
and the grace rescue at `:10599` requires `doneAlertOnExpire === true`. The alert is
therefore structurally unreachable, while waiting alerts work because waiting IS an
explicit patch-driven detection.

### Causal chain (each step verified)

1. Hook bridge absent (WSL-only + `agentEventClaudeHooks` default `'ask'` + confirm,
   `:2367`, `:17469-17488`) → `handleTerminalData` `:28556-28565` routes Claude through
   output scraping.
2. While working, status-line frames ("✳ …ing… (esc to interrupt)", matched by
   `llmOutputLooksLikeActiveWork` `:12428-12467`) drive
   `markWorkspaceLlmOutputActivityForPane` → `status:'working'`, `source:'output'`,
   `expiresAt = now + 2500ms` (`WORKSPACE_LLM_OUTPUT_ACTIVE_MS` `:1428`),
   `doneAlertEligible:true`, **`doneAlertOnExpire:false`** (`:10354-10362`).
3. Claude has no idle signal anywhere: `classifyClaudeTerminalTitle` returns only
   `'working' | 'unknown'` (`:12244-12246`) — contrast Codex (`'Ready'` → idle,
   `:12238`) and Grok (`'Waiting'` → idle, `:12251`). Output scraping has waiting and
   active-work classifiers but no idle-prompt classifier (`:12255-12304`).
4. Output goes quiet → 2500+40ms later `expireAgentSessionProgress` `:11159-11193`
   builds the idle patch and calls `maybeSendAgentProgressAlert(pane, working, idle)`.
5. `previousAgentSessionStatusForAlert`: eligibility passes (source `'output'` is
   allowed, `:10605-10611`), but `expired = true` (`:10596`), so the un-expired fast
   path `:10597` is skipped; the grace rescue `:10599` fails on
   `doneAlertOnExpire=false` → returns `'idle'` (`:10600`).
6. `kind` stays `null` at `:10533-10534` → no sound, no banner.

**Aggravating detail (verified):** Claude's turn-completion summary line is *already
recognized* by `llmOutputLooksClearlyNotWaiting` (`:12599`, patterns
`turn completed|worked for|total cost|total duration`) — but that result is consumed
only to clear waiting (`:12285-12288`). The finish frame itself then **re-arms
'working' for another 2.5s with `doneAlertOnExpire:false`** (guard `:10341-10342` lets
non-active frames through while previous is working, `:10353-10361`): the app sees
Claude's own "I'm done" message and uses it to re-suppress the done alert.

Ruled out: alert plumbing/settings (waiting shares the same path `:10561`), the
min-interval throttle (`:10550` never reached — kind is null), the hook path (when
hooks ARE active, `Stop|SubagentStop` → idle from the bridge, `src-tauri/src/lib.rs:2014`,
with a 30-min unexpired working record → done alert fires correctly; the bug is
specific to the scrape pipeline).

### Fix

**Minimal (reuses existing machinery):** in `markWorkspaceLlmOutputActivityForPane`
(`:10354-10362`) change `doneAlertOnExpire: false` to:

```ts
doneAlertOnExpire: looksActive ? true : previousProgress?.doneAlertOnExpire === true
```

The preservation clause is **load-bearing**: Claude's final frame (answer + idle prompt
box) has `looksActive=false` but still reaches this update because previous is working
(`:10342`); writing `false` there re-disarms the alert at the exact moment that matters.
The in-place throttle branch (`:10343-10352`) already leaves the flag untouched.
Resulting flow: active frames arm → final paint preserves → 2.5s quiet → expiry →
grace rescue passes → `kind='done'` → alert ~2.5s after finish.

**Better (recommended addition):** use the already-matched finish-summary pattern
(`:12599`) to emit an explicit idle patch (status `'idle'`, source `'output'`) instead
of waiting for expiry — this makes the done alert immediate and removes the guesswork.
Keep the minimal fix as a fallback for turns whose final frame scrolls the summary away.

**Risk:** false "done" alerts if Claude stays working but the PTY paints nothing for
>2.5s (long silent tool executions). In practice Claude Code repaints its spinner/elapsed
line continuously; confirm cadence at runtime (see Open questions). Optionally gate the
change to `llmId === 'claude'` for minimal blast radius — though Grok/Antigravity
non-hook panes have the identical gap.

### Validation

Enable the existing diagnostics (`appendDiagnosticLog('agent', ...)` transition logs at
`:10501-10504` show `source=`/`eligible=` per transition). Run a short Claude turn with
alert sound on: expect a `working→idle` transition log ~2.5s after the answer, followed
by a "Claude finished" alert. Then run a turn with a long silent tool call (e.g. a
2-minute build) and confirm no spurious mid-turn done alert. Waiting alerts must be
unchanged (ask Claude a question requiring confirmation).

---

## 2. "Codex finished" alert on an implement-confirmation prompt

### Root cause (confidence: high, adversarially confirmed)

The label is **correct** — the alert genuinely came from a Codex pane (agentId flows
pane.llmId → progress.agentId → `agentAlertAgentLabel`, `:17784/:17791/:11280/:10471`).
The bug is a detection-coverage hole with an ironic shape: **Codex's output-based
waiting detector explicitly contains patterns for "Implement this plan?" confirmations
(`codexOutputLooksLikeWaitingPrompt` `:12488-12504`) — but it is dead code**, because
its only call site is gated by `!terminalPaneUsesTitleOnlyLlmStatus(pane)` (`:28562`)
and Codex is the one title-only CLI (`:11284-11286`). Live Codex waiting detection is
title-only, and the title classifier maps only `Action Required|Needs Input|Approval
Required` to waiting (`:12236-12237`); a plan-confirm prompt sets no such title.

Meanwhile Codex's title-derived working state is the sole state carrying
`doneAlertOnExpire: true` (`:11494`). So when the turn ends at the unrecognized confirm
menu: title activity stops → working state expires (the tmux stale-repeat guard
`:11686-11693` / `WORKSPACE_LLM_TMUX_TITLE_STALE_REPEAT_MS = 8000ms` `:1453`
deliberately stops an identical repeated title from extending it) → expiry or the
'Ready'-title idle patch delivers working→idle → grace rescue passes
(`doneAlertOnExpire=true`, within 30s) → **`kind='done'` → "Codex finished"** — for a
pane that is actually waiting for input.

**Compounding hole (verified):** `classifyCodexTerminalTitle` maps a bare `Waiting`
title to **working**, not waiting (`:12240` — contrast Grok where `Waiting` → idle at
`:12251`), so even a cooperative title can't rescue this case.

**Cross-check with Issue 1 (the load-bearing symmetry):** Claude's real finish fires
nothing because its scrape states carry `doneAlertOnExpire:false`; Codex's fake finish
fires because its title states carry `true`. Same design gap, opposite failure modes.

### Fix

**Primary (minimal):** in `handleTerminalData`, drop the
`!terminalPaneUsesTitleOnlyLlmStatus(pane)` clause at `:28562` so
`updateWorkspaceLlmWaitingFromOutput` runs for Codex panes. Line `:12260` already
routes Codex to its conservative dedicated detector
(`updateCodexWorkspaceLlmWaitingFromOutput` `:12307`) whose patterns match
"Implement this plan?" and numbered choice menus (`:12491-12502`) — the user's scenario
becomes a correct "Codex needs input" waiting alert. Working-status behavior is
unchanged: `markWorkspaceLlmOutputActivityForPane` already self-gates for title-only
CLIs at `:10332`, so Codex working remains title-driven.

**Hardening (recommended):**
1. Add the `llmWaitingDetectionSuppressedAfterInput` guard to the Codex detector
   (mirroring `:12263-12277`, allowing structured choice menus through) so echoed user
   text cannot fake a Codex prompt — the Codex path currently skips that guard.
2. Consider the general fallback for title-only agents: before emitting `kind='done'`
   via the grace path, check the recent output buffer for prompt-shaped content and
   emit `waiting` instead. This also future-proofs against new Codex prompt shapes.
3. The single-line composer question with no menu (e.g. `implement this?` with no
   numbered rows) may not match the two-consecutive-option-rows regex at `:12501`;
   verify the exact rendered prompt at runtime and extend patterns if needed.

### Validation

With diagnostics on: reproduce a Codex plan-confirm prompt. Before fix: `'agent'`
transition log shows working→idle with a "Codex finished" alert. After fix: a
waiting patch (log shows `status=waiting source=output`) and a "Codex needs input"
alert; no done alert. Regression check: normal Codex turn completion (title `Ready`)
must still fire "Codex finished" exactly once; arrow-key movement inside a Codex menu
must not re-fire waiting alerts (signature dedup `:10537-10547` handles this — verify).

---

## 3. Workspace rename dies while an LLM is working

### Root cause (confidence: high, adversarially confirmed)

Renaming works by adding a `renaming` class to the cached tab element
(`startWorkspaceTabRename` `src/main.ts:12659`), which makes the hidden rename input
visible (`styles.css:2638-2639/:2655` — the input is `display:none` otherwise) and
focuses it. While an LLM works, activity updates repeatedly re-patch that same tab
element via `updateWorkspaceTabElement`, and **line `:9871` rebuilds the class list
with a wholesale assignment**:

```ts
tab.className = `workspace-tab${active ? ' active' : ''}... llm-present llm-${llmDisplayState}`
```

whose template **never includes `renaming`**. The first LLM indicator/detail signature
change after rename starts strips the class → the input snaps back to `display:none`
→ the browser drops focus → the input's blur handler (`:9791`) calls
`finishWorkspaceTabRename`, which early-returns because the class is already gone
(`:12668`) → the rename silently dies, keystrokes go nowhere.

Verified secondary effect: `suppressWorkspaceTabClick` (set `true` at `:12663`) leaks
when the early-return skips the reset — but it only affects keyboard-synthesized clicks
and self-heals on the next real pointer press (`finishWorkspaceTabPointerDrag`
`:12727-12745` resets it). Not the primary symptom.

**Compounding cause (situational, verified):** the terminal IME composition guard can
also steal focus from the rename input: `compositionstart` arms it (`:26794-26795`)
and `finishTerminalImeCompositionGuard` (`:26866`, 1800ms fallback `:1502`, 120ms
release defer `:1501`) forcibly refocuses the terminal textarea. This can kill a rename
started while a Korean IME composition was in flight in a terminal — independent of the
class wipe, but much rarer. Fix separately if reported (skip the refocus when
`document.activeElement` is a rename input).

### Fix

**Minimal (one line):** in `updateWorkspaceTabElement` `:9871`, preserve the state in
the wholesale assignment — append
`${tab.classList.contains('renaming') ? ' renaming' : ''}` to the template — or,
more robustly, replace the wholesale `tab.className = ...` with per-class
`classList.toggle(...)` calls so out-of-band classes survive by construction.

With `renaming` preserved: the input stays visible and focused, its value is untouched
(the function never writes `input.value`), and typing/Enter/blur-commit keep working
while LLM patches update the indicator underneath. The label text update at `:9899` is
invisible during rename because `.renaming` hides the label (`styles.css:2636`).

**Hardening (recommended):**
1. In `finishWorkspaceTabRename`, also reset `suppressWorkspaceTabClick` on the
   early-return path (`:12668`) so a stray class wipe can never leave clicks suppressed.
2. The same wholesale-wipe hazard applies to the `dragging` class (`styles.css:2635`)
   — preserve it the same way, or accept that drags rebuild it.
3. Check the widget-tab rename twin (`:12722+`, `.widget-tab.renaming`
   `styles.css:2637/:2704`) for the same wholesale-className wipe in its own update
   function — not traced in this pass.

**Risk:** negligible — `renaming` is not part of any render signature
(`:9866`, `:12639`), so preserving it cannot cause stale-signature skips. The remaining
edge is a full tab-order rebuild during rename (`renderWorkspaceTabs` `:9515-9523`
detaches/reattaches the tab), which after the fix degrades gracefully: blur fires with
the class still present → the typed name commits instead of being silently lost.

### Validation

Start a Claude/Codex turn in a workspace, then F2 (or double-click) the workspace tab
and type: before fix, the input vanishes on the next indicator update (≤2.5s) and
keystrokes leak; after fix, typing continues through indicator flips
(working→waiting→working), Enter commits, Esc cancels, and blur commits. Also verify:
rename during LLM idle still works; tab click after a cancelled rename still activates
the tab (no suppressed-click leak); drag-reorder during rename is refused or commits
cleanly (per `:12703` guard).

---

## 4. Runtime confirmations worth collecting (open questions)

The app already logs everything needed (`'agent'` transition logs `:10501-10505` with
`source=`/`eligible=`, tmux title poll logs `:11832-11835`):

1. Confirm the user's Claude panes run the scrape pipeline (logs show `source=output`),
   i.e. the hook bridge was not active. If hooks were active, Issue 1 needs a different
   trace (bridge Stop events, `src-tauri/src/lib.rs:2014`).
2. Claude Code's repaint cadence during long silent tool executions — sizes the
   false-positive risk of the 2.5s armed-expiry window in Fix 1 (minimal variant).
3. The exact rendered text/title of the Codex implement-confirm prompt in the user's
   Codex version — confirms the `:12491-12502` patterns match post-fix, and whether any
   `Action Required` title accompanies plan questions (vs only exec/patch approvals).
4. Which transition kills renames first in the field (indicator flip vs 2.5s
   working→idle flap) — affects perceived timing only, not the mechanism or fix.
