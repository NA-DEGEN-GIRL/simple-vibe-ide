# 개발 환경과 다른 시스템으로의 이전

이 문서는 **새 PC의 개발자 또는 LLM이 기존 개발 PC에 의존하지 않고 작업을 재개**하기 위한
환경 안내서다. 현재 저장소는 Windows-first Tauri v2 앱이며, Linux에서 검사가 통과했다고
Windows 제품이 동작하는 것으로 간주하면 안 된다. 상세 GUI 검증은
[Windows runtime smoke](WINDOWS_RUNTIME_SMOKE.md)를 따른다.

명령은 별도 표시가 없으면 저장소 루트에서 실행한다. `[USER]`, `[DISTRO]`, `[REPO_URL]`은
실제 값으로 바꾸는 자리 표시자다. `D:\Projects` / `D:\build-cache`는 예시이므로 존재하는
Windows 로컬 드라이브로 바꾼다. 실제 사용자명·SSH 주소·토큰은 공개 문서에 남기지 않는다.

## 1. 먼저 선택할 개발 방식

| 환경 | 용도 | 지원/검증 범위 |
| --- | --- | --- |
| Windows 10/11 x64 + 로컬 NTFS checkout | Windows HMR, MSVC 빌드, 실제 제품 디버깅 | 주 개발·제품 환경 |
| WSL/Linux checkout + Windows NTFS staging | Linux 도구로 소스 수정, Windows에서 최종 빌드 | 제공 스크립트로 지원. 소스/의존성/출력 분리 필수 |
| Linux/WSL 단독 | TypeScript, Node 회귀 검사, Rust 호스트 검사/테스트 | Windows GUI·ConPTY·WebView2·MSVC 링크 검증을 대신하지 못함 |
| macOS | 소스 검토, 조건이 맞는 프런트엔드 검사 | 이 저장소의 macOS 제품/패키징/실행 검증 결과 없음 |

새 시스템에서 가장 단순한 Windows 개발 경로는 **Windows-local clone + Developer PowerShell**이다.
WSL에서 편집을 계속하려면 staged release를 쓰되, Windows HMR은 별도 Windows checkout/worktree에서
실행한다. stage는 다음 빌드 때 지워지는 임시 복사본이지 편집용 원본이 아니다.

## 2. 새 시스템으로 가져올 것 / 가져오지 않을 것

### Git으로 가져올 것

- 현재 branch/commit, `AGENTS.md`, `codex.md`, `docs/`, `src/`, `src-tauri/`, `scripts/`.
- `package-lock.json`, `src-tauri/Cargo.lock`, `.cargo/config.toml`, 두 Tauri/Vite 설정.
- 개발 시작 전 `git status --short`, `git log -5 --oneline`으로 실제 상태를 확인한다.
- `.handoff/`는 local-only다. 새 clone에 없더라도 공개 문서만으로 재개할 수 있어야 한다.

```bash
git clone [REPO_URL] simple-vibe-ide
cd simple-vibe-ide
git status --short
git log -5 --oneline
```

### 각 OS에서 새로 준비할 것

- Node/npm, Rust/rustup, Windows MSVC/SDK/WebView2 또는 Linux 네이티브 라이브러리.
- **해당 OS 전용** `node_modules`, Cargo target, stage, 생성된 `dist*`.
- Windows/WSL/SSH 각각의 CLI 설치, PATH, shell profile, tmux 설치와 사용자 설정.
- SSH 키·config·known_hosts와 LLM 인증은 별도 안전한 경로로 이전하거나 재인증한다.
  Git 저장소나 문서에 복사하지 않는다. SSH 별칭이 새 시스템에서 실제로 연결되는지 확인한다.

### 복사가 곧 이전 완료를 의미하지 않는 것

- Workspace/레이아웃은 WebView localStorage에 저장되므로 clone만으로 옮겨지지 않는다.
  앱의 저장 기능도 그 자체가 타 PC 자동 동기화라는 뜻은 아니다. 수동 백업에는 파일 경로·URL·
  노트 등 민감 데이터가 포함될 수 있으므로 공개 repo 밖에서 처리하고, 새 PC 경로로 다시 연다.
