# 개발 이관: 현재 구현과 다음 시스템 시작점

기준일: **2026-09-19**. 새 clone의 개발자/LLM을 위한 공개 인수인계다.
이전 대화, 개인 `.handoff/`, 기존 PC 실행 파일 없이 읽을 수 있어야 한다.
개인 작업 데이터의 백업 파일이 아니며, 실제 소스가 설명보다 우선한다.

## 1. 읽는 순서

1. [AGENTS.md](../AGENTS.md): 작업 원칙과 회귀 금지 조건.
2. 이 문서: 범위, 최근 완료 내용, 검증 상태와 남은 일.
3. [DEVELOPMENT_ENVIRONMENTS.md](DEVELOPMENT_ENVIRONMENTS.md): OS별 설치/빌드/이관.
4. [ARCHITECTURE.md](ARCHITECTURE.md): 소스 지도, 이벤트와 자원 수명.
5. [TESTING.md](TESTING.md): 자동/수동 검증, 공개 전 점검.
6. 변경 영역의 전문 문서 및 `codex.md` 해당 날짜 기록.

## 2. 제품 전체 범위

| 영역 | 현재 구현 | 경계 / 주의 |
| --- | --- | --- |
| 앱 | Simple Vibe IDE와 Simple Vibe Terminal, Tauri v2 + TypeScript/Vite + Rust | 공통 런타임, 별도 제품/스토리지. 최종 데스크톱 검증 대상은 Windows |
| 연결 | Windows Local, WSL 배포판, SSH profile 및 파일 작업 | Linux/SSH 작업 대상 지원이 Linux/macOS 앱 지원 완료를 뜻하지 않음 |
| Workspace | 탭, live 세션 유지, UI/context snapshot, 레이아웃/메모리 절약 | snapshot은 process checkpoint가 아님. 앱 종료 뒤 ordinary shell은 새로 시작 |
| Terminal | PTY, 탭/분할, Type pad, 히스토리, DOM/GL renderer, LLM 버튼 | 긴 출력 중 입력 지연 최소화가 우선. 별도 background PTY host 없음 |
| LLM | Codex/Claude/Grok/Antigravity launcher, tmux 관리, 상태/알림 bridge | CLI 설치/인증은 별도. Windows tmux 자동 생성은 Codex/Claude 경로 |
| Explorer/Editor | 디렉터리 탐색/감시, 생성/열기/저장, CodeMirror, env masking | scope가 바뀐 비동기 결과를 현재 UI에 적용 금지 |
| Browser/Ports | native WebView preview, capture-safe 대안, console, forwarding | Ports는 Web 패널과 독립. forwarding 자체는 브라우저를 열지 않음 |
| 보조 도구 | Image/clipboard attachment, Notes, Snippets, Calculator, export | 프로젝트 임시 파일과 사용자 저장소는 코드와 분리 |
| UI | 이동/크기/스냅, Glass/theme/background, capture protection, 상태 카드 | GL context·layout·숨김 위젯 비용 관리 필요 |
| 배포 | Windows staged 빌드, timestamped exe, 실행 경로 resolver | 기존 앱을 죽이지 않고 다음 빌드 가능. 현재 CPU 전용 최적화 |

기능 사용법은 [USER_GUIDE.ko.md](USER_GUIDE.ko.md), [README](../README.md)를
참고한다. 과거 안내와 충돌하면 아래 최신 lifecycle과 소스를 우선한다.

## 3. 이관에 포함된 주요 개선

### Terminal / 입력 / 반응성

- backend 출력 credit/renderer acknowledgement와 chunked xterm drain으로
  출력 폭주 시 무제한 IPC 누적을 제한한다. 표시 줄 수 제한만으로 해결되지 않던
  히스토리 파싱·직렬화·숨김 위젯 처리를 bounded/yielding 경로로 바꿨다.
- Hangul/IME composition, blur/refocus, 다음 키 입력과 중복/누락 commit 경계를
  fixture로 보호한다. Type pad는 여전히 대안이며 모든 IME 조합의 완치 주장은 아니다.
- 입력 큐 복사, UTF-8 디코드, remote stdin retry 복사 등 저수준 비용을 줄였다.
- DSR 원문은 Rust에서 필터링하고 앞선 출력을 flush한다. frontend가 xterm drain
  뒤 좌표를 읽어 CPR로 돌려준다. 입력 sequencer와 순서를 함께 보존해야 한다.
- background renderer watchdog의 잘못된 destructive recovery를 억제한다.
  모든 렉/종료/메모리 누수 가능성을 제거했다고 보장하지 않는다.

