# 구현 아키텍처와 코드 탐색 지도

이 문서는 다른 컴퓨터에서 처음 작업하는 개발자와 LLM을 위한 **현재 소스의 지도**다.
기준일은 2026-09-19이며, 특정 개발 PC의 경로·계정·프로필 설정은 포함하지 않는다.
실행/빌드 절차는 [Windows smoke](WINDOWS_RUNTIME_SMOKE.md), 사용자 조작은
[사용자 가이드](USER_GUIDE.ko.md), 변경 이력은 [codex.md](../codex.md)를 함께 읽는다.
아래 함수명은 `rg -n '함수명' src/main.ts src-tauri/src/lib.rs`로 찾을 수 있다.
줄 번호 대신 검색 앵커를 사용한다. 상수값은 설명 시점의 값이며 변경 시 소스가 우선이다.

## 1. 제품과 실행 경계

```text
IDE 또는 Terminal Tauri 프로세스
 ├─ main WebView: TypeScript UI, xterm, CodeMirror, workspace 상태
 │   └─ src/api.ts → invoke → Rust Tauri commands
 ├─ Rust IdeState: PTY / forwarding / export / browser 자원 소유
 │   ├─ Windows PowerShell / wsl.exe / SSH bootstrap
 │   ├─ terminal-data / terminal-cursor-query / terminal-exit → UI
 │   └─ loopback TCP proxy, SSH -L, 선택적 agent hook bridge
 └─ Browser: native child WebView 또는 iframe + local HTTP preview proxy
```

- **Simple Vibe IDE**: Explorer, Editor, Image, Browser, Notes 등 floating widget을
  터미널과 함께 사용한다. `index.html`, `vite.config.ts`, `tauri.conf.json`이 기본 진입점이다.
- **Simple Vibe Terminal**: 같은 구현을 terminal-first UI로 사용한다.
  `terminal.html`, `src/apps/terminal/main.ts`, `vite.terminal.config.ts`,
  `tauri.terminal.conf.json`을 사용한다. 별도 백엔드나 복제된 터미널 엔진이 아니다.
- 프런트 분기는 `APP_VARIANT`, `IS_TERMINAL_APP`; 저장소 prefix도 다르다.
  Vite 개발 포트는 IDE 15320, Terminal 15321이며 배포 출력은 `dist/`, `dist-terminal/`이다.
- 이 제품은 **Windows-first**다. WSL/SSH는 주로 Windows 앱에서 접근하는 대상이다.
  Linux에서 Rust 체크가 된다는 이유로 Linux/macOS 앱의 모든 기능이 지원된다고 판단하면 안 된다.
  `terminal_command`의 WSL/SSH 진입 자체에도 Windows 실행 파일이 사용된다.

## 2. 파일 소유권과 변경 위치

| 파일/영역 | 책임 | 변경할 때 함께 볼 곳 |
| --- | --- | --- |
| `src/main.ts` | DOM, 상태, workspace, terminal, editor, explorer, browser, widgets의 주 구현 | 관련 회귀 script, `src/types.ts` |
| `src/api.ts` | typed IPC wrapper, renderer generation 전달 | Rust command 인자/응답의 camelCase 매핑 |
| `src/types.ts` | IPC 이벤트/결과와 공유 TypeScript 타입 | Rust serde 타입 |
| `src/privacyPolicy.ts` | 민감 파일명 판정, env/JSON 값의 마스킹 편집 모델 | main의 secure editor UI |
| `src/styles.css` | 레이아웃·테마·floating widget·glass 표현 | 실제 Windows DPI/resize/input 확인 |
| `src-tauri/src/lib.rs` | 앱 초기화, IPC, process/PTY, 파일 I/O, forwarding, preview, cleanup | `run`, `generate_handler!`, 각 command helper |
| `src-tauri/src/preview_body.rs` | bounded HTML body capture와 chunk framing | `proxy_http_preview`, `relay_preview_response_body` |
| `src-tauri/src/main.rs` | Rust executable entry | `lib.rs` |
| `src-tauri/capabilities/default.json` | main window의 Tauri 권한 | 두 Tauri config의 CSP/창 설정 |
| `scripts/*smoke*` | 실제 helper 추출 회귀 검사와 Windows smoke | `package.json`, Windows 검증 문서 |