- Windows IDE/Terminal은 서로 다른 Tauri identifier를 사용한다. IDE는
  `dev.nastream.simple-vibe-ide`, Terminal은 `dev.nastream.simple-vibe-terminal`이다.
  identifier 변경은 별도 데이터 영역으로 이어질 수 있으므로 이전 편의를 위해 임의 변경하지 않는다.
- 실행 중 일반 PTY는 이전/재시작되지 않는다. 앱 종료 시 in-process shell은 종료된다.
  별도로 분리된 tmux session은 같은 대상 머신의 tmux server가 살아 있을 때만 재접속할 수 있다.
  다른 PC로 소스나 EXE를 복사한다고 tmux 프로세스가 옮겨지지 않는다.
- 포트 전달 규칙 복원은 서버 프로세스 재시작과 다르다. 새 PC에는 listener와 SSH 연결을 별도로 준비한다.
- 이 저장소 밖에서 만든 개인 `.cmd` 빌드 wrapper나 worklog hook은 clone에 포함되지 않는다.
  저장소의 `scripts/windows-*-runtime-smoke.ps1`이 재현 가능한 진입점이다.

## 3. 도구 버전과 고정 범위

| 항목 | 저장소 기준 / 주의 |
| --- | --- |
| Node.js | README는 22 이상. 현재 lockfile의 Vite engine은 `^20.19.0 \|\| >=22.12.0`이므로 새 환경은 **22.12 이상인 22 계열 또는 호환 상위 버전** 사용 |
| npm | `package-lock.json`을 보존하고 clean clone에서는 `npm ci` 사용. npm 자체 버전 pin은 없음 |
| Rust | `Cargo.toml`의 `rust-version = "1.77.2"`는 crate 선언값이지 현재 lockfile 전체가 그 버전에서 검증됐다는 보증은 아님. `rust-toolchain.toml` pin 없음; 실제 선택된 버전 기록 |
| Windows target | `x86_64-pc-windows-msvc`; GNU target과 혼동하지 않음 |
| Windows shell | 앱의 대화형 로컬/새 Windows tmux LLM shell은 **Windows PowerShell 5.1**. PowerShell 7 설치만으로 대체되는 설계가 아님 |
| 프런트엔드 | TypeScript/Vite, Tauri v2, CodeMirror 6, xterm beta 패키지 버전은 manifest/lockfile 참조 |
| tmux | Windows 기본 제공 도구 아님. 표준 명령 계약을 만족하는 별도 구현 필요. native `3.6a-win32`에서 격리 smoke 기록 있음; 모든 shim에 대한 보증 아님 |

새 환경의 첫 결과에는 `node --version`, `npm --version`, `rustc --version`, `cargo --version`과
host/target을 기록한다. dependency 변경이 목적이 아니면 `npm update`, `cargo update`,
`npm audit fix --force`로 lockfile을 먼저 바꾸지 않는다.

## 4. Windows-local 환경: 권장 기본 경로

### 4.1 필수 구성

1. Windows x64용 Git for Windows와 Node/npm을 설치한다.
2. Rust MSVC toolchain을 준비한다.
3. Visual Studio 2022 또는 Build Tools의 **Desktop development with C++**, x64 MSVC,
   Windows SDK를 설치하고 **Developer PowerShell / x64 Native Tools 환경**에서 빌드한다.
4. Tauri Windows WebView용 **WebView2 Runtime**을 준비한다. Edge 설치만을 실제 WebView2
   런타임 검증으로 취급하지 않는다.
5. SSH workspace를 쓸 경우 Windows OpenSSH client, WSL을 쓸 경우 WSL 배포판을 준비한다.

Developer PowerShell에서:

```powershell
Set-Location 'D:\Projects\simple-vibe-ide'
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
Get-Command git.exe, node.exe, npm.cmd, cargo.exe, rustc.exe, link.exe
rustup show
rustup target add x86_64-pc-windows-msvc
node --version
npm.cmd --version
rustc --version
cargo --version
```

