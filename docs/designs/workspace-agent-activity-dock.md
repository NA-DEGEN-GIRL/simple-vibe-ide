# Design Brief: Workspace Agent Activity Dock

**Status:** V1 implemented frontend-first; structured hook/log watcher remains future work.
**Brief path:** `docs/designs/workspace-agent-activity-dock.md`

**Problem / why:**  
현재 Simple Vibe IDE는 workspace별 shell/LLM 세션을 빠르게 띄우는 데 강하지만, 여러 workspace와 여러 LLM이 동시에 돌 때 "어느 workspace에서 누가 일 중인지 / 입력 대기인지 / 끝났는지 / 뭘 하고 있는지"가 한눈에 약하다. Helm의 장점은 terminal을 유지하면서도 agent의 구조화된 상태를 별도 rail에 보여주는 점이므로, 이를 우리 workspace tab/dock에 맞게 흡수한다.

**Success looks like:**  
사용자가 현재 workspace를 떠나 있어도, 좌/우 workspace dock에서 각 workspace의 LLM 세션 상태와 간단한 진행 상황을 보고 즉시 필요한 workspace/session으로 돌아갈 수 있다.

**Acceptance criteria (testable):**
- [ ] 좌/우 workspace dock detail을 열면 active workspace 또는 전체 workspace의 LLM 세션 목록이 표시된다.
- [ ] 각 LLM 세션은 agent 종류, shell 제목, 상태(`working`, `waiting`, `idle/done`, `error/exited`), 최근 activity를 표시한다.
- [ ] 사용자가 다른 workspace를 보고 있어도 background workspace의 `waiting`/`working` 상태가 workspace tab/dock에 전파된다.
- [ ] 구조화 로그/훅을 사용할 수 없는 agent는 기존 terminal title/output 기반 fallback으로 최소 상태만 표시한다.
- [ ] transcript 원문은 기본적으로 저장하지 않고, UI에는 capped summary/todos/tools만 표시한다.
- [ ] 많은 workspace가 있어도 dock 갱신이 terminal typing/scroll 성능을 눈에 띄게 해치지 않는다.

**In scope (MVP):**
- Workspace side dock detail을 Helm식 activity panel로 전환.
- Workspace aggregate status:
  - `waiting`: 사용자 입력/선택 필요
  - `working`: agent 작업 중
  - `idle/done`: 세션은 있으나 현재 작업 없음 또는 turn 종료
  - `error/exited`: 오류/종료
- Terminal pane 단위의 `AgentSession` 개념 도입.
- 기존 launcher/detected LLM id를 session identity로 사용.
- Claude/Codex/Grok/Antigravity별 상태 source를 "가능한 수준"으로 normalize.
- 우선 표시 항목:
  - agent badge
  - session title/cwd
  - state chip
  - current activity 1줄
  - todo progress `done/total`
  - recent tools chips
  - context/token meter는 source가 있을 때만 표시
- 상태 정보는 session memory 중심. workspace snapshot에는 raw transcript를 저장하지 않음.

**Out of scope (for now):**
- Helm 전체 UI 복제.
- 중앙 terminal을 "대화 카드 뷰"로 완전히 대체하는 기능.
- 모든 agent에 동일한 정확도의 token/context 표시 보장.
- cloud sync, cross-device state sync.
- 장기 보관용 transcript database.
- LLM에게 자동 응답하거나 자동 승인하는 기능.

**Constraints:**
- Windows-first Tauri/WebView2.
- terminal responsiveness가 최우선. title/dock 갱신이 xterm write path를 막으면 안 됨.
- repo는 public이므로 transcript, private path, secret 노출 주의.
- 한국어 UI/상태명 우선, technical enum은 영어 유지.
- 기존 workspace memory saver/capture protection과 충돌하지 않아야 함.
- 좌/우 dock은 이미 공간을 밀어내는 layout으로 들어갔으므로 이 영역을 우선 활용.

**Related briefs / existing decisions checked:**
- `codex.md` 2026-06-24 workspace dock patch note
- `codex.md` 2026-06-23 workspace LLM status propagation patch note
- `docs/USER_GUIDE.ko.md` Workspace tab 위치 / Memory Saver / terminal renderer sections
- `src/main.ts` current `workspaceDockDetail`, `WorkspaceLlmIndicatorState`, terminal title/output detection flow
- Local Helm snapshot `/tmp/helm-inspect` at `caa7c39`

**Key decisions:**
- Workspace-first, not session-first — chose to keep Simple Vibe IDE organized around workspace tabs, while Helm is more session/dashboard-oriented.  
  Limit/risk we accept: per-session detail may feel slightly nested, but it preserves the existing mental model.
- Side dock detail is the primary surface — chose left/right workspace dock detail for Helm-like information, while top/bottom tabs stay compact.  
  Limit/risk we accept: users who keep tabs at top/bottom only see summary dots/badges, not full detail.
- Normalized `AgentSessionProgress` schema — chose one app-level shape over agent-specific UI branches.  
  Proposed shape:
  - `workspaceId`
  - `paneId`
  - `agentId`
  - `status`
  - `activity`
  - `todos`
  - `tools`
  - `context`
  - `updatedAt`
  - `source`
  
  Limit/risk we accept: some agents will provide partial data only.
- Source priority: hook/log > title > output heuristic — chose structured sources when available, but keep current lightweight terminal title/output detection as fallback.  
  Why: Helm's strongest idea is not just spinner scraping; it tails agent logs and/or receives hook events, then normalizes them.  
  Limit/risk we accept: each CLI version may change log format, so watcher code needs graceful degradation.
- Privacy by default — chose not to persist raw transcript or full tool results in workspace snapshot.  
  Limit/risk we accept: after app restart, detailed activity history is gone unless later explicitly adding an opt-in history mode.
- Detail UI should be summary-first — chose compact rows/cards over a giant transcript panel in MVP.  
  Limit/risk we accept: users cannot read the full conversation from the dock yet; they must focus the terminal/session.
- Aggregate status priority — workspace summary should prioritize user action:
  1. `waiting`
  2. `error`
  3. `working`
  4. `idle/done`
  5. `exited`
  6. `none`
  
  Limit/risk we accept: `error` and `waiting` may both require attention; UI color/tooltips must distinguish them.

**Open risks / assumptions:**
- Assumption: v1 should be lightweight and local-only.
- Risk: Claude/Codex/Grok/Antigravity logs/hooks differ and may change. The UI must show source quality, e.g. `live`, `log`, `title`, `heuristic`.
- Risk: background watching too many sessions could add CPU/RAM overhead. Need caps, debounce, and inactive cleanup.
- Risk: showing tool summaries can leak filenames or sensitive args. Need truncation and masking.
- Risk: "done" vs "idle" is not always a real event. Some CLIs only expose "not working anymore"; UI should avoid overpromising.

**Pre-mortem:**
If this fails, likely causes are:
- We try to parse terminal text too deeply and it becomes brittle.
- We store/show too much transcript and create privacy/performance problems.
- Dock becomes noisy and harder to scan than current colored dots.
- Background sessions do not update unless their workspace is active.

Decision after pre-mortem:
- MVP must stay summary-only.
- Structured hook/log source is preferred, but fallback remains minimal.
- Workspace aggregate status must be updated from backend/session state, not only from visible terminal rendering.

**Changelog:**
- 2026-06-24 — drafted.
- 2026-06-25 — implemented lightweight runtime `AgentSessionProgress` state, workspace aggregate status, and active-workspace side dock cards from launcher/title/output/input/exit signals. No raw transcript persistence and no backend hook/log watcher yet.
