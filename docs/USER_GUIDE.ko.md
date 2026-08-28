# Simple Vibe IDE 사용자 가이드

이 문서는 개발자용 README가 아니라, 앱을 실제로 쓸 때 보는 짧은 사용 설명서입니다.

## 1. 이 앱으로 하는 일

Simple Vibe IDE는 Windows에서 WSL, SSH, Windows shell을 한 화면에 띄워 놓고 LLM 코딩 세션을 빠르게 돌리는 앱입니다.

보통 이렇게 씁니다.

1. 작업할 폴더를 workspace로 연다.
2. shell, Codex, Claude, Grok 같은 터미널을 띄운다.
3. Explorer / Editor / Browser / Notes / Image Preview를 필요한 만큼 배치한다.
4. 작업 중인 화면 배치를 workspace로 저장해 두고 다시 불러온다.

## 2. 처음 시작하기

1. 앱을 실행합니다.
2. 상단에서 profile을 고릅니다.
   - `Windows Local`: Windows PowerShell/CMD 계열 작업
   - `WSL`: WSL distro 안의 작업
   - `SSH`: SSH host 작업
3. 작업할 폴더를 선택하거나 입력합니다.
4. `Open / Connect`를 누릅니다.

처음에는 빈 workspace로 시작하는 것이 정상입니다. 앱이 마음대로 이전 shell을 실행하지 않습니다.

## 3. 화면 구성

주요 위젯은 자유롭게 움직이고 크기를 바꿀 수 있습니다.

- `Explorer`: 파일/폴더 보기
- `Editor`: 텍스트 파일 편집
- `Shell`: Windows/WSL/SSH 터미널
- `Browser`: 로컬 서버 미리보기
- `Image`: 붙여넣은 이미지 미리보기
- `Notes`: 작업 메모
- `Snip`: 전역 Snippets / 치트 시트
- `Calc`: 간단 계산기
- `Set`: 앱 설정

위젯은 title bar를 잡고 움직이고, 모서리/변을 잡아 크기를 바꿉니다.

## 4. Shell 사용하기

### 새 shell 열기

- `+shell`: 현재 workspace 기준 새 shell을 엽니다.
- `Win`: Windows shell을 엽니다.
- `Codex`, `Claude`, `Grok`, `Agy`: 해당 LLM CLI를 새 shell widget에서 실행합니다.

각 shell widget 안에는 여러 shell tab을 만들 수 있습니다.

### WSL이 응답하지 않을 때

- shell 시작과 Explorer의 WSL/SSH 조회는 workspace를 닫거나 요청 제한시간이 지나면 backend 작업까지 취소합니다. 화면에서만 timeout 처리한 뒤 같은 `wsl.exe`를 계속 남겨두지 않습니다.
- WSL client가 시작됐지만 30초 안에 shell prompt 준비 신호를 보내지 않으면 해당 client를 정리하고 실패 상태로 바꿉니다. 같은 workspace tab을 다시 누르면 저장된 shell 배치를 재시도할 수 있습니다.
- 한 distro가 응답하지 않을 때 짧은 WSL helper를 동시에 무제한 실행하지 않습니다. 실패 직후에는 짧은 cooldown을 두어 빠른 workspace/Explorer 전환이 helper를 계속 쌓지 않게 합니다.
- 앱은 이 정리를 위해 distro 전체를 `wsl --shutdown`하지 않으며, WSL/SSH 안의 tmux server를 직접 종료하지 않습니다.

### 복사 / 붙여넣기

- shell에서 텍스트를 선택한 상태로 `Ctrl+C`: 복사
- 선택이 없는 상태로 `Ctrl+C`: interrupt
- `Ctrl+V`: clipboard 내용을 shell에 붙여넣기

### 한글 입력이 불안정할 때: Type pad

한글이 shell이나 LLM CLI에서 씹히면 shell widget의 `Type` 버튼을 사용합니다.

1. shell widget 위쪽의 `Type` 버튼을 누릅니다.
2. 아래에 뜨는 입력칸에 일반 메모장처럼 한글을 씁니다.
3. `Paste` 버튼 또는 `Ctrl+Enter`를 누릅니다.
4. 입력칸 내용이 shell에 붙여넣어지고, 입력칸은 비워지며, 포커스가 shell로 돌아갑니다.
5. 실행하려면 사람이 직접 shell에서 `Enter`를 누릅니다.