`main.ts`와 `lib.rs`는 의도적으로 넓고 강결합되어 있다. 새 기능을 넣을 때 전면 분할보다
해당 helper 주변의 작은 변경과 lifecycle 확인을 우선한다. 두 파일을 여러 agent가 동시에
수정하지 않는다. 별도 모듈 추출은 성능·보안·회귀 검증 경계를 명확히 할 때 수행한다.

## 3. IPC와 비동기 자원 소유권

### UI generation과 operation은 다른 개념

- `api.prepareRendererRuntime`이 백엔드에서 받은 `rendererRuntimeEpoch`를 모듈 안에 보관한다.
  장기 자원을 생성하는 IPC에 epoch를 전달해 WebView reload 이전 요청이 새 renderer의
  자원으로 잘못 등록되는 것을 막는다.
- `operationId`는 terminal spawn, path resolution, directory 작업 등의 개별 취소 단위다.
  `begin_runtime_operation`, `RuntimeOperationRegistration`,
  `cancel_runtime_operation_host`가 중복·조기 취소·늦은 완료를 다룬다.
- `RuntimeProcessScope`, `runtime_lifecycle_read/write`, `APP_EXIT_REQUESTED`를 통해
  종료/교체 중의 새 자원 등록을 차단한다. UI의 Promise timeout만으로 native process가
  취소됐다고 간주하면 안 된다.
- 프런트는 별도로 **workspace ID + profile ID + root + generation/request identity**를
  확인한다. epoch만으로 workspace 간 오염을 막을 수 없다.

### 프로세스는 등록되기 전에도 소유자가 있어야 한다

`IdeState`의 `terminals`, `forwards`, `exports`, `edge_sessions`가 살아 있는 자원을 추적한다.
등록 전 실패는 `PendingTerminalChild`, `PendingProcessChild` 등의 Drop 경로가 정리한다.
`ProcessReaperQueue`와 Windows cleanup job은 소유한 자식의 종료·회수를 담당한다.
앱 종료/renderer 복구는 `drain_runtime_sessions` → `terminate_runtime_sessions`를 확인한다.

**금지할 회귀:** timed-out helper를 방치하기, 같은 요청을 scope 검사 없이 재시작하기,
전역 `wsl --shutdown`/모든 SSH/tmux process kill로 개별 문제를 해결하기.

## 4. 터미널 데이터 경로: 최우선 성능 계약

### 입력

```text
xterm onData / paste / Type pad
 → enqueueTerminalInputPacket (pane별 순서와 backend identity)
 → api.writeTerminal
 → write_terminal_host
 → bounded sync_channel
 → run_terminal_input_writer
 → PTY writer → shell/LLM
```

- 입력 batch 기본 간격은 4 ms다. 입력 queue와 live pending buffer에 한도가 있으며,
  queue 포화 재시도에도 순서/수명 검사를 유지한다. 조용히 입력을 버리거나 Ctrl+C를
  무조건 clipboard 동작으로 바꾸지 않는다.
- Rust 입력 writer는 별도 thread다. UI IPC가 blocking PTY write를 직접 수행하지 않도록 한다.
  `flushTerminalInput`/`flush_terminal_input`은 순서가 있는 barrier이며 무제한 대기가 아니다.
- 일반 shell 의미를 보존한다: 선택 영역 + Ctrl+C는 복사, 선택 없음 + Ctrl+C는 interrupt,
  Ctrl+V는 붙여넣기. 조합 입력과 paste를 keydown 문자열 합성으로 대체하지 않는다.

### 출력과 backpressure

```text
PTY reader (8 KiB read, UTF-8 경계 보존)
 → AppOutputBatcher (기본 4 ms)
 → terminal-data { id, data, sequence }
 → enqueueTerminalWrite / flushTerminalWriteBuffer
 → xterm.write(chunk, callback)
 → 실제 drain 완료 후 acknowledgeTerminalOutputIfDrained
 → TerminalOutputFlow의 outstanding budget 반환
```

- `TerminalOutputFlow`는 outstanding batch 64개/128 KiB budget으로 producer가
  renderer보다 무한히 앞서가지 못하게 한다. 단일 oversized reservation 예외가 있어
  이 숫자를 모든 메모리의 절대 상한으로 설명해서는 안 된다.