`link.exe`가 없다면 먼저 Visual Studio developer environment를 연다. 위 `rustup target add`는
Windows SDK나 linker를 설치하는 명령이 아니다. Git for Windows와 Windows Node가 선택됐는지도
확인한다. WSL의 ELF 실행 파일을 Windows PATH에 가져와 빌드를 섞지 않는다.

### 4.2 프런트엔드 / HMR

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run check:regressions
npm.cmd run build
npm.cmd run build:terminal
npm.cmd run tauri:dev
```

Terminal flavor 개발 실행은 마지막 명령 대신 `npm.cmd run tauri:terminal:dev`다.
`npm run dev`만 실행하면 Vite 프런트엔드일 뿐 Tauri Rust IPC/PTY runtime은 뜨지 않는다.
앱 실행 검증에는 `tauri:dev` 또는 native executable이 필요하다.

### 4.3 Rust 검사와 두 native release 빌드

```powershell
$env:CARGO_TARGET_DIR = 'D:\build-cache\simple-vibe-ide-target'
$env:CARGO_INCREMENTAL = '0'
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows-runtime-smoke.ps1 -SkipNpmInstall -NoLaunch
```

- `-SkipNpmInstall`은 **Windows에서 설치한 완전한 `node_modules`가 있을 때만** 사용한다.
  최초 설치까지 맡기려면 빼면 된다. 스크립트는 `npm ci --no-audit --no-fund` 후 별도 audit을 실행한다.
- `-NoLaunch`는 IDE 자동 실행을 막는다. Terminal은 기본적으로 빌드/경로 보고만 하며 별도 실행한다.
- execution-policy bypass는 해당 helper process에만 적용된다. 시스템 전체 정책을 바꾸지 않는다.
- smoke는 artifact/routing fixtures, npm audit, TS, 두 frontend, Rust check, 두 native release와
  Windows 제품 metadata를 검사한다. **Node 회귀 스크립트 전체와 Rust unit test/fmt는 별도 명령**이다.
- `npm audit --audit-level=low`는 low 이상 취약점에서도 실패한다. 과거 통과 기록은 현재 audit 결과가 아니다.

## 5. WSL 소스 + Windows-local NTFS staged 빌드

### 5.1 절대 지켜야 할 분리

| 위치 | 보관할 것 | 실행 도구 |
| --- | --- | --- |
| WSL `/home/[USER]/simple-vibe-ide` | 원본 소스, Linux용 node_modules | WSL Node/npm/Rust |
| Windows `D:\build-cache\simple-vibe-ide-win-src` | 매번 다시 만드는 source stage, Windows용 node_modules | Windows Node/npm |
| Windows `D:\build-cache\simple-vibe-ide-target` | 재사용 Cargo cache, timestamped 실행본 | Windows Rust/MSVC |

**같은 `node_modules`에서 WSL npm과 Windows npm을 번갈아 실행하지 않는다.** Linux `.bin` symlink,
Windows `.cmd` shim, 플랫폼별 esbuild/Rollup/Tauri 패키지가 섞이면 `EISDIR`, `EPERM` 또는 잘못된
실행 파일 선택이 발생한다. stage와 Cargo target은 UNC/WSL/network mapped drive가 아닌 로컬 NTFS를 쓴다.

### 5.2 복사해서 쓸 명령

**Windows Visual Studio Developer PowerShell**에서 실행한다. `[DISTRO]`와 `[USER]`를 치환한다.

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
Get-Command git.exe, node.exe, cargo.exe, link.exe
cmd /d /s /c 'pushd "\\wsl.localhost\[DISTRO]\home\[USER]\simple-vibe-ide" && powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows-staged-runtime-smoke.ps1 -StageRoot "D:\build-cache\simple-vibe-ide-win-src" -CargoTargetDir "D:\build-cache\simple-vibe-ide-target" -NoLaunch'
```

