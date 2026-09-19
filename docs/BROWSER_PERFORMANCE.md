# Browser performance and correctness follow-up — 2026-09-06

The subsequent staging fix automatically includes the new untracked `preview_body.rs`
in normal Windows builds. No commit or `-IncludeUntracked` is required for that module;
see [Windows staging](WINDOWS_RUNTIME_SMOKE.md) for the source allowlist/privacy checks.

The Browser has two important paths: native child WebViews for ordinary workspaces,
and iframe/local-HTTP-proxy fallback for capture-protected previews. Tests must cover
both; enabling native WebViews globally does not mean every active tab uses one.

## Applied changes

### Navigation and native work

- Repeated iframe activation while the same URL is already loading no longer resets
  `src` and restarts the navigation. Explicit reload/hard reload, URL changes, errors
  and resuming a suspended frame still load normally.
- A replacement iframe document receives its current Console detail mode. The old
  document's mode cache cannot suppress the new document's initialization message.
- Reload, Hard refresh and Clear cache now take the actual capture-safe iframe/proxy
  path instead of the globally enabled native branch which could silently do nothing.
- Identical bounds-only native updates are skipped when already applied or pending.
  Exact coordinates are used, preserving subpixel/DPI changes. Explicit navigation
  bypasses the optimization. Hide, close, invalid geometry and failure invalidate it;
  completion of a delayed hidden-child close forces recreation when necessary.
- Asset-recovery timers capture URL/workspace/profile/generation/tab identity, so an
  old page's failure cannot reload a newly navigated page. Workspace frame suspension
  retains a cancellable token while idle work waits, preserving a newly armed grace
  period after returning to/leaving a workspace.

### Proxy ownership and Console

- Proxy probing and creation share an in-flight claim before the first native await.
  Repeated requests for one origin no longer launch duplicate probes/replacements.
- Each claim captures workspace/profile/root and a scope generation. Late created
  proxies from a discarded scope are stopped, not inserted into another workspace.
  Stale probe results cannot remove retained proxies. A forced clear invalidates
  pending claims, and an old completion cannot clear a newer claim.
- Proxy page-load completions also check request identity, tab object and URL before
  applying results or reporting errors to the current UI.
- Console follows new output only when already near the bottom (or initially empty).
  Reading old logs no longer forces a jump to the bottom on every new batch.
- Hidden Console batches retain only their newest valid payloads before enqueueing,
  avoiding a temporary queue proportional to an incoming burst. Existing count caps,
  ordering and invalid-payload handling remain. An all-invalid tail may still require
  scanning to find valid records; this is not a constant-time parser for arbitrary input.

### Bounded HTML injection

`src-tauri/src/preview_body.rs` isolates opportunistic capture from socket ownership:

- Capture at most **2 MiB of raw body bytes** for optional bridge injection. Known
  larger Content-Length values bypass capture immediately, without allocating their
  declared size or reading more body bytes first.
- Socket reads use a short 250 ms timeout during capture; a 250 ms elapsed budget is
  also checked between reads. Timeout/budget exhaustion returns the exact captured
  wire prefix for normal streaming relay. This is **not a hard 250 ms navigation SLA**.
- Chunk framing is parsed incrementally across arbitrary read boundaries. Complete
  zero-chunk/trailer framing ends capture without waiting for connection EOF. Validated
  chunks are compacted in place rather than keeping separate encoded/decoded buffers.
- Long valid metadata (8 KiB chunk line / 64 KiB trailer budget) triggers raw passthrough,
  not a rejected page. Malformed size/CRLF and truncated complete-body framing remain
  explicit errors instead of silently injecting partial data.
- Fixed-length responses relay only the remaining declared bytes, without waiting for
  a target FIN after the response is complete. Premature EOF is reported.
- HEAD final responses, 204 and 304 do not read/inject a body. 205/206, encoded content
  and unsupported transfer codings bypass injection. Interim 1xx responses retain the
  existing transparent relay path rather than closing before the final response.