- xterm write chunk는 보이는 pane 16 Ki chars, 숨긴 pane 8 Ki chars, 최근 입력 중 2 Ki chars다.
  wake catch-up은 별도 64 Ki chars 경로가 있다. chars와 UTF-8 bytes를 혼동하지 않는다.
- pending xterm write 개수도 제한한다. ACK를 IPC 수신 즉시 보내면 WebView/xterm 내부에
  무제한 backlog가 다시 쌓일 수 있으므로 **실제 write 완료 기준**을 유지한다.
- `capTerminalWriteBuffer`는 극단적 backlog에서 일부 오래된 문자를 생략하고 안내 marker를
  남긴다. 이 UI는 무손실 원본 로그 보관소가 아니다.
- scrollback과 **Hist cache**는 별도다. scrollback만 줄여도 history parsing, 포트/CWD/title
  검사, LLM 상태 분석이 공짜가 되지 않는다. history parser는 bounded queue와 chunk/yield를
  사용하며, 숨긴 pane의 부가 작업은 낮은 빈도/idle로 처리한다.

### DSR/CPR: 실제 구현을 기준으로 읽기

`ESC[6n`은 Rust `push_terminal_output_without_dsr_queries`에서 원문 스트림에서 제거한다.
앞선 output batch를 먼저 flush한 후 `terminal-cursor-query` 이벤트를 보낸다.
UI의 `respondToTerminalCursorQueryNow`는 제한된 drain을 기다리고 xterm buffer의 실제
cursor 좌표로 `ESC[row;colR`을 생성하여 동일 입력 sequencer의 protocol 우선 경로에 넣는다.
즉 **Rust가 query 분리/출력 순서를 소유하고, UI가 좌표 응답을 계산**하는 협력 구조다.
raw query를 xterm에도 전달해 두 번 응답하거나, 사용자의 대기 입력을 지우면서 응답하면 안 된다.

### 한글 IME와 OpenTUI

- `bindTerminalImeCompositionGuard`, `scheduleTerminalImeCommitBoundary`,
  `deferTerminalImeUiSwitch`가 조합 중 blur/resize/widget 전환의 충돌을 줄인다.
  composition 종료와 xterm commit 시점이 반드시 같은 이벤트라고 가정하지 않는다.
- Type pad는 별도의 안전한 입력 경로로 유지한다. 무거운 출력에서의 입력 손실이
  완전히 해결됐다고 볼 수 없다. 설치된 xterm의 pending-composition timer 관련 가능성은
  [성능 감사의 미해결 사항](PERFORMANCE_AUDIT.md)에 기록되어 있다.
- OpenCode/OpenTUI pane은 `terminalPaneUsesOpenTuiCompatibility`와
  `scheduleOpenTuiTerminalViewportRefresh`를 확인한다. 모든 pane에 강제 refresh/resize를
  적용하는 우회는 일반 LLM 입력 성능을 다시 악화시킬 수 있다.
- renderer/WebGL/glass 변경은 소스 테스트만으로 품질을 판정하지 않는다.
  [OpenTUI 관련 기록](GROK_BUILD_CELL_WIDTH_DESYNC.md)과 실제 Windows GPU/DPI 재현을 함께 본다.

## 5. Windows / WSL / SSH와 tmux

### 연결 profile과 cwd

`ConnectionProfile.kind`는 `windows | wsl | ssh`다. `list_profiles`, `list_wsl_profiles`,
`ssh_profiles`, `profile_from_id`가 profile을 구성하고 `terminal_command`가 실행 계획을 만든다.

- Windows shell: trusted system Windows PowerShell 경로 + profile loading + bootstrap.
  `resolve_windows_profile_path`, `powershell_terminal_bootstrap_script`를 본다.
  `D:\Projects\Example`은 절대 경로지만 `D:Projects\Example`은 drive-relative다.
  `#` 등 특수문자 문제와 경로의 절대/상대 문제를 분리하고 literal 경로 처리/인코딩을 보존한다.