`cmd pushd`는 소스 UNC를 임시 드라이브로 매핑한다. 그것이 stage까지 WSL에 두라는 뜻은 아니다.
옵션을 생략하면 stage와 target은 각각 `%TEMP%\simple-vibe-ide-win-src`,
`%TEMP%\simple-vibe-ide-target`이다. TEMP 용량이 부족하면 위처럼 넉넉한 Windows-local 경로를 지정한다.

### 5.3 stage가 하는 일 / 안 하는 일

1. Git for Windows로 현재 **working-tree 파일 목록**을 읽는다. commit된 내용만 export하는 게 아니다.
2. tracked 파일과 allowlist의 nonignored 새 코드/빌드 script를 기본 포함한다. 신규 Rust module이
   아직 untracked라도 소스 allowlist에 속하면 포함된다. Git index는 변경하지 않는다.
3. Windows filename/case 충돌, symlink, 위험한 경로 등을 이전 stage 삭제 전에 검사한다.
   파일 이름 검사일 뿐 **내용 안의 비밀을 보장하는 security scanner는 아니다**.
4. script 소유 marker가 확인된 stage만 삭제/재생성하고, 새 Windows dependency tree를 설치한다.
5. 공용 Windows-local Cargo cache를 재사용하고 두 제품 smoke를 실행한다.

새 asset/docs 등 allowlist 밖의 untracked 파일이 빌드에 꼭 필요하면 내용을 검토한 뒤
`-IncludeUntracked`를 명시한다. 개인 파일을 무시 목록에 넣지 않은 채 넓은 복사를 켜지 않는다.
stage에서 직접 수정한 파일은 다음 빌드에 사라지므로 항상 원본 checkout으로 수정한다.
stage 안을 작업 폴더로 쓰는 shell/editor가 파일을 잡고 있으면 삭제에 실패할 수 있다.
기존 작업을 강제 종료하지 말고 핸들을 점유한 경로와 별도 stage 사용 가능성을 확인한다.

### 5.4 WSL에서 Windows 실행이 실패할 때

```bash
command -v cmd.exe || true
test -e /mnt/c/Windows/System32/cmd.exe && echo 'Windows cmd exists'
test -r /proc/sys/fs/binfmt_misc/WSLInterop && cat /proc/sys/fs/binfmt_misc/WSLInterop
```

`command not found`는 PATH 문제, `Exec format error`는 interop/binfmt 문제일 수 있다.
파일이 존재한다고 실행 가능하다는 뜻은 아니다. Windows developer shell에서 위 stage 명령을
실행하면 WSL-side `.exe` 호출에 의존하지 않고 빌드를 진행할 수 있다.
WSL 재시작은 현재 작업을 종료할 수 있으므로 사용자 동의 없이 수행하지 않는다.

## 6. Linux / WSL 단독 검증

### 6.1 JS/TS 검사

Linux filesystem의 checkout에서 Linux Node/npm으로:

```bash
npm ci
npm run check
npm run check:regressions
npm run build
npm run build:terminal
```

이 경로는 Windows나 GUI가 없어도 많은 helper 회귀를 검증한다. 현재 regression 명령에는
terminal output/IME, workspace async/ports, Explorer/editor, browser lifecycle/proxy/storage,
Windows cwd 및 stage manifest 관련 Node 스크립트가 묶여 있다. 대체로 분리한 helper/소스 계약
검사이므로 OS 실제 입력 이벤트·한글 조합·네이티브 WebView 동작의 증명은 아니다.

### 6.2 Rust host / Windows-target 검사

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
rustup target add x86_64-pc-windows-msvc
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

- Linux host Tauri 의존성은 GTK3, WebKitGTK 4.1, JavaScriptCoreGTK, libsoup3, appindicator 계열
  라이브러리와 개발 헤더, compiler/linker/pkg-config를 요구할 수 있다. 실제 Cargo 오류의
  missing `.pc`/library를 기준으로 해당 배포판 패키지를 설치한다. distro마다 이름/버전이 달라
  이 저장소에 통일된 apt bootstrap은 없다.