`Type` pad는 자동 실행하지 않습니다. 실수로 긴 명령이나 LLM 프롬프트가 바로 실행되는 것을 막기 위해서입니다.

`Recall`은 최근 Type pad로 보낸 텍스트를 다시 불러옵니다. paste가 tmux/CLI 상태 때문에 기대대로 들어가지 않은 경우에도 방금 보낸 텍스트를 다시 복구할 수 있습니다. 이 히스토리는 앱 실행 중 메모리에만 보관됩니다.

### 터미널 렌더러

`Set` 패널의 `Terminal renderer` 기본값은 `Auto`입니다.

- 기본적으로 WebGL 렌더러를 사용해 resize/scroll 때 생기는 terminal 글자 깨짐을 줄입니다.
- WebGL을 사용할 수 없거나 context가 손실되면 DOM 렌더러로 자동 fallback됩니다.
- Grok Build와 일반 shell에서 직접 실행한 OpenCode는 OpenTUI의 한글/혼합 폭 부분 redraw 잔상을 줄이기 위해 자동으로 DOM 호환 경로를 사용합니다. OpenCode는 입력한 `opencode` 명령 또는 terminal title로 감지합니다.
- 문제가 생기면 `DOM compatibility`로 바꿀 수 있습니다. 설정을 저장하면 이미 열려 있는 WebGL shell도 즉시 DOM으로 전환됩니다.
- shell 제목줄의 `GL`/`DOM` 배지는 해당 shell이 실제로 사용하는 렌더러 상태를 간단히 표시합니다. `GL!`은 WebGL context 손실 후 fallback 상태입니다.

### 터미널 scrollback / History cache

`Set` 패널에서 `Terminal scrollback rows`와 `Terminal history cache`를 조절할 수 있습니다.

- `Terminal scrollback rows` 기본값은 `1000`입니다.
- `0`은 무제한이 아니라 `No scrollback / fastest`입니다. 터미널 자체의 과거 줄을 보관하지 않아 가장 가볍습니다.
- `Terminal history cache`는 앱 실행 중 메모리에만 plain text 기록을 보관합니다. 디스크나 workspace snapshot에는 저장하지 않습니다.
- shell 위쪽 `Hist` 버튼을 누르거나, 터미널 맨 위에서 더 위로 스크롤하면 읽기 전용 History overlay로 더 오래된 출력 내용을 볼 수 있습니다.
- History overlay의 내용은 ANSI 색/커서 제어를 제거한 읽기용 로그입니다. TUI 화면을 그대로 재현하는 기능은 아닙니다.
- 터미널 출력에는 secret이 섞일 수 있으므로 `Copy all cached`는 필요한 경우에만 사용하세요.

### Simple Vibe Terminal의 자동 포트 연결

별도 `Simple Vibe Terminal` 앱은 로컬 개발 서버의 정상 시작 문구와 localhost URL을 감지합니다.

- 신뢰도 높은 WSL/SSH 서버 출력은 자동으로 Windows localhost에 연결합니다. SSH는 충돌을 피하도록 사용 가능한 로컬 포트를 자동 배정할 수 있으며, Windows에서 실제 포트 도달을 확인한 뒤 active로 표시합니다.
- Windows shell의 서버는 별도 forwarding 없이 원래 localhost 포트를 그대로 표시합니다.
- 오류 로그나 애매한 문구에서 찾은 포트는 바로 연결하지 않고 `Ports`에 pending 항목으로만 표시합니다. 필요한 경우 `Forward`를 직접 누릅니다.
- 상단 `Ports` 버튼에서 `Open`, `Copy`, `Stop`, `Ignore`를 사용할 수 있습니다. `Open`은 해당 주소를 기본 Windows 브라우저로 엽니다.
- layout/root/profile을 바꾸면 해당 terminal workspace가 만든 자동 forward를 정리합니다. 시작 중 workspace를 바꾼 경우 늦게 완료된 forward도 즉시 종료합니다.

## 5. 자주 쓰는 단축키

| 단축키 | 동작 |
| --- | --- |
| `F6` | 다음 위젯으로 포커스 이동 |
| `Shift+F6` | 이전 위젯으로 포커스 이동 |
| `Ctrl+\`` | active shell과 Type pad 사이 포커스 이동 |
| `Ctrl+Enter` | Type pad 내용을 shell에 붙여넣기 |
| `Ctrl+S` | Editor 파일 저장 |
| `Ctrl+C` | shell 선택 영역 복사 또는 interrupt |
| `Ctrl+V` | shell/Explorer/Image 상황에 맞게 붙여넣기 |
| `Ctrl` + `+` / `-` | 현재 포커스된 영역의 글자 크기 또는 zoom 조절 |

