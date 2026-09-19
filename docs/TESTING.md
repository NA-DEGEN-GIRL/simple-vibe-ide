# 검증과 공개 전 점검

기준일: 2026-09-19. 설치는 [DEVELOPMENT_ENVIRONMENTS.md](DEVELOPMENT_ENVIRONMENTS.md),
완료 장부는 [DEVELOPMENT_HANDOFF.md](DEVELOPMENT_HANDOFF.md)를 본다.

## 1. 기본 자동 gate

저장소 root에서 실행한다. fresh clone은 해당 OS의 `npm ci`부터 한다.

```text
npm run check
npm run check:regressions
npm run build
npm run build:terminal
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

`npm test`는 정의되어 있지 않다. Node regression scripts와 Rust `#[test]`가
있으므로 과거의 "unit tests 없음" 안내는 더 이상 정확하지 않다.
Host Rust test는 host Tauri 시스템 라이브러리가 필요할 수 있다. Linux cross-check
통과는 Windows MSVC linker/WebView2/ConPTY 실행 검증을 대신하지 않는다.

## 2. 회귀 스크립트 지도

Node fixtures는 주로 실제 helper를 추출해 제한된 DOM/IPC 대역으로 실행한다.
helper 이름/구조 변경 시 추출 assertion도 점검한다. 전체 UI E2E suite는 아니다.

| `scripts/` 파일 | 보호하는 계약 |
| --- | --- |
| `terminal-performance-smoke.mjs` | ANSI/control 분할, bounded history, chunk/yield, hidden flush |
| `terminal-output-flow-smoke.mjs` | 출력 sequence/ack와 renderer 경계 |
| `workspace-async-smoke.mjs` | 목록/파일 dedup, workspace 세대/취소, 늦은 완료 |
| `terminal-ime-smoke.mjs` | 설치된 xterm의 Hangul composition/blur/refocus, 입력 소유권 |
| `explorer-interaction-smoke.mjs` | 빈 영역 cwd 선택, editor 전면, selection |
| `editor-performance-smoke.mjs` | dirty chrome/cache, Notes 저장 순서/용량, Explorer |
| `storage-browser-smoke.mjs` | idle drain 단일화, stale callback 차단, bridge 제한 |
| `browser-lifecycle-smoke.mjs` | iframe/native navigation/bounds/show dedup, reload/TTL |
| `browser-console-smoke.mjs` | follow-tail, hidden ingestion cap, 동일 렌더 생략 |
| `browser-proxy-scope-smoke.mjs` | probe/start 공유, retry/scope 폐기/late resource 정리 |
| `windows-stage-manifest-smoke.mjs` | 새 소스 포함, 개인/불법 경로 제외, Unicode/collision |
| `windows-shell-cwd-smoke.mjs` | literal cwd, drive-relative 보정 승인/실패/scope |
| `workspace-ports-smoke.mjs` | 분할 URL, background 규칙, Stop/Forget/restore/race |

Rust tests는 `lib.rs`의 `#[cfg(test)]` 모듈과 `preview_body.rs`에 있다.
PTY credit/중단, 입력 queue/flush, UTF-8/DSR, Windows cwd/tmux, WSL retry,
watchdog, file I/O 및 실제 loopback proxy 응답/half-close 등을 검증한다.
현재 73개 기본 실행, opt-in exporter 1 ignored다. 개수보다 결과를 본다.

## 3. 변경 영역별 최소 검증

| 변경 | 실행 |
| --- | --- |
| docs | 링크/명령/source anchor, privacy scan, `git diff --check` |
| frontend | check + 관련 Node fixture; 공통 helper 변경은 13개 전체 |
| UI bundling/flavor | 두 frontend build; 두 제품 구분 확인 |
| Rust/runtime | fmt + lib tests + Windows-target check |
| Windows launcher/build | 위 항목 + Windows staged/local smoke 및 PS fixtures |
| IME/PTY/Browser | 자동 gate + Windows 수동 재현, 이전 동작 비교 |

## 4. Windows build와 isolated tmux

Windows-local checkout에서 개발자 shell을 연 뒤:

```powershell
.\scripts\windows-runtime-smoke.ps1 -NoLaunch
```

WSL checkout은 [환경 문서](DEVELOPMENT_ENVIRONMENTS.md)의 `cmd pushd` +
staged helper 경로를 쓴다. `-SkipNpmInstall`은 올바른 Windows dependency tree가
이미 있을 때만 적용한다(staged helper에는 이 옵션 없음). 최종 gate는 두 제품의
exe/metadata를 검사한다. `-NoLaunch`는 GUI 검증이 아니다.