- WSL: `wsl.exe -d ... --cd ... -- bash -lc ...`로 bootstrap한다.
  home/distro/warmup cache, `WslHelperGate`, 제한된 concurrency와 transient retry가 있다.
  탐색기 directory IPC가 최초 shell readiness보다 먼저 몰리지 않도록 frontend도 지연한다.
- SSH: Windows PowerShell 제어 bootstrap → OpenSSH → remote bash 경로다.
  Windows OpenSSH agent가 사용 가능하면 재사용하고, 필요 시 IDE askpass 경로를 사용한다.
  제어 helper의 `-NoProfile`은 대화형 shell의 `-NoProfile`과 목적이 다르다.
  `ssh_askpass_env_vars`, `apply_session_ssh_auth_to_*`, `ssh_common_options`를 확인한다.

### tmux는 일반 shell 수명과 다르다

- 일반 PTY는 앱 프로세스에 직접 속하며 앱 종료/재실행 후 기존 프로세스에 재접속하지 않는다.
  `-NoLaunch` 재빌드 자체는 실행 중 앱이나 해당 PTY를 종료하지 않는다.
  과거 background pty-host/keep-alive 설계는 입력 지연 때문에 제거됐다. 재도입하지 않는다.
- 명시적인 tmux detach/reattach는 예외다. IDE pane 종료와 tmux session 삭제는 같은 행위가 아니다.
  LLM 버튼은 새 session 선택/기존 session 재사용/명시적 삭제 경로를 구분한다.
- frontend 검색: `LLM_LAUNCHERS`, `nextLlmTmuxSession`,
  `llmLaunchWorkspaceScopeIsCurrent`, `numberedWorkspaceTmuxSessionName`.
- backend 검색: `prepare_windows_llm_tmux_session`, `windows_llm_tmux_prepare_script`,
  `exact_llm_tmux_session_target`, `exact_llm_tmux_pane_target`, `WINDOWS_LLM_TMUX_*`.

### Windows 생성 경로의 중요한 계약

1. Windows tmux는 `-L simple-vibe-ide`로 IDE 서버를 구분한다. tmux는 별도 설치 항목이다.
2. 새 LLM session의 inner launcher는 **PowerShell 5.1 프로필을 읽는다**.
   이름 기반 `& 'codex'` 호출이 profile의 함수를 통과할 수 있어야 한다.
   임의로 `codex.exe` 직행이나 `llm-usage run codex` 하드코딩으로 바꾸지 않는다.
3. **새 session만** PS5.1 `default-shell`, 빈 `default-command`를 설정한다.
   따라서 commandless `new-window`/`split-window`는 해당 shell을 상속한다.
   기존 session은 setter 이전에 반환하며 기존 작업을 재시작하지 않는다.
4. tmux option 대상은 exact pane 스타일 `=session:`을 사용한다.
   PS5 native argv의 빈 인자 유실을 피하려면 `set-option -F ... '#{l:}'`를 유지한다.
5. 전역 `-g` 수정이나 `-f NUL`로 사용자 `.tmux.conf`를 우회하지 않는다.
   attach ExternalScript 분기의 `-NoProfile`만 제거해서 생성 문제를 해결했다고 간주하지 않는다.
6. 변경 검증은 `scripts/windows-tmux-profile-smoke.ps1`과 opt-in Rust fixture exporter를 사용한다.
   UUID 테스트 서버와 harmless Codex 함수만 사용하고 실 LLM/기존 session을 종료하지 않는다.

2026-09-09에 기록된 native Windows smoke에서는 PS5.1 profile, 함수 dispatch,
commandless window/split, 기존 테스트 session의 설정 보존이 검증됐다.
모든 tmux wrapper 구현이나 이후 설치 버전에 대한 보장은 아니다.

## 6. Workspace, 저장 상태, 비동기 전환

**workspace snapshot ≠ runtime cache ≠ 살아 있는 native 자원**이다.

- `WorkspaceSnapshot`/`workspaceSnapshotsFromStore`, `persistWorkspaceStore`는 복구할 UI와
  작업 맥락을 저장한다. root/profile, pane layout, editor/tab 상태, browser 상태, port 규칙 등이
  포함될 수 있지만, 이전 프로세스 ID가 다음 실행에서 유효하다고 가정하지 않는다.