`Tab` / `Shift+Tab`은 앱 위젯 이동용으로 쓰지 않습니다. 입력칸, 버튼, 브라우저 같은 일반 UI 이동과 충돌하지 않게 남겨둡니다.

## 6. Explorer와 파일 열기

- 파일을 클릭하면 Editor 또는 Image Preview로 열립니다.
- 이미지 파일은 텍스트로 열지 않고 Image Preview로 엽니다.
- 폴더는 펼치거나 `Use This Folder`로 workspace root처럼 다시 열 수 있습니다.
- Windows Explorer에서 파일/폴더를 IDE Explorer로 드롭하면 현재 폴더로 복사됩니다.
- Explorer에 포커스가 있을 때 `Ctrl+V`를 누르면 Windows Explorer에서 복사한 파일/폴더를 붙여넣습니다.

## 7. Editor와 민감한 파일

- 일반 텍스트 파일은 Editor에서 엽니다.
- 저장은 `Ctrl+S`를 사용합니다.
- 환경 변수, 토큰, 비밀번호, 키 성격의 파일은 masked editor로 열립니다.
- masked editor에서는 필요한 값만 reveal해서 확인합니다.

public repo에 올릴 수 있는 프로젝트를 다룰 때는 실제 민감한 값, private URL, 개인 경로가 화면이나 문서에 섞이지 않게 주의합니다.

## 8. 이미지 붙여넣기

스크린샷이나 이미지를 앱에 붙여넣으면 현재 workspace의 임시 attachment 폴더에 저장됩니다.

- Image Preview에서 최근 이미지들을 볼 수 있습니다.
- `Auto paste to shell`이 켜져 있으면 active shell에 `@...` 형태의 이미지 태그가 자동 입력됩니다.
- Image Preview에 포커스가 있을 때:
  - `Ctrl+C`: 현재 이미지 복사
  - `Ctrl+V`: clipboard 이미지 저장/미리보기

## 9. Browser Preview

로컬 개발 서버가 감지되면 Browser 위젯에서 열 수 있습니다.

- URL을 직접 입력할 수 있습니다.
- local port preview에 사용합니다.
- page가 이상하면 새로고침하거나 서버 포트를 다시 확인합니다.

Browser Preview는 작업 확인용입니다. 실제 배포 브라우저 테스트를 완전히 대체하지는 않습니다.

## 10. Notes

Notes는 작업 중 빠르게 적는 메모장입니다.

- workspace별로 note tab을 만들 수 있습니다.
- 내용은 자동 저장됩니다.
- Pin을 켜면 다른 위젯 위에 고정됩니다.
- 테마와 투명도를 조절할 수 있습니다.

LLM에게 시킬 일, 다음에 볼 파일, 테스트 결과를 적어두면 편합니다.

## 11. Snippets

Snippets는 workspace와 무관하게 앱 전체에서 쓰는 전역 치트 시트입니다.

- `Snip` 버튼으로 열고 닫습니다.
- `+`로 분야별 탭을 만들 수 있습니다.
- 각 항목은 복사할 내용과 선택 설명으로 구성됩니다.
- `Copy`는 내용만 클립보드에 복사합니다.
- 검색은 현재 탭의 내용과 설명을 함께 찾습니다.

Snippets는 로컬 설정 파일에 평문으로 저장됩니다. 토큰, 비밀번호, private key 같은 secret은 저장하지 마세요.

## 12. Workspace 저장 / 불러오기

workspace는 현재 작업 맥락을 저장합니다.

저장되는 것:

- profile과 root
- 열린 panel과 위치/크기
- 열린 editor/image/browser/note 상태
- shell widget 배치

`Save WS`를 한 번 눌러 저장된 workspace는 이후 같은 열린 workspace의 배치/탭/위젯 상태가 바뀌면 자동으로 해당 saved workspace 항목도 갱신됩니다.
앱은 변경 이벤트와 별도로 약 30초마다 active workspace를 안전 저장하고, 앱이 백그라운드로 갈 때도 한 번 flush합니다.
즉, 매번 `Save WS`를 다시 누르지 않아도 나중에 IDE를 다시 열었을 때 최근 배치에 가깝게 복원됩니다.