### Editor / Explorer / 저장

- workspace 복귀 시 editor 위치 보존, 파일을 열 때 editor를 앞으로 올림,
  Explorer 빈 영역 클릭으로 current directory를 선택해 root에 파일/폴더 생성.
- 목록/읽기 작업 dedup, scope/generation fence, 안정된 폭 계산을 유지한다.
- editor dirty 표시는 매 키 입력마다 전체 재구성하지 않으며 현재 immutable
  CodeMirror 문서의 문자열 변환을 재사용한다.
- Notes autosave를 tab별 직렬화/coalesce해 늦은 과거 저장이 최신 내용을 덮지 않게
  했다. 용량 정리의 반복 JSON 직렬화와 export 진행 이벤트 빈도를 줄였다.

### Browser / Ports

- native show/bounds/navigation 중복 호출과 iframe 불필요 재탐색을 줄였다.
- console payload 크기/깊이/배치 제한, idle callback 중복 방지, 과거 로그를
  읽는 동안 자동 스크롤 방지 및 숨겨진 queue 처리를 개선했다.
- proxy 생성/probe를 scope별로 합치고 늦게 생성된 이전 workspace 자원을 정리한다.
- `src-tauri/src/preview_body.rs`에서 선택적 HTML bridge 주입을 bounded capture로
  분리했다. 큰/느린/비지원 body는 원문 relay가 우선이며 bridge가 없을 수 있다.
- IDE 상단 Ports에서 등록/Forward/Stop/Retry/Enable/Disable/Forget을 관리한다.
  workspace별 활성 규칙을 저장하고 재시작 후 해당 workspace 진입 시 복원한다.
- split/background terminal 출력의 신뢰 가능한 local URL 감지를 개선했다.
  출력 힌트가 전혀 없는 서버까지 자동 발견하는 listener 스캐너는 아니다.
- Stop은 복원 비활성화, Forget은 규칙 제거다. 앱은 소유한 tunnel/proxy를 정리하지만
  외부 dev server 또는 WSL 자체 localhost 노출을 종료하지 않는다.

### Windows shell / tmux / 빌드

- `D:folder`는 드라이브 상대 경로다. backend는 거절하며 frontend가 존재 확인과
  사용자 승인 후 `D:\folder` 보정을 제안한다. `#` 자체는 금지 문자가 아니다.
- 새 Windows Codex/Claude tmux 세션은 PS5.1 프로필을 읽고 `codex`/`claude`
  이름으로 호출해 사용자 함수를 유지한다. `llm-usage` 호출을 하드코딩하지 않는다.
- 새 세션에만 `default-shell`/빈 `default-command`를 설정한다. 기존 세션 재사용은
  설정 변경 전에 반환한다. `-f NUL`, 전역 설정 변경, 실제 작업 종료를 추가하지 않았다.
- `set-option` exact target은 `=session:` 형태, 빈 문자열 전달은
  `set-option -F ... '#{l:}'`로 PowerShell 5.1 인자 유실을 피한다.
- Windows OpenSSH agent 미사용 안내의 반복 출력만 제거했다. optional agent와
  IDE askpass의 인증 동작은 유지한다.
- Windows/Linux node_modules 혼용 방지, staging의 새 Rust 모듈 포함,
  Unicode/경로 충돌 검증, immutable exe와 manifest 게시를 구현했다.
  빌드 중 기존 실행 파일을 지우거나 사용자 앱을 강제 종료하지 않는다.

상세: [PERFORMANCE_AUDIT.md](PERFORMANCE_AUDIT.md),
[BROWSER_PERFORMANCE.md](BROWSER_PERFORMANCE.md). 과거 문서 숫자는 당시 결과다.

## 4. 검증 장부: 날짜와 범위 구분

| 검증 | 최근 확인 | 결과 / 한계 |
| --- | --- | --- |
| TypeScript + 13 Node 회귀 스크립트 | 2026-09-19 | 통과. helper/fixture이며 실제 WebView UI 테스트 아님 |
| IDE/Terminal frontend production build | 2026-09-19 | 둘 다 통과. Vite 큰 chunk advisory 남음 |
| Rust fmt + lib tests | 2026-09-19 | 73 통과, opt-in exporter 1 ignored |
| Windows MSVC-target cargo check (Linux host) | 2026-09-19 | 통과. GNU compiler target warning 존재; native linking 아님 |
| Windows VS staged `-NoLaunch` | 2026-09-09 | 두 native release/metadata/artifact/routing 통과, 당시 npm audit 0 |
| native Windows tmux isolated smoke | 2026-09-09 | PS5.1/profile 함수, new-session/window/split, 기존 설정 보존 통과 |
| 새 시스템 GUI / 실사용 CLI / SSH 서버 | 대상 시스템에서 필요 | 기존 결과를 이식하지 말고 수동 검증 수행 |