- `WorkspaceRuntimeCache`는 같은 실행 안에서 editor/탐색기/browser 등의 재사용을 돕는다.
  `snapshotEditorPanesForRuntime`, `snapshotExplorerRuntimeCache`, `restoreBrowserState`를 본다.
- `switchWorkspace`, `closeWorkspace`, `closeTerminalsForWorkspace`는 서로 다르다.
  전환은 모든 terminal을 매번 종료/재생성하는 동작이 아니다. 숨김/복구/정리를 구분한다.
- 일반 workspace 저장 수는 24개, named saved workspace는 32개 한도다.
  persist debounce, snapshot signature cache, image reference 저장으로 반복적인 큰 JSON 생성을 줄인다.
- profile/root가 같아 보여도 이전 비동기 request의 결과가 현재 UI에 유효하다는 뜻은 아니다.
  오래된 callback이 새 workspace의 timer를 지우거나 editor/file/browser를 덮어쓰지 않도록
  request identity와 scope 검사를 보존한다.

저장소에 root 경로, 문서 내용, 이미지, notes, browser URL 같은 사적 데이터가 들어갈 수 있다.
workspace export/localStorage/profile을 공개 저장소에 넣는 것은 소스 배포와 별개의 문제다.

## 7. Ports와 Browser는 독립 기능

### IDE Ports manager

- toolbar **Ports**와 Browser 안의 Ports는 같은 관리 UI를 연다. Browser가 보이지 않아도
  forward/list/Stop/Retry/Enable/Disable/Forget을 사용할 수 있다.
- `scanTerminalOutputForPorts`, `detectNewLocalServerPorts`는 신규 terminal 출력의 URL/서버
  단서를 bounded buffer로 분석한다. scrollback 전체 재검색이나 OS listener polling이 아니다.
  분할 출력에는 carry를 두며, inactive pane의 숫자 발견은 최대 32개를 보류한다.
- 신뢰할 수 있는 단서의 WSL/SSH 포트는 자동 연결을 시도하지만 임의 텍스트의 모든 숫자나
  모든 프로세스 listener가 자동 발견되는 것은 아니다. Windows 로컬 서버는 직접 접근한다.
- `WorkspacePortRule`은 workspace/profile/root별 `remotePort`, `localPort`, `enabled`를
  최대 32개 저장한다. **runtime forward ID나 process ID를 저장해 재사용하지 않는다.**
- `restoreWorkspacePortForwards`는 해당 workspace 활성화 때 enabled rule을 순차 복원한다.
  기존 tunnel을 재사용하며 실패한 고정 포트는 Retry 상태로 남긴다.
- `startBrowserForwardForScope`는 생성 중복과 늦은 반환을 관리한다. Stop은 복원을 disable하며,
  pending 요청은 tombstone을 유지하여 늦게 도착한 tunnel을 정리한 후 Forget할 수 있게 한다.
- Forward/자동 복원은 **browser를 자동으로 열지 않는다**. Open 동작과 분리되어 있다.

### 실제 backend 연결

- SSH는 loopback bind의 `ssh -N -L` 자식을 소유한다.
- WSL/Windows의 같은 local/remote port는 이미 제공되는 localhost 노출을 표현한다.
  자기 자신으로 proxy하는 listener를 새로 만들지 않는다.
- 다른 local port가 필요하면 local TCP relay를 만든다. `ForwardProxyControl`은 connection
  admission/연결 socket 정리를 담당하며 proxy별 최대 128개 연결 제한이 있다.
- 앱 종료 시 IDE가 소유한 tunnel/relay는 정리한다. 외부 서버 프로세스나 WSL 자체의
  localhost forwarding을 IDE가 끄는 것은 아니다.
- **Terminal 앱의 Ports는 별도 runtime 흐름**이다: `queueTerminalPort`,
  `startTerminalPortForward`, readiness probe와 scope generation을 확인한다.
  IDE의 저장 규칙/복원 계약을 Terminal에도 구현된 것으로 확대 설명하지 않는다.

## 8. Browser preview와 보안/성능 경계

- 기본 경로는 scoped **native child WebView**다. capture protection이 적용되는 workspace는
  **iframe/local HTTP proxy fallback**을 사용한다. native child는 DOM z-index만으로 제어되지
  않으므로 bounds, occlusion, hide/close lifecycle이 중요하다.