앱을 닫거나 재빌드하면 실제 shell process는 종료될 수 있습니다. 대신 workspace를 다시 열면 UI와 작업 맥락을 빠르게 복원하는 방식입니다.

### Memory Saver

`Set` 패널의 `Workspace memory saver` 기본값은 `Balanced`입니다.

- workspace가 많아졌을 때 오래 안 쓴 inactive workspace의 shell/PTY를 정리해 RAM 사용량을 줄입니다.
- `Balanced`는 10분 이상 inactive인 workspace를 대상으로 live workspace가 3개를 넘거나 live pane이 8개를 넘을 때 정리합니다. `Aggressive`는 2분, 1개 workspace, 4개 pane 기준입니다.
- inactive 시간은 해당 workspace를 실제로 떠난 시점부터 계산합니다.
- 해당 workspace tab과 layout snapshot은 유지되고, 다시 열면 shell이 새로 시작됩니다.
- sleep된 workspace를 열면 tab에 `waking`이 표시되고, 저장된 split shell 복원이 끝난 뒤 해제됩니다. 복원이 실패하면 같은 workspace tab을 다시 눌러 재시도할 수 있습니다.
- sleep된 workspace의 실행 중이던 shell process는 종료됩니다. 출력이 계속 나는 workspace는 idle로 보지 않지만, 장시간 서버/작업은 `Keep live`를 켜두는 것이 안전합니다.
- dev server나 장시간 실행 작업을 유지해야 하는 workspace는 workspace tab 우클릭 메뉴에서 `Keep live`를 켜세요. 이미 sleep된 workspace에서 켠 경우에는 먼저 workspace를 열어 shell을 다시 시작해야 합니다.

### Workspace tab 위치

`Set` 패널의 `Workspace tabs`에서 workspace tab 위치를 `Top`, `Bottom`, `Left side dock`, `Right side dock` 중 선택할 수 있습니다.

- `Top`은 기존과 같은 상단 tab bar입니다.
- `Bottom`은 같은 tab bar를 작업 영역 아래에 둡니다.
- `Left side dock` / `Right side dock`은 workspace 이름 리스트를 세로 dock으로 표시하고, 작업 영역은 dock 옆의 남은 공간으로 밀려납니다.
- 좌/우 dock은 경계선을 드래그해 폭을 조절할 수 있습니다.
- 좌/우 dock의 `Detail` 버튼은 모든 workspace detail을 펼치거나 접습니다. 각 workspace 행의 `▸`/`▾` 버튼으로 workspace별 detail도 따로 열고 닫을 수 있습니다.
- workspace detail에는 Codex/Claude/Grok/Agy shell이 감지되면 agent 종류, 상태, shell 제목, cwd, 최근 activity가 runtime-only로 표시되며, 카드를 누르면 해당 shell로 이동합니다.
- 이 detail 정보는 workspace snapshot에 transcript 원문으로 저장되지 않습니다. 현재 버전은 terminal title/output/input/exit 신호 기반의 가벼운 표시이며, tool/todo/token 같은 구조화 정보는 추후 확장 대상입니다.
- workspace resume/replay로 복원된 과거 terminal 출력은 `대기` 상태 판정에 사용하지 않습니다. 실제 live 선택지/질문이 새로 출력될 때만 `대기`로 바뀝니다.
- `Workspace detail content`에서 detail 카드의 보조 줄을 조절할 수 있습니다.
  - `Show activity/title line`: agent 이름 아래의 activity/title 줄을 표시합니다.
  - `Show path/source line`: cwd/path와 detection source 줄을 표시합니다.
  - `Hide both extra lines on capture-blocked workspaces`: capture block이 켜진 workspace에서는 위 두 보조 줄을 숨겨 detail에도 경로가 덜 드러나게 합니다.
- `Active workspace indicator`에서 선택된 workspace를 표시하는 방식을 조절할 수 있습니다.
  - `Blue outer border`: 현재처럼 선택된 workspace 외곽/인셋 라인으로 표시합니다.
  - `Highlight tab title`: workspace 이름이 있는 제목줄만 색으로 강조합니다. 좌/우 dock에서 detail을 펼쳐도 detail 전체가 아니라 제목줄만 강조됩니다.

#### Workspace Liquid Glass / IDE 배경

`Set` 패널의 `IDE 배경 / Workspace Glass`에서 팝업을 열 수 있습니다. 좌/우 workspace dock에서는 dock header의 `Glass` 버튼으로도 같은 팝업을 열 수 있습니다.