- 호스트 테스트도 Tauri native 라이브러리와 링크하므로 Node 검사처럼 dependency-free가 아니다.
- Linux에서 MSVC target `cargo check` 성공은 **타입/조건부 코드 검사**다. Windows SDK/MSVC 링크,
  resources, WebView2, ConPTY, Windows npm 패키지, PowerShell 실행 검증이 아니다.
- `target-cpu=native`는 check를 실행하는 CPU에 영향을 받으므로 cross-host 검사 결과나 생성물을
  다른 PC용 배포 binary로 사용하지 않는다.
- Linux/WSLg GUI를 열 수 있더라도 그것은 Windows 제품 smoke의 대체가 아니다.

선택 SSH fixture는 `bash scripts/ssh-agent-fixture-smoke.sh`다. `ssh`, `ssh-agent`, `ssh-add`,
`ssh-keygen`, `sshd`, Python 3가 필요하다. 임시 loopback sshd/키/agent로 검증하며 실제 원격 계정
인증이나 Windows askpass GUI를 검사하지 않는다. fixture의 임시 키와 로그도 repo에 추가하지 않는다.

## 7. macOS 경계

- macOS에서 제품이 지원/검증됐다고 명시할 근거는 현재 없다. native preview, PTY,
  capture protection, drag-out, 패키징 등의 동작을 Windows 결과로 추론하지 않는다.
- 호환 Node를 갖춘 별도 checkout에서 6.1의 프런트엔드 명령을 시도할 수 있다.
- native Tauri 빌드는 별도의 Apple toolchain/플랫폼 의존성 검토, 서명/권한, runtime 테스트가
  필요한 **신규 검증 작업**이다. 이 문서에는 검증되지 않은 macOS release 절차를 넣지 않는다.
- Windows build scripts는 macOS build entry point가 아니다. 제품 변경이 Windows에 영향을
  준다면 Windows 빌드 머신의 검증 결과를 확보한다.

## 8. 결과물·포트·환경 변수

| 항목 | 현재 위치/값 |
| --- | --- |
| IDE Vite | `http://127.0.0.1:15320`, `vite.config.ts` + `src-tauri/tauri.conf.json` |
| Terminal Vite | `http://127.0.0.1:15321`, `vite.terminal.config.ts` + `src-tauri/tauri.terminal.conf.json` |
| frontend output | `dist/`, `dist-terminal/` (생성물, commit 금지) |
| Cargo output | `$CARGO_TARGET_DIR`가 있으면 그 아래; 직접 기본 Cargo 빌드는 `src-tauri/target/` |
| smoke 기본 target | Windows `%TEMP%\simple-vibe-ide-target` |
| runtime snapshot | `<CargoTargetDir>\simple-vibe-build-sources\<binary>-<UTC 날짜/시간/ms>-<GUID>.exe` |
| 제품 이름 | `Simple Vibe IDE`, `Simple Vibe Terminal`; smoke가 각 EXE metadata 일치를 검사 |
| `CARGO_INCREMENTAL` | 제공 Windows release helper는 기본 `0`; 공유 release cache와 incremental을 혼동하지 않음 |
| `SVIDE_SOURCEMAP=1` | Vite sourcemap opt-in. 기본 off; 소스가 담긴 산출물을 공개 전 검토 |
| `SVIDE_BUILD_ID` | Vite에 주입할 build identifier override. 없으면 빌드 시각 기반 |

Vite는 loopback + strictPort다. 포트 충돌 시 자동으로 다른 포트로 바꾸지 않는다.
변경해야 한다면 해당 Vite port와 Tauri `devUrl`을 **같이** 변경한다.
dev server의 포트와 workspace 애플리케이션의 포트 전달 규칙은 서로 별개다.

### 실행 중 재빌드

- release smoke/`build-and-copy.cmd`/`run-built.cmd`/`run-built.vbs`는 Cargo의 mutable output과
  분리된 날짜·시간·GUID 실행본을 사용한다. 다른 snapshot으로 실행 중인 앱을 중지할 필요가 없다.