- `showBrowserWebview` → `show_browser_webview`, `nativeBrowserPreviewRect`,
  `nativeBrowserPreviewOccluded`, `nativeBrowserWebviewLabelForTab`이 연결점이다.
- `startEdgeDevtoolsSession` 등의 API는 남아 있지만 Edge CDP preview는 현재 기본 활성 경로가
  아니다. 과거 startup/readiness freeze를 해결한 것으로 가정하여 켜지 않는다.
- 같은 navigation이 진행 중일 때 iframe `src`를 다시 쓰지 않는다. native bounds dedup은
  실제 좌표가 같은 경우만 건너뛴다. hidden context 수/TTL과 suspend는 메모리 절약 장치다.
  오래 숨겼다가 돌아온 페이지의 in-page state가 영구 보존된다는 계약은 없다.
- `startPreviewProxy`는 `parse_http_preview_target`을 통과한다. **명시적 포트가 있는
  loopback HTTP**가 대상이며 임의 원격 호스트나 HTTPS용 범용 프록시가 아니다.
  일반 Browser 주소 입력과 console injection proxy의 지원 범위를 구분한다.
- HTTP proxy는 origin/header/cookie/upgrade 등의 개발 preview 동작을 다룬다.
  `proxy_http_preview`, `rewrite_preview_*`, `preview_console_bridge_script`가 앵커다.
- `preview_body::capture_preview_body`는 optional bridge injection만 최대 2 MiB/짧은 시간
  budget으로 시도한다. 크거나 느리거나 unsupported body는 원래 wire prefix를 보존해
  passthrough한다. **페이지 크기 자체를 2 MiB로 제한하는 것이 아니다.** 대신 해당 페이지는
  injected console 등 bridge 의존 기능을 사용할 수 없을 수 있다.
- Console은 argument/depth/message/queue/render 수를 제한하고 hidden drain을 합친다.
  로그를 위로 읽는 동안 새 로그가 무조건 맨 아래로 스크롤시키지 않는다.
  이 상세 모드는 무제한 JSON snapshot/export 기능이 아니다.

더 자세한 protocol/메모리 tradeoff와 검증은 [Browser 성능 문서](BROWSER_PERFORMANCE.md)를 본다.

## 9. Explorer, Editor, Notes와 기타 기능

| 기능 | 구현 앵커와 유지할 동작 |
| --- | --- |
| Explorer | `fetchExplorerDirectory`, `listDirectories`, `directorySignatures`, `renderExplorer` 계열. 가시 row/expanded directory 위주의 작업, cache/dedup, 원격 timeout/cancel을 보존한다. 파일 크기는 기본 off이며 recursive size 계산을 listing마다 추가하지 않는다. |
| Explorer 생성 위치 | 빈 영역 클릭은 선택을 풀고 current directory를 생성 대상으로 사용할 수 있어야 한다. 자식 folder가 존재한다고 무조건 그 안에 생성하면 안 된다. `selectExplorerEntryFromPointer`와 생성 target 결정 helper를 함께 본다. |
| 파일 열기 | `openFile` → editor 활성화와 `bringPanelToFront`. 이미 열린 tab을 선택해도 Editor가 다른 widget 뒤에 가려져 있지 않도록 한다. |
| CodeMirror | `ensureEditorRuntime`, `hydrateEditorLanguage`, `editorViewDocumentText`. lazy import와 immutable Text의 단일-version 문자열 cache를 사용한다. workspace 전환 시 live selection/scroll 복구를 유지한다. |
| 안전 편집 | `shouldMaskFile`, `parseSecretLines`, `serializeSecretLines`, `appendSecureKeyRow`. 값 숨김은 UI 표현이며 암호화/권한 격리가 아니다. env/JSON 구조와 숨긴 값의 원본 보존을 깨뜨리지 않는다. |
| 파일 쓰기 | `write_text_file_atomic_if_unchanged`와 expected text 비교가 필요한 경로를 보존한다. 충돌 탐지/원자성은 모든 파일 API에서 동일하다고 가정하지 않는다. |
| Delete/Restore | `deletePaths`, `restoreDeletedPaths`와 명시적인 `deleteNoteFilePermanently`는 별도 계약이다. 영구 삭제를 일반 삭제로 몰래 바꾸거나 그 반대 변경을 하지 않는다. |
| Notes | `.vibe-ide-temp/notes`, `saveNoteTabNow`, `performNoteSave`; tab별 save 직렬화/coalescing, scope 고정, 메모리 저장 한도를 사용한다. 저장과 삭제 간 race는 별도 미해결 사항이다. |
| Snippets | `readSnippetsStore`/`writeSnippetsStore`, Rust `SNIPPETS_STORE_FILE`; Tauri `app_config_dir()/snippets.v1.json`의 versioned JSON, 상한 1 MiB. snippet에 비밀이 없다는 보장은 없다. |
| 이미지/첨부 | `saveAttachment`, `copyDroppedFiles`, `readFileDataUrl`, workspace image references. 파일명/path quoting, binary stdin 전송, image history cap을 유지한다. |
| Export | `startExportPath`, `cancelExportPath`; 진행률 갱신은 throttle하지만 remote pipe/cancel 설계의 모든 문제가 해결된 것은 아니다. |
| LLM 상태/알림 | `prepareAgentBridgeForLlmLaunch`, `registerAgentBridgeForPane`, `agent_bridge_status_for_event`, tmux title/OSC/출력 분석. hook 권위와 보조 heuristic, 대기/완료 debounce를 구분한다. |
| Glass/레이아웃 | `applyAppGlassSettings`, `syncWorkspaceGlassTicker`, floating panel 배치·pin·scale·opacity. theme/export와 GPU snapshot 비용은 terminal I/O와 별도 평가한다. |
| 그 밖의 UI | calculator, market ticker, diagnostics, capture protection, widget focus/keyboard shortcuts 등은 `main.ts`와 [사용자 가이드](USER_GUIDE.ko.md)에서 확인한다. |