- `개별 workspace liquid glass 켜기`를 켜면 각 workspace row가 하나의 독립적인 liquidGL 대상이 됩니다. dock 전체를 통째로 glass 처리하지 않습니다.
- 팝업에서 IDE 배경 프리셋, 커스텀 배경 이미지/URL, 조명, 노이즈 on/off/강도, dock/container shell 배경·opacity·blur·outline·shadow·padding, row radius/패딩, liquidGL refraction/bevel/frost/tilt, 선택 highlight/rail/badge, workspace/agent 글자색과 크기를 조절할 수 있습니다.
- glass 모드에서는 기존 `Active workspace indicator`의 파란 border/title 강조가 중복으로 얹히지 않고, glass 전용 highlight/rail/badge 설정만 선택 표시를 담당합니다.
- liquidGL의 `shadow`와 CSS row/선택/capture 그림자는 별도입니다. 기본값은 선택 glow와 rail glow를 0으로 두어 glass 주변에 의도하지 않은 외부 그림자가 생기지 않게 했습니다.
- dock/container blur는 liquidGL row 자체가 아니라 container surface 레이어에만 적용되도록 분리되어 있습니다.
- 설정은 앱 설정에 저장되므로 새로고침/재실행 후에도 유지됩니다.
- capture lock workspace는 glass 모드와 일반 모드 모두 노란 배경 덩어리 대신 자물쇠 아이콘 색 위주로 표시됩니다.
- 현재 실제 liquidGL 적용 대상은 workspace row입니다. 터미널/xterm, 브라우저 iframe 같은 내부 위젯은 성능과 compositor 제약 때문에 별도 wrapper/overlay 방식 검토가 필요합니다. 자세한 후보는 `docs/GLASS_WIDGETS.md`에 정리되어 있습니다.

### LLM launcher tmux 재접속

WSL/SSH 같은 POSIX shell에서 Codex/Claude/Grok/Agy 버튼을 누르면, `tmux`가 설치된 경우 workspace+agent 단위 번호가 붙은 새 tmux session으로 실행합니다.

- 같은 workspace의 같은 agent 버튼을 여러 번 누르면 `codex #1`, `codex #2`처럼 별도 session/tab이 생깁니다.
- LLM shell widget의 `+` 버튼도 plain shell이 아니라 같은 agent의 새 tmux session tab을 추가합니다.
- LLM shell widget의 `Tmux` 버튼은 기존 tmux session 목록을 보여줍니다. session을 선택하면 현재 widget에 새 tab으로 attach합니다.
- `Tmux` 목록의 `Kill`은 확인 후 tmux session 자체를 종료합니다. tab의 `x`는 IDE tab/PTY만 닫고 tmux session은 죽이지 않습니다.
- stale-output probe는 현재 PTY를 자동으로 끊거나 재접속하지 않고 진단 경고만 남깁니다. 화면이 멈춘 경우 `Tmux` 메뉴에서 같은 session을 새 tab으로 직접 attach하세요.
- IDE가 만든 session은 전역 tmux 설정은 바꾸지 않고 해당 session에만 `destroy-unattached off`를 적용합니다. IDE client가 끊겨도 session을 유지하고, agent command가 종료되면 `remain-on-exit` dead-pane에 실제 status와 마지막 출력을 남깁니다. 이 동작은 `__svi_launch_v=8`부터 적용됩니다.
- `tmux`가 없거나 Windows profile에서는 기존처럼 직접 실행합니다.
- Codex와 Claude 버튼은 wrapper 내용을 판정하지 않고 각각 canonical bypass 인자 하나를 항상 추가합니다. 사용자 wrapper는 계정/실행 경로만 선택하고 bypass 인자를 자체 추가하지 않아야 합니다. Codex의 별도 `--enable goals`와 Windows 추가 override는 사용하지 않습니다.
- Grok/Agy 호환성 인자에는 기존 best-effort 중복 판정이 유지됩니다. Claude는 bypass 인자를 거부하는 POSIX root 환경에서만 plain `claude`로 실행합니다.
- Windows terminal에 표시되는 `[simple-vibe-ide] launching ...` 줄은 app이 실제로 더한 argv이므로 bypass 실행 여부를 확인할 때 사용합니다.
- `Set` -> `Agent event bridge`의 `tmux env passthrough`는 tmux 안에서 새 LLM을 띄울 때 유지할 환경변수 이름을 지정합니다. 기본값은 `IS_DEMO`이며, token/secret/key/password 계열 이름은 안전상 무시됩니다.

