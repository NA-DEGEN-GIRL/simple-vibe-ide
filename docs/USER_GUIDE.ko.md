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
- `Calc`: 간단 계산기
- `Set`: 앱 설정

위젯은 title bar를 잡고 움직이고, 모서리/변을 잡아 크기를 바꿉니다.

## 4. Shell 사용하기

### 새 shell 열기

- `+shell`: 현재 workspace 기준 새 shell을 엽니다.
- `Win`: Windows shell을 엽니다.
- `Codex`, `Claude`, `Grok`, `Agy`: 해당 LLM CLI를 새 shell widget에서 실행합니다.

각 shell widget 안에는 여러 shell tab을 만들 수 있습니다.

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

## 11. Workspace 저장 / 불러오기

workspace는 현재 작업 맥락을 저장합니다.

저장되는 것:

- profile과 root
- 열린 panel과 위치/크기
- 열린 editor/image/browser/note 상태
- shell widget 배치

앱을 닫거나 재빌드하면 실제 shell process는 종료될 수 있습니다. 대신 workspace를 다시 열면 UI와 작업 맥락을 빠르게 복원하는 방식입니다.

## 12. 앱 종료

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

