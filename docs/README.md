# 문서 지도 — 새 개발 시스템의 시작점

기준일: 2026-09-19. **이전 PC나 채팅 기록 없이 새 clone에서 개발을 재개**하기 위한 순서다.
문서가 충돌하면 실제 코드/설정과 현재형 문서를 우선한다. 날짜 있는 과거 분석은 당시 기록이다.

## 필수 읽기

| 순서 | 문서 | 목적 |
| --- | --- | --- |
| 1 | [AGENTS.md](../AGENTS.md) | Astra/다른 coding agent의 작업 계약, 안전/성능 불변조건 |
| 2 | [DEVELOPMENT_HANDOFF.md](DEVELOPMENT_HANDOFF.md) | 전체 구현 요약, 최근 패치, 검증 날짜, 이관/미해결 과제 |
| 3 | [DEVELOPMENT_ENVIRONMENTS.md](DEVELOPMENT_ENVIRONMENTS.md) | Windows/WSL/Linux/macOS 범위, 설치/빌드/실행/문제 해결 |
| 4 | [ARCHITECTURE.md](ARCHITECTURE.md) | frontend↔IPC↔Rust, lifecycle, 소스 함수 지도, storage/privacy |
| 5 | [TESTING.md](TESTING.md) | 13 Node scripts, Rust tests, Windows gate, 수동 재현, 공개 점검 |

## 사용자 및 빌드 안내

- [README](../README.md): 제품 소개, 기능 목록, 두 flavor의 기본 실행.
- [USER_GUIDE.ko.md](USER_GUIDE.ko.md): 사용자 조작과 위젯 설명.
- [LLM_INSTALL_GUIDE.md](LLM_INSTALL_GUIDE.md): 설치를 맡은 agent용 간단 안내.
- [CLONE_BUILD_HANDOFF.md](CLONE_BUILD_HANDOFF.md): 짧은 clone checklist.
- [WINDOWS_RUNTIME_SMOKE.md](WINDOWS_RUNTIME_SMOKE.md): 상세 Windows 빌드/수동 smoke,
  isolated tmux profile 검증과 결과 양식.

## 구현/성능 전문 문서

- [PERFORMANCE_AUDIT.md](PERFORMANCE_AUDIT.md): whole-app 저수준 개선과 남은 병목.
- [BROWSER_PERFORMANCE.md](BROWSER_PERFORMANCE.md): navigation/proxy/console/body capture.
- [IDE_PERFORMANCE_REVIEW.md](IDE_PERFORMANCE_REVIEW.md): 앞선 성능 검토의 근거와 후보.
- [GLASS_WIDGETS.md](GLASS_WIDGETS.md), [LIQUID_GLASS_PERF_REVIEW.md](LIQUID_GLASS_PERF_REVIEW.md):
  Glass 구현/성능과 설정 범위.
- [GLASS_MULTI_WIDGET_CONTEXT_EXHAUSTION.md](GLASS_MULTI_WIDGET_CONTEXT_EXHAUSTION.md):
  여러 위젯의 WebGL context 관련 과거 분석.
- [GROK_BUILD_CELL_WIDTH_DESYNC.md](GROK_BUILD_CELL_WIDTH_DESYNC.md): TUI cell width/resize 분석.
- [LLM_WAITING_INDICATOR.md](LLM_WAITING_INDICATOR.md),
  [AGENT_ALERT_AND_RENAME_ROOT_CAUSES.md](AGENT_ALERT_AND_RENAME_ROOT_CAUSES.md): 상태/알림 경계.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): 포함 자산/구성요소 고지.
- `docs/designs/`: 과거 디자인 자료. 실제 제품 동작의 명세로 우선하지 않는다.

## 기록과 개인정보

- [codex.md](../codex.md): 누적 patch log. 날짜별 검증 수준을 보존하고 큰 파일 전체를
  매번 읽기보다는 관련 기능/최근 항목을 찾는다.
- `.handoff/`는 무시되는 로컬 기록이다. 여기에만 있는 지식으로 새 시스템 개발을 막지 않는다.
- 개인 LLM 인증, SSH 키/설정, PowerShell profile, tmux 설치/설정, 앱 데이터와 실행 중
  세션은 Git clone으로 이전되지 않는다. 비공개 백업/재설정은 이관 문서를 따른다.
- 소스 이전과 실제 실행 검증은 다르다. 새 시스템의 Windows GUI/한글 입력/SSH/tmux 결과를
  직접 기록하고, 이전 PC에서 통과했다는 이유로 새 검증을 통과로 표시하지 않는다.
