# Whole-app performance audit — 2026-09-06

This is a source-level audit and a set of targeted fixes, not a claim that every
possible bottleneck or leak has been eliminated. Terminal responsiveness remains
the priority. Measurements below exercise real helpers with synthetic inputs;
they are **not Windows/WebView2 end-to-end latency measurements**.

The subsequent [Browser follow-up](BROWSER_PERFORMANCE.md) adds native/iframe navigation,
proxy ownership and bounded HTML capture fixes, plus loopback protocol tests.

## Coverage and changes

| Area | Finding / action |
| --- | --- |
| PTY, IPC, input, history | Retained the preceding patch's bounded output acknowledgements, chunked xterm drains, bounded/yielding Hist parser, borrowed UTF-8 decode and owned input bytes. No background terminal host or new reattach behavior. |
| Editor | Cache the string representation of the current immutable CodeMirror Text, retaining only one document version per view. Update dirty tab chrome only on the clean-to-dirty transition, not every edit. Cursor/scroll state still comes from the live view. |
| Notes storage | Replace repeated whole-array JSON serialization during quota compaction with exact per-record/envelope length accounting. Serialize saves per tab object and coalesce waiting saves so an older write cannot overwrite a newer completed write. Capture profile/path/scope, preserve dirty changes, and prevent old-workspace waiters from cancelling a new tab's autosave timer. |
| Explorer frontend | Read the already-loaded glass flag directly in scroll guards instead of normalizing all settings per row. Retain existing virtualization, stable width cache and asynchronous directory deduplication. |
| Explorer native | Cache lowercase sort keys once per entry for mixed/Unicode listings and local signatures; preserve stable ties, directory-first order and the allocation-free ASCII comparator. Sparse-Unicode listings trade additional temporary keys for fewer comparator conversions, not a universal memory reduction. |
| Remote file I/O | Reuse valid UTF-8 output allocations; preserve remote lossy decoding for invalid bytes. Share immutable stdin buffers across retries with Arc instead of cloning full Vecs. Send decoded attachment bytes through the existing binary stdin writer rather than decoding/re-encoding a base64 shell payload. |
| Images / attachments | Encode data URLs directly into the final String with reserved capacity, avoiding an intermediate full base64 String. Existing validation, path quoting and privacy boundaries remain intact. |
| Browser console | Allow one outstanding idle drain per queue, fence cleared/flushed generations and cancel stale idle retries. Bound argument strings, object depth/property reads and transmitted summaries inside the injected bridge, before postMessage. Cycles and throwing getters do not suppress neighboring arguments. |
| Browser HTTP proxy | Scan only newly received header bytes plus a three-byte delimiter overlap, rather than rescanning the growing prefix. Enforce the header limit at the actual terminator while retaining already-read body bytes. |
| Export progress | Throttle running progress to one update per 100 ms per job before formatting/emitting. Preparing/completed/cancelled/error events remain independent of the throttle; transfer bytes and cancellation checks are unchanged. |
| WSL / SSH lifecycle | Reviewed existing timeout/retry, warmup and directory-operation gates, owned child cleanup and prior bounded proxy socket controls. No speculative extra workers, reconnect loops or process-wide kill commands added. The export exception below remains. |
| Workspace / settings persistence | Existing snapshots have caches, debounces and count caps; image references and runtime snapshot paths were reviewed. No storage-schema rewrite or extra synchronous work added to terminal input. |
| Privacy / secure editor | No masking or secret parsing behavior changed for performance. |
| CSS / GPU effects | Reviewed glass scheduling and Explorer layout paths. No blanket containment, will-change, shader rewrite or renderer replacement without Windows GPU/layout measurements. |
| Build / low-level compiler settings | Release already uses opt-level 3, thin LTO, one codegen unit and local-machine target-cpu=native. No unsupported allocator, unsafe/SIMD, mmap or compiler-flag change without a measured hotspot. WSL development polling was not disabled. |

## Reproducible helper results

`npm run check:regressions` includes the new `editor-performance-smoke.mjs` and
`storage-browser-smoke.mjs`, alongside terminal, IME and workspace fixtures.
Representative before/after results from this audit:

| Synthetic workload | Before | After |
| --- | --- | --- |
| 1,000 editor edits | 1,000 tab rebuilds | 1 |
| 128 reads of unchanged ~754 KiB CodeMirror Text | 128 string materializations, ~326 ms | 1, ~11 ms |
| Notes compaction, 200 × ~48 KiB records, ~2 MiB cap | ~881.5 Mi characters serialized, ~3.6 s | ~2.0 Mi, ~6 ms |
| 176 Explorer glass-flag checks | 176 full settings normalizations | 0 |
| 200 hidden Browser queue updates while idle work is delayed | 200 idle callbacks per queue | 1 |
| Eight 1 MiB ASCII console arguments | ~8 MiB forwarded | 16 KiB of summaries |
| Detailed console object with 10,000 getter properties | 10,000 property reads | 12 in this fixture |

Timing depends on the host; operation counts and correctness assertions are the
regression contract, not the measured millisecond values. Bounded console summaries
intentionally do not preserve full JSON/toJSON output. Property-count limits cannot
preempt an individual arbitrary user getter or Proxy trap.

Native tests cover allocation ownership, malformed UTF-8, base64 padding/binary
bytes, stable Unicode sorting/signatures, fragmented HTTP delimiters/body overread,
header-size boundaries, shared retry input, and per-job progress throttling.

## Remaining risks and follow-up priorities

1. **Native Korean IME under heavy output:** the preceding audit reproduced an
   additional installed-xterm pending-composition timer loss independently of the
   IDE blur race. This patch reduces load; it does not fix that upstream mechanism.
   Keep Type pad until a reviewed composition-queue fix passes Windows TSF tests.
2. **Stalled remote Export:** `stream_profile_shell_to_file` reads stdout before
   draining piped stderr. A full stderr pipe can deadlock, and a blocked stdout read
   cannot promptly observe the cancellation flag. This pre-existing path needs an
   owned control loop, bounded stdout queue, continuously drained/capped stderr and
   supervised child cleanup. An unbounded detached reader or blind PID kill is not
   an acceptable shortcut. The progress throttle does not fix these lifecycle bugs.
3. **Notes permanent delete during an in-flight save:** the pre-existing delete
   path is not coordinated with file writes/memory updates; a late write can recreate
   a deleted note. The new save-to-save serialization does not coordinate deletion.
   A deletion tombstone and shared lifecycle fence need separate regression tests.
4. **Large preview HTML / whole-file APIs:** the Browser follow-up now caps optional
   HTML capture and streams raw pages on size/time fallback; see its integration
   tradeoffs and protocol limits. Large editor/image files remain whole-file operations;
   no whole-app constant-memory claim is made.
5. **Admission and optional UI work:** agent-bridge accepted connections still use
   individual worker threads; admission limits merit stress testing. Debug logging
   still persists/renders breadcrumbs synchronously when enabled. Large inline
   custom backgrounds and snippet-search serialization are further candidates,
   not demonstrated steady-state terminal bottlenecks or proven leaks.
6. **GPU, heap and startup:** profile the packaged Windows app with long LLM output,
   repeated workspace switches, hidden Browser traffic, large folders and glass
   on/off. Check input latency, long tasks, retained heap, child handles/thread count
   and cleanup after close. Source inspection alone cannot certify absence of leaks.

## Validation boundary

- Typecheck, IDE and Terminal Vite builds, runtime regression scripts, Rust formatting,
  65 Rust tests and host/Windows MSVC-target cargo checks pass after the Browser follow-up.
- The staging follow-up adds an eleventh regression script (13 manifest cases) and checks
  the Windows Rust target from an actual temporary copy selected by the default manifest,
  not just the original checkout, to cover newly added untracked modules.
- Existing Vite chunk-size and GNU cross-target advisories remain; they were not
  hidden by raising warning thresholds.
- Windows binaries cannot execute through this environment's WSL interop
  (`Exec format error`; no registered WSL interop handler). No Windows release/link
  or interactive WebView2 runtime success is claimed.
- Follow [Windows runtime smoke](WINDOWS_RUNTIME_SMOKE.md) using a Windows-local
  dependency tree/staged build. Never mix Windows and WSL npm in one node_modules.