### Claude local hook 상태 브리지

`Set` -> `Agent event bridge`에서 Claude Code / Grok Build hook 기반 상태 판정을 설정할 수 있습니다.

- `Ask before installing local hook`: Claude 버튼을 처음 눌렀을 때 Claude가 사용하는 repository local settings와 작은 bridge script를 설치할지 묻습니다.
- `Auto install/update local hook`: 묻지 않고 설치/갱신합니다.
- `Off`: hook을 쓰지 않고 기존 terminal title/output 기반 상태 판정만 사용합니다.
- `Ask` 모드에서도 Simple Vibe IDE hook이 이미 설치되어 있으면 다시 묻지 않습니다. 이전 상대경로 형식, 수동으로 고쳤거나 repository 이동 뒤 낡아진 절대경로 형식, 일부 이벤트만 남은 설치는 다음 Claude 실행 전에 현재 버전으로 자동 migration합니다.
- migration은 Simple Vibe IDE handler만 교체하고 같은 matcher group의 사용자 hook과 다른 local settings는 보존합니다. JSON이 손상되면 수정하지 않으며, 각 파일은 atomic replace/create 직전에 외부 변경을 다시 확인합니다. 여러 파일을 옮기는 중 충돌하면 완료된 파일은 유지하고 terminal 기반 상태 판정으로 돌아간 뒤 다음 launch에서 다시 검증/수선합니다.
- Git workspace에서는 local settings, bridge script, migration 임시 파일을 repository-local exclude에 먼저 추가합니다. 대상 파일이 이미 Git에 tracked되어 있으면 로컬 절대경로가 public diff에 들어가지 않도록 수정하지 않고 terminal 상태 판정으로 돌아갑니다.
- 기본 `tmux env passthrough`에 `IS_DEMO`가 들어 있는 경우, local Claude settings의 `env.IS_DEMO`도 `1`로 맞춰 Claude 자체 demo/privacy 표시가 일반 shell 실행과 달라지지 않게 합니다.
- 새 hook 자동 설치는 WSL workspace와 Claude Code 2.1.211 이상을 대상으로 하며, subdirectory/worktree가 공유하는 git main checkout 설정을 확인합니다. 이전 버전 또는 version을 확인할 수 없는 custom wrapper에서는 새 hook/event를 만들지 않고 launch cwd에 이미 존재하는 Simple Vibe IDE handler만 같은 event 안에서 절대경로/fail-open 형식으로 수선합니다. 기존 handler를 찾지 못하면 설정을 수정하지 않고 terminal 상태 판정만 사용합니다. 이런 repair-only 설치는 일부 event만 있을 수 있으므로 hook을 단독 기준으로 삼지 않고 terminal 판정을 계속 병행합니다.
- Claude hook payload는 bridge 전송 전에 event/session/cwd/tool name/notification type/compact trigger/source 메타데이터만 남기고 prompt, tool input/output, assistant message 원문은 폐기합니다. Python 3로 안전하게 축약할 수 없으면 payload를 보내지 않고 Claude 실행만 계속합니다.
- hook 파일에는 bridge port/token 값이 저장되지 않고, Claude 실행 시점의 임시 환경변수로만 전달됩니다. 앱 재시작 뒤 이미 살아 있던 tmux Claude는 새 bridge 환경을 상속할 수 없으므로 새 hook event가 확인되기 전에는 terminal title/output fallback을 사용합니다.
- 현재 event 구성이 모두 검증된 Claude pane은 hook 상태를 우선 사용하므로 tmux scrollback/출력 재렌더가 `대기`/`작업중`으로 오인되는 일을 줄입니다. 마지막 hook event 뒤 5분 동안 새 event가 없으면 고장 난 hook이 상태를 영구 고정하지 않도록 terminal 판정을 다시 허용하며, 이후 hook event가 들어오면 hook 우선 상태가 복구됩니다.
- 부모 Claude의 완료는 `Stop`, 세션 종료는 `SessionEnd`를 기준으로 합니다. `SubagentStop`, tool 실패, permission 거절, auto context compact는 부모 작업을 즉시 완료/오류로 바꾸지 않으며, 수동 `/compact` 완료는 idle로 돌아갑니다.

Grok Build도 별도의 `Grok hooks` 옵션을 제공합니다.