추가 PowerShell 회귀 fixture:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows-build-artifacts-smoke.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows-build-routing-smoke.ps1
```

tmux는 [Windows runtime guide](WINDOWS_RUNTIME_SMOKE.md)의 isolated smoke 절차를
따른다. Rust ignored `export_windows_tmux_profile_smoke_fixture`를 명시적으로 실행해
fixture JSON을 만든다. `SVI_TMUX_SMOKE_FIXTURE_DIR`은 비공개 임시 경로로 지정한다.
PS smoke는 UUID test server만 사용/정리한다. LLM 대체 함수로 dispatch를 검증하므로
실제 Codex 호출이 아니다. 읽은 사용자 profile/config를 로그에 출력하지 않는다.
production `-L simple-vibe-ide`에 `kill-server`/global `set-option` 금지.

SSH fixture는 `scripts/ssh-agent-fixture-smoke.sh`를 먼저 읽고 필요한 sshd/agent
도구를 준비한 테스트 환경에서 실행한다. real key/passphrase로 실험하지 않는다.
`windows-ssh-agent-smoke.ps1`는 선택적 OS agent 진단이며 기본 앱 askpass gate가 아니다.

## 5. 새 Windows 시스템 수동 smoke

flavor/build를 기록하되 개인 root/host/출력은 공개하지 않는다.
상세 체크리스트는 [WINDOWS_RUNTIME_SMOKE.md](WINDOWS_RUNTIME_SMOKE.md)에 있다.

1. **시작/종료:** 빈 workspace에 shell 자동 생성 없음. tab 전환은 live shell 유지,
   종료는 ordinary PTY/owned forwards 정리. 두 exe의 제품/설정 구분.
2. **cwd:** Windows absolute 경로(공백/한글/`#`), drive-relative 승인/취소,
   WSL cwd, SSH cwd/askpass. 실제 경로를 가려 결과 보고.
3. **Terminal:** 긴 synthetic 출력 중 한글 연속 입력, composition 중 blur/tab 전환,
   반복 음절/paste, 선택 복사/비선택 interrupt. 개인 대화 로그는 fixture로 쓰지 않음.
4. **TUI/tmux:** 새 test session과 기존 attach 구분. PS profile 함수/window/split,
   Grok/OpenCode DOM fallback, resize/cursor. 실제 작업 종료 금지.
5. **Explorer/Editor:** 파일 열기 → editor 전면, 빈 곳 선택 → root 생성,
   workspace 왕복 → 위치 보존. 목록 요청 중 전환해 타 workspace 오염 확인.
6. **Ports:** Browser를 닫고 출력 감지 → 등록/연결. Stop/Retry/Forget, 연결 중 전환,
   재시작 후 workspace 진입 복원. 브라우저가 자동으로 열리지 않아야 함.
7. **Browser:** native/capture-safe, hidden/visible/tab 전환, console 과거 스크롤,
   reload/cache clear, 큰 HTML/지연 서버. proxy/tab 수의 지속 증가 관찰.
8. **빌드:** timestamped exe 실행 중 `-NoLaunch` rebuild. 기존 앱은 유지되고
   새 exe가 별도 이름으로 게시되어야 함. 기존 앱 종료 여부는 사용자가 결정.

각 항목에 pass/fail/not run, 재현 단계, 기대/실제, flavor, commit/build ID를 남긴다.
정적 helper 성공을 GUI 성공으로 바꾸지 않는다. leak 검증에는 시간/반복 횟수,
heap/process/handle baseline과 변화 측정이 필요하다.

## 6. 개인정보 검사와 commit/push

1. `git status --short`, diff/untracked 목록을 확인한다. ignored 데이터 force-add 금지.
   파일 이름뿐 아니라 source/doc 안 실제 값도 검사한다.
2. 실제 사용자 경로/SSH 정보/계정/전화/이메일/key/private URL 여부를 살핀다.
   synthetic fixture·공개 URL과 실제 개인값을 구분한다. 스크린샷은 시각 검사한다.
3. 필요한 파일만 stage 후 검사:

```text
git diff --cached --check
git diff --cached --stat
gitleaks git --pre-commit --staged --redact --no-banner
```

gitleaks는 선택 설치 도구다. "no leaks"가 모든 개인정보 부재의 증명은 아니다.
발견한 값을 다시 출력하지 말고 파일/줄/범주만 보고한다.

4. 결과를 docs에 기록하고 commit. 요청 시 해당 branch만 정상 push한다.
   force/mirror/모든 refs push 금지: local worklog/snapshot에는 개인 데이터가 있을 수 있다.
5. remote/local HEAD 일치와 working tree를 확인한다. hook 실패/미실행 테스트를
   숨기지 않는다. 전역 개인 hook은 새 시스템의 필수 build dependency가 아니다.