tmux 테스트는 실제 LLM 대신 무해한 함수를 호출했다. 당시 production named server가
없어 live production 설정 관측 결과는 없다. `.ps1` tmux wrapper는 native `tmux.exe`와
별도 검증이 필요하다. dependency audit 결과도 날짜에 종속된다.

## 5. 다른 시스템으로 옮길 것 / 옮기지 않을 것

**Git으로 이동:** source, lockfiles, public docs, regression scripts, Tauri config,
icons/assets. 최종 commit을 push한 후 대상에서 같은 commit인지 확인한다.

**대상에서 다시 설치:** Node/npm, Rust/MSVC/SDK, WebView2, Git for Windows,
필요한 WSL distro/SSH client/LLM CLI/tmux. `node_modules`, `target`, staged checkout,
기존 PC CPU 전용 exe를 복사해 환경을 재현하지 않는다.

**필요하면 비공개 경로로 별도 이전:** SSH keys/config/known_hosts, LLM 인증,
PowerShell profiles/functions, `.tmux.conf`, 사용자 설정/Notes/Snippets/workspace data.
자동 repo 백업 대상이 아니다. 키/토큰을 Git에 넣거나 예제로 출력하지 않는다.
`llm-usage`와 커스텀 Windows tmux는 외부 설치이며 이 repo가 설치/구현해 주지 않는다.

**프로세스 이전 불가:** 실행 중 PTY, tmux server 메모리, port-forward PID,
SSH askpass 메모리 캐시. 저장된 port 규칙만 재연결을 시도한다. 서버 프로그램은
필요하면 사용자가 다시 시작한다.

앱 설정/레이아웃 상당수는 WebView `localStorage`, Snippets는 Tauri
`app_config_dir()/snippets.v1.json`, 프로젝트 Notes/attachments는 `.vibe-ide-temp/`에
있다. [architecture](ARCHITECTURE.md)의 storage 설명을 확인한다. 모든 데이터를
통합한 portable export/import 도구는 없다. 개인 데이터 보존은 앱 정상 종료 후
별도 비공개 백업하고 새 시스템의 실제 저장 위치/경로를 확인한다. 기존 absolute
roots/SSH aliases/distro 이름은 대상에서 다시 열어 검증한다.
미저장 editor 본문과 정확한 scroll/cursor는 컴퓨터 간 workspace snapshot 복원
대상이라고 보장하지 않는다. 이관 전 파일 저장과 개인 데이터 백업을 먼저 확인한다.

## 6. 다음 개발자가 먼저 할 일

1. clean clone과 lockfile 기반 설치, [OS별 기본 검사](DEVELOPMENT_ENVIRONMENTS.md).
2. 13 Node regressions, Rust tests, 두 flavor 빌드로 baseline 확보.
3. Windows `-NoLaunch` gate, 이후 사용자 동의하에 새 앱 GUI smoke.
4. Windows/WSL/SSH cwd, 긴 출력 중 한글 입력, workspace 전환, Ports 복원,
   Browser 숨김/복귀, 기존 앱을 켠 채 재빌드를 우선 검증한다.
5. 별도 tmux test server에서 프로필 함수 확인. production 강제 kill 금지.

남은 항목은 **구현 완료가 아니라 backlog**다: Windows heap/CPU/GPU 장시간 측정,
inactive iframe 명시적 suspension 정책, proxy protocol-aware streaming 확대,
listener polling 제거 설계, auto-forward 실패의 scope별 cooldown, bundle splitting.
측정/fixture 없는 일괄 리팩터링이나 경고 한도를 올려 숨기는 방식은 피한다.

## 7. 문서 유지 원칙

- 이 문서와 architecture/environment/testing은 **현재형 기준 문서**다.
- `codex.md`와 날짜 있는 분석 문서는 **역사 기록**이다. 당시 interop 실패,
  테스트 개수, UI 방식이 현재도 같다고 간주하지 않는다.
- `.handoff/`와 AI worklog hook은 로컬 편의 기능이다. 다른 시스템에 없어도
  개발/빌드가 가능해야 하며 Telegram 설정/개인 snapshot ref를 공개 push하지 않는다.