- `Ask before installing global hook`: Grok 버튼을 눌렀을 때 WSL 사용자의 `~/.grok/hooks/simple-vibe-ide.json`과 `~/.grok/hooks/simple-vibe-ide-hook.sh`를 설치/갱신할지 묻습니다.
- `Auto install/update global hook`: 묻지 않고 설치/갱신합니다.
- 이 global hook은 항상 로드될 수 있지만, Simple Vibe IDE가 Grok을 실행할 때 넣는 `SVIDE_AGENT_*` 임시 환경변수가 없으면 bridge로 아무 것도 보내지 않습니다.
- Grok hook payload는 IDE bridge로 보낼 때 event/session/cwd/toolName 같은 최소 메타데이터만 남기고 prompt, tool input/output 원문은 버립니다.
- 실제 Grok 0.2.67 hook 이벤트는 `session_start`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`, `stop` 같은 snake_case로 들어오며, IDE backend가 이를 `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` 형태로 정규화합니다.
- Grok의 `Stop` 이벤트는 작업 완료 알림의 기준으로 쓰고, 질문/승인 화면은 title/output 보조 탐지를 함께 사용합니다.

### Agent alerts

`Set` 패널의 `Agent alerts`에서 LLM 상태 알림을 켜고 끌 수 있습니다.

- `Windows notification banners`: 작업 완료, 오류, 사용자 입력 필요 상태로 보일 때 Windows 알림 배너를 띄웁니다.
- `Light sound alert`: 같은 상태 변화에 Windows 네이티브 짧은 beep를 냅니다. WebView 포커스가 없어도 울리도록 처리합니다.
- 두 옵션은 서로 독립적입니다. 배너만 켜거나, 소리만 켜거나, 둘 다 끌 수 있습니다.
- 실제 agent 상태 알림 배너는 workspace 이름, LLM 이름, 상태만 간단히 보여줍니다. 터미널 제목, cwd, activity 상세 텍스트는 배너에 넣지 않습니다.
- 실제 agent 상태 알림 배너를 누르면 IDE가 열리고 해당 workspace의 해당 LLM pane으로 이동합니다. pane이 이미 사라진 경우에는 가능한 범위에서 workspace까지 이동합니다.
- 배너 아이콘은 앱 아이콘을 사용합니다. Windows fallback tray balloon도 가능한 경우 main window 앱 아이콘을 사용합니다.
- `Test native path`의 `Banner` / `Sound` / `Both` 버튼은 상태 판정 로직을 거치지 않고 같은 네이티브 알림 경로를 즉시 호출합니다.
  - 버튼을 누르면 같은 영역에 permission 확인, backend `send_agent_alert` 성공/실패, Tauri notification plugin 및 Windows tray balloon fallback 결과가 진단 로그로 남습니다.
  - `Banner 5s`는 Rust backend가 5초 뒤 native banner를 직접 발사합니다. 버튼을 누른 뒤 다른 프로그램으로 전환해서 IDE/WebView timer와 무관하게 뜨는지 확인할 수 있습니다.
  - 실제 LLM 상태 변화로 알림을 요청할 때도 `real alert request/OK/FAILED` 로그가 남습니다. 이 로그가 없으면 상태 판정/event 미발사 쪽, 로그가 있는데 배너만 없으면 Windows/Tauri 배너 표시 계층 쪽으로 보면 됩니다.
  - `Sound`는 나는데 `Banner` 로그가 backend OK로 끝나면 상태 판정 문제가 아니라 Windows/Tauri 배너 표시 계층 문제일 가능성이 큽니다.
  - 테스트 버튼도 반응이 없으면 Windows/Tauri 알림 경로 문제입니다.
  - 테스트 버튼은 되는데 실제 작업 완료 알림만 안 뜨면 LLM 상태 판정 문제입니다.
- 배너가 계속 안 보이면 Windows 알림/방해 금지/앱별 알림 허용 상태를 확인해야 합니다.
- Claude hook bridge가 활성화된 pane은 hook 이벤트를 우선 사용하고, 그 외에는 workspace agent activity와 같은 title/output/input/exit 기반 신호를 사용합니다. 따라서 hook이 없는 agent/status는 아직 완벽하지 않을 수 있습니다.

### Diagnostics log

`Set` -> `Diagnostics log`에서 앱 내부 진단 로그를 켜고 별도 팝업으로 볼 수 있습니다.

- 기본값은 꺼짐입니다. 문제가 재현될 때만 `Capture app diagnostic events`를 켜면 됩니다.
- `Open log`는 현재 메모리에 쌓인 로그를 보여주고, `Copy`로 전체 로그를 복사할 수 있습니다.
- 로그는 터미널 렌더 watchdog, visible pane flush, agent 상태/source 변경, Claude hook bridge 이벤트, 알림 요청/성공/실패, memory saver sleep 같은 이벤트 메타데이터만 남깁니다.
- Diagnostics가 켜져 있고 IDE가 띄운 tmux 기반 LLM pane이 보이는 상태라면 `tmux probe` 로그가 주기적으로 남습니다. 이 로그는 tmux pane의 dead/copy-mode/alternate-screen 상태, 현재 command/pid, 최근 capture/title/window의 checksum+byte 길이, IDE 쪽 data/refresh age와 write backlog만 기록해서 freeze가 tmux 내부 정지인지 IDE 렌더/PTY 전달 문제인지 가르는 데 씁니다.
- tmux 내용은 바뀌는데 IDE data가 오래 멈춘 것으로 보이면 `autoReconnect=off` 경고가 남습니다. 이 판정은 휴리스틱이므로 앱은 기존 client를 보존하고, 재접속은 사용자가 `Tmux` 메뉴에서 명시적으로 수행합니다.
- raw terminal 출력, clipboard 내용, 파일 본문, token/secret/env 값은 기록하지 않습니다.
- IDE가 정상 종료되지 않았다고 보이면, 다음 실행 때 `previous session did not shut down cleanly` 항목과 마지막 heartbeat/event 시간이 남습니다.
- 이전 세션 로그는 최근 일부만 브라우저 로컬 저장소에 보존되는 디버그용 breadcrumb입니다. 완전한 crash dump는 아니지만 강제 종료 직전 어느 영역이 마지막으로 기록됐는지 확인하는 데 쓸 수 있습니다.

### 송출 보호

capture block이 켜진 workspace는 열 때 송출 보호 적용을 먼저 시도한 뒤 내용을 복원합니다.
보호 적용에 실패하면 실제 workspace 내용을 보여주지 않고 보호 안내 화면을 유지합니다.

### 위젯 모양 / 선택 표시

`Set` 패널에서 위젯 모서리 R값을 실시간으로 조절할 수 있습니다. 기본값은 현재 스타일과 같은 `8px`입니다.

`IDE scale`에는 현재 전체 UI 배율이 표시됩니다. 터미널 렌더링 문제를 확인할 때는 `Reset 100%`를 눌러 100% 상태에서 먼저 비교하세요.

Active widget indicator 옵션은 독립적으로 켜고 끌 수 있습니다.

- `Blue outer border`: 현재 선택된 위젯 외곽의 푸른 테두리
- `Highlight title bar`: 현재 선택된 위젯의 제목줄 색상 강조

둘 다 켜거나, 둘 중 하나만 쓰거나, 둘 다 끌 수 있습니다.

각 위젯 제목줄의 `Op` 버튼으로 해당 위젯 전체 투명도를 조절할 수 있습니다.

- 범위는 `45%`부터 `100%`까지이며, 기본값은 `100%`입니다.
- 값은 workspace layout에 저장되어 IDE를 다시 열어도 유지됩니다.
- 슬라이더를 움직이는 동안은 해당 위젯의 CSS opacity만 바뀌므로 전체 UI를 다시 그리지 않습니다.
- drag/resize 중에는 조작하기 쉽도록 일시적으로 더 선명하게 표시됩니다.
- Browser의 native WebView 내용은 OS child window라 투명도가 완전히 동일하게 적용되지 않을 수 있습니다.

## 13. 앱 종료

앱을 닫으면 창은 먼저 닫히고, shell/WSL/SSH 관련 정리는 백그라운드에서 처리됩니다.

그래도 중요한 작업은 종료 전에 shell에서 저장하거나 commit해 두는 것이 좋습니다.

## 13. 추천 사용 흐름

일반적인 코딩 세션:

1. workspace 열기
2. `Codex` 또는 `Claude` shell 열기
3. Explorer에서 파일 확인
4. 필요한 파일은 Editor로 열기
5. 한글 프롬프트가 길면 `Type` pad에 작성 후 `Ctrl+Enter`
6. 로컬 서버가 있으면 Browser Preview로 확인
7. 중간 메모는 Notes에 저장
8. 작업 끝나면 shell에서 git 상태 확인 후 앱 종료

한글 프롬프트를 자주 쓴다면, shell에 직접 길게 치기보다 `Type` pad를 기본 입력창처럼 쓰는 것이 안전합니다.