## 10. 저장·신뢰·공개 저장소 경계

### 상태 저장 위치와 이전 단위

| 상태 | 저장 주체 / 소스 앵커 | 새 시스템에서의 의미 |
| --- | --- | --- |
| workspace/설정/레이아웃 | WebView `localStorage`, `APP_STORAGE_PREFIX`, `WORKSPACE_STORE_KEY`, `IDE_SETTINGS_KEY` | clone과 별개. IDE/Terminal prefix 구분, absolute root/URL 포함 가능 |
| named saved layout, image/Notes 메모리 | `SAVED_WORKSPACE_STORE_KEY`, `WORKSPACE_IMAGE_STORE_KEY`, `NOTES_MEMORY_STORE_KEY` | UI context이며 프로세스 재개 데이터 아님. 개인 텍스트/이미지 포함 가능 |
| Snippets | Tauri `app_config_dir()/snippets.v1.json`, `snippets_store_path` | 계정/OS별 config 경로. 비공개 백업 후 대상 경로를 확인 |
| Notes/attachments/deleted 파일 | 프로젝트 `.vibe-ide-temp/` 하위, 각 file API | ignored여서 clone에 없음. 필요한 데이터는 별도 보존 |
| connection profiles | `list_profiles`, WSL distro 탐지, `detect_ssh_aliases` | 새 시스템의 실제 distro/SSH 설정에서 다시 구성 |
| shell history | `bash_bootstrap_script`, `powershell_terminal_bootstrap_script` | pane별 private history. 사용자 command를 Git에 넣지 않음 |
| PTY/forward/proxy/askpass cache | native 메모리와 소유 process/socket | 이식 불가. 새 환경에서 다시 생성/인증 |

단일한 전체 데이터 portable export/import는 없다. 앱을 정상 종료한 뒤 비공개 백업을
고려하고, 목적지에서 실제 저장 위치와 경로를 확인한다. 임의의 WebView 내부 DB를
덮어써 자동 이관이 보장된다고 설명하지 않는다.