- `run-built.cmd`는 진단 출력용, `run-built.vbs`는 console을 추가로 보이지 않는 launcher다.
  새 시스템에서 target을 명시하면 오래된 fallback cache 대신 의도한 빌드를 찾기 쉽다.
- Cargo의 `release\simple-vibe-ide.exe` 또는 Terminal raw output을 직접 실행한 legacy instance는
  linker 출력을 잠글 수 있다. 해당 instance만 한 번 닫고 다음부터 snapshot launcher를 쓴다.
- IDE snapshot은 Terminal 빌드 전에 보존된다. Terminal flavor 빌드가 shared Cargo 출력 이름을
  바꾸므로 나중에 raw EXE 하나만 복사하면 제품을 혼동할 수 있다.
- 이전 snapshots는 자동 삭제하지 않는다. 앱과 그 EXE를 사용하는 SSH askpass 등이 모두 종료된
  뒤 불필요한 복사본만 수동 정리한다. 재빌드를 이유로 앱/세션을 강제 종료하지 않는다.

### CPU 최적화와 배포

`.cargo/config.toml`의 Windows target은 `-C target-cpu=native`다. release profile도
`opt-level=3`, thin LTO, `codegen-units=1`, `panic=abort`, symbol strip을 쓴다.
**기존 PC의 EXE를 새 PC용 portable release로 간주하지 말고 새 PC에서 다시 빌드한다.**
배포용 baseline CPU 정책을 정하고 native 설정을 제거/override한 별도 검증 빌드가 필요하다.
`npm run tauri -- build`의 installer 생성만으로 CPU portability가 확보되지 않는다.
bundle output은 사용한 Cargo target의 `release/bundle/` 아래이며 smoke는 `--no-bundle`이라
installer를 생성/검증하지 않는다.

## 9. 새 환경의 shell / SSH / tmux 확인

- Windows 프로젝트는 `D:\Projects\Example`처럼 drive 뒤 slash가 있는 절대 경로를 사용한다.
  `D:Projects\Example`은 다른 의미다. 기존 저장된 잘못된 root는 검증/확인 후 복구하며 임의로
  다른 폴더에 fallback하거나 파일을 이동하지 않는다. `#` 자체가 금지 문자는 아니다.
- WSL 배포판 이름, Windows SSH config의 literal Host alias, 원격 root가 이전 PC와 다를 수 있다.
  프로젝트를 실제 새 profile/root로 연 뒤 `+ Shell`의 cwd를 확인한다.
- LLM CLI 설치와 인증은 **실행 대상별**이다. Windows PATH에 있다고 SSH나 WSL에서도 실행되는 게 아니다.
- Windows tmux 검색은 깨끗한 PowerShell controller에서도 찾아지는 executable/`.cmd`/`.ps1`을
  요구한다. profile-only `tmux` 함수/alias와, profile에서 제공하는 `codex`/`claude` 함수는 별개다.
- Windows IDE LLM tmux는 `-L simple-vibe-ide` namespace를 사용한다. 새 LLM 세션/대화형 pane은
  PS5.1 프로필을 읽으며 `codex`/`claude`를 이름으로 호출한다. 사용자의 함수 routing을 살리기 위해
  임의로 `codex.exe`나 특정 계정 wrapper로 바꾸지 않는다.
- user `.tmux.conf`/전역 default-shell/기존 session을 바꾸지 않는다. 새 세션만 PS5.1 default-shell과
  빈 default-command를 지정한다. attach/helper의 `-NoProfile`을 발견했다고 일괄 제거하지 않는다.
- Windows OpenSSH agent service는 선택 사항이다. 없을 때 IDE askpass가 encrypted-key 요청을
  처리하며, 반복적인 fallback 배너는 제거돼 있다. service 자동 시작이나 계정 키 변경은 하지 않는다.