- Injected/dechunked responses get the new Content-Length and lose Transfer-Encoding
  and Trailer. Untouched transfer-coded responses retain their wire framing/Trailer
  but discard a conflicting Content-Length, following the
  [HTTP framing rules](https://www.rfc-editor.org/rfc/rfc9112.html#section-6.3).

**Tradeoff:** large, slow or unsupported HTML pages prioritize original page delivery.
They do not receive the injected IDE bridge, so Console and other bridge-dependent
preview integrations may be unavailable on those pages. The page itself is not capped
at 2 MiB. Native child WebViews do not use this injection path. Capture limits are per
connection, not a global memory limit; completed small injection still creates the
final modified body allocation. Full streaming-prefix injection is future work.

## Verification

Run `npm run check:regressions` (ten runtime helpers plus the staging fixture) and Rust tests. Three Browser scripts
extract actual app helpers, not duplicate implementations:

- `browser-lifecycle-smoke.mjs`: pending navigation, reload routing, new-document
  detail mode, native dedup/invalidation/late-close recovery, asset retries and idle TTL.
- `browser-console-smoke.mjs`: follow-tail decision before mutation, hidden ingestion
  ordering/caps and unchanged-render fast return.
- `browser-proxy-scope-smoke.mjs`: duplicate probes/starts, forced retry, scope exit/
  return, shutdown, stale UI results/errors and newest-request ownership.

Representative synthetic operation counts:

| Workload | Before | After |
| --- | --- | --- |
| 100 activations of an iframe with a pending load | 100 `src` assignments | 1 |
| 100 unchanged settled native bounds syncs | 100 native show/bounds calls | 0 extra calls |
| 100 duplicate native syncs behind an in-flight show | duplicate native calls | 1 original call |
| 100 concurrent proxy starts/forced probes | duplicate forced probes possible | 1 shared operation per stage |
| Defensive 100,000-object hidden-console batch | 100,000 payload reads | 80 |

The last stress input is larger than ordinary injected-bridge batches; it is not an
everyday FPS claim. DOM fixtures prove ownership/scroll-write decisions, not actual
Windows scroll anchoring, GPU cost or WebView2 responsiveness.

Native tests include real loopback TCP roundtrips proving HEAD/no-body responses,
small chunked HTML and oversized fixed-length passthrough finish without waiting for
the target to close. Additional module tests cover byte splits, malformed framing,
timeouts, metadata caps, exact fallback bytes and in-place allocation ownership.

Final gates: typecheck, both frontend builds, ten regression scripts, Rust formatting,
65 Rust tests, host and Windows MSVC-target checks. Actual packaged Windows runtime
remains unverified: WSL interop cannot execute the installed Windows binaries. Existing
Vite chunk-size/GNU cross-target advisories are not hidden.

## Remaining candidates — intentionally not changed

- **Inactive iframe policy:** tabs inside the active workspace retain live documents
  to preserve forms/page state. The retention cap counts hidden workspaces, not tabs.
  A configurable suspension policy could reduce CPU/RAM but must make state loss explicit.
- **Listener polling:** nonblocking accept loops can add up to their 80 ms sleep delay.
  A cancellable event-driven listener is preferable to busy polling. A bare blocking
  accept plus a best-effort self-connect wakeup can hang shutdown if wakeup fails.
- **More protocol streaming:** non-injected chunked/close-delimited relay and interim
  responses still use connection EOF; unusual request/response framing merits a separate
  protocol-aware streaming design. No claim of a general-purpose HTTP proxy is made.
- **Retry policy:** repeated dependency auto-forward failures can retry after each
  completed failure. A bounded scope/port cooldown with manual override needs dedicated
  behavior tests; blanket throttling could delay genuine dev-server startup.
- **Windows profiling:** measure GPU/layout, slow-network navigation, Console row eviction
  anchoring, frame/child counts and heap retention under repeated switching. Redact all
  private page data and local paths in any collected artifacts.