`EditorTabSnapshot`은 id/path/rawMode 중심이며 live CodeMirror 본문/selection/scroll은
별도 runtime cache다. workspace 저장을 미저장 editor 본문과 정확한 위치의 타 PC 백업으로
간주하지 않는다. 이관 전 파일을 저장하고 개인 데이터 백업을 따로 확인한다.
shell 명령 history와 Hist 출력 cache도 별개다. Windows shell history는
`%LOCALAPPDATA%\Simple Vibe IDE\terminal-history\<uuid>.txt`, WSL/SSH 대상에서는
`${XDG_STATE_HOME:-$HOME/.local/state}/simple-vibe-ide/terminal-history/<uuid>.bash`다.
POSIX directory/file 권한 700/600과 UUID 검증을 보존한다.

### 신뢰 경계

- `.handoff/`, `.vibe-ide-temp/`, auth/profile/env 자료는 코드와 다른 종류의 로컬 자산이다.
  handoff가 없더라도 이 문서와 실제 git 상태로 시작할 수 있어야 한다.
- Tauri main 창의 권한은 `capabilities/default.json`, origin/CSP는 Tauri config에 있다.
  preview 페이지에 main IPC 권한을 확대하지 않는다. native child label, navigation, postMessage
  source/origin 검사 변경은 기능 변경과 함께 보안 검토가 필요하다.
- agent bridge와 SSH askpass는 loopback와 token을 사용하는 로컬 통신이다.
  token, auth 응답, clipboard, transcript, URL의 민감 query를 진단 로그에 출력하지 않는다.
  `handle_agent_bridge_http_request`, `handle_ssh_askpass_http_request`가 입력 검증 경계다.
- 파일 마스킹은 heuristic이다. `.example`/sample 예외, raw line 등으로 모든 비밀을 자동 탐지할
  수 없으며 capture protection도 저장 데이터 암호화 기능이 아니다.
- HTML/console injection은 개발용 편의 기능이다. 임의 원격 사이트의 보안 정책 우회 기능으로
  확장하지 않는다. 공개 문서에는 실제 SSH alias/hostname, 사용자 홈, 토큰, 고객 데이터 대신
  `[USER]`, `[WORKSPACE]`, `[DISTRO]`, `[PRIVATE_URL]`을 사용한다.

## 11. 검증 수준과 남은 위험

1. `npm run check`는 TypeScript 계약 검사다.
2. `npm run check:regressions`는 현재 13개 Node helper smoke를 실행한다.
   실제 helper를 추출해 비동기/성능 계약을 확인하지만 WebView2 GUI end-to-end 테스트가 아니다.
3. `cargo test --manifest-path src-tauri/Cargo.toml --lib`는 native parser/lifecycle/loopback 등
   Rust 테스트다. 일부 환경 의존 fixture exporter는 ignored이며 명시적으로 실행한다.
4. Rust fmt/Windows MSVC check와 IDE/Terminal frontend build를 함께 확인한다.
5. Windows staged `-NoLaunch` smoke는 실제 native release/link/artifact 검사다.
   성공해도 실제 한글 입력·TUI·복사/붙여넣기·DPI·Browser GUI 검증을 대신하지 못한다.

`codex.md`의 2026-09-09 기록에는 73 regular Rust tests, 13 Node scripts, Windows 두 제품
release build와 별도 tmux smoke 통과가 남아 있다. 이는 **당시 기록**이며 새 컴퓨터에서
재검증해야 한다. 과거 성능 문서의 WSL interop 불가 기록을 현재 환경의 불가능 판정으로
그대로 적용하지 않는다.

우선 재현할 미해결 영역:

- 부하 중 native Korean IME/xterm composition timer: Type pad 유지, Windows TSF 실측 필요.
- `stream_profile_shell_to_file`의 stderr/blocked stdout과 취소: 진행률 throttle이 해결한 문제가 아니다.
- Notes 영구 삭제와 in-flight save 경합: 저장 직렬화만으로 삭제 tombstone을 대신할 수 없다.
- 대용량 editor/image는 여전히 whole-file API다. 모든 메모리가 bounded라는 주장은 금지한다.
- agent bridge connection thread admission, debug logging, GPU/heap/thread/handle 장시간 추적은
  추가 실측 대상이다. 소스 감사만으로 leak 부재를 보증할 수 없다.

다음 시스템에서의 최우선 수동 시나리오는 **긴 LLM 출력 + 한글 typing + workspace 왕복 +
큰 Explorer + 숨긴 Browser**의 조합이다. 기능 하나씩 되는 것과 동시 부하에서 빠른 것은 다르다.