- 격리 tmux profile smoke는 [별도 절차](WINDOWS_RUNTIME_SMOKE.md#isolated-windows-tmux-profile-smoke-opt-in)를
  따른다. PS5.1 profile의 Codex 함수가 필요하며 **실제 LLM 대신 harmless 함수**, UUID test server만
  사용한다. 프로덕션 `kill-server`/`kill-session`으로 검증하지 않는다.

## 10. 흔한 실패와 다음 확인

| 증상 | 우선 확인 / 안전한 대응 |
| --- | --- |
| npm `.bin/nanoid` EISDIR, vite EPERM | Windows/WSL dependency tree 혼용 여부. 원본 dependency를 Windows로 덮어쓰지 말고 새 Windows stage 사용 |
| `preview_body` 등 Rust module 누락 | 원본 파일 존재와 manifest 포함 여부. 현재 helper는 allowlisted 새 `.rs`도 포함; 오래된 개인 wrapper/export 방식을 점검 |
| stage 삭제 거부 | ownership marker, 잘못 지정한 source/stage, symlink/junction, 열린 stage cwd 확인. marker 검사를 제거하지 않음 |
| `link.exe`/SDK/resource 오류 | Windows developer environment와 MSVC target 확인. Linux check 성공으로 무시하지 않음 |
| raw release EXE access denied | raw Cargo EXE를 직접 실행 중인지 확인. snapshot은 유지, 해당 legacy instance만 사용자와 협의 |
| 새로운 빌드인데 옛 UI가 뜸 | 실행한 snapshot 경로/시각, `CARGO_TARGET_DIR`, IDE/Terminal metadata와 frontend build ID 확인 |
| Vite `EACCES`/port in use | loopback 15320/15321 점유 및 Windows 예약 범위 확인. Vite/Tauri URL을 함께 수정 |
| Vite large-chunk advisory | 빌드 실패와 구분. 경고 숨기기 위해 제한값만 올리지 말고 별도 bundle 분석 필요 |
| `npm audit` 실패 | 현재 advisory/lockfile을 확인하고 호환성 검토 후 패치. `--force`로 무조건 메이저 업데이트하지 않음 |
| tmux에서 profile 함수가 안 보임 | 새 빌드로 새 session인지, PS5.1 profile 위치/로드 여부 확인. 기존 pane을 강제 재시작하지 않음 |
| 자동 포워딩이 복원되지 않음 | 해당 workspace 활성화, enabled 저장 규칙, 원격 listener, 고정 local port 충돌 확인. 서버가 출력으로 알리지 않은 임의 listener는 최초 수동 등록 필요 |

## 11. 새 시스템에서 완료 보고 기준

첫 migration 검증은 다음을 구분해서 기록한다.

1. **소스/정적 검사:** commit, dirty 상태, dependency lock 유지 여부, TS/Node/fmt 결과.
2. **Rust:** host 테스트와 Windows-target check를 분리. ignored opt-in smoke는 기본 unit test에
   포함된 것으로 세지 않는다.
3. **Windows 빌드:** 실제 MSVC link, IDE/Terminal 두 제품 metadata, snapshot 경로, audit 결과.
4. **Windows GUI:** 실제 실행했는지, Windows/WSL/SSH cwd와 인증, 한글 입력/긴 출력/복사·붙여넣기,
   workspace 전환/Ports 복원, Browser preview/cleanup을 수동 확인했는지.
5. **미검증:** macOS, 다른 Windows tmux wrapper, 실제 SSH 서버, 실제 LLM 등 하지 않은 항목.

2026-09-19 이관 문서화 시 TS 검사, 두 frontend build, 13개 Node 회귀 script, Rust fmt,
73개 Rust unit test(1개 ignored), Windows-target check가 재통과했다. Windows staged `-NoLaunch`의
두 native release/metadata와 audit, 격리 native Windows tmux profile 검증의 최근 성공 기록은
2026-09-09이며 이번 문서화에서 재실행하지 않았다. **새 PC의 성공 기록이 아니고, 전체 GUI smoke도
아니다.** 이 문서의 명령을 새 환경에서 실행한 결과로 갱신한다. 공개 보고서에는 실제 home 경로,
SSH 주소, 세션 내용, 인증 자료를 넣지 않는다.
