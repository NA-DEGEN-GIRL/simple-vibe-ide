# LLM Waiting Indicator Notes

This note documents the workspace-tab LLM indicator that turns red when an
LLM terminal appears to be waiting for user input.

## Indicator states

- No dot: no LLM pane is known for the workspace.
- Dim green: an LLM pane exists, but no recent activity is detected.
- Bright pulsing green: recent LLM launch/input/output activity is detected.
- Pulsing red: an LLM pane appears to be waiting for a user response.

The red state is intentionally workspace-level only. It does not add extra pane
or terminal-tab borders.

## How detection works

There is no official state event from the CLI in this app yet. Detection is a
small terminal-output heuristic in `src/main.ts`:

- only panes opened through an LLM launcher are considered;
- currently `codex`, `claude`, `grok`, and `antigravity`/`agy` launcher panes
  are checked;
- ANSI/control sequences are stripped from recent output;
- actual interactive prompts such as trust/approval menus, permission prompts,
  and structured choice menus can set the red state;
- plain assistant text that merely asks a question or lists choices should not
  set the red state unless the terminal also shows a real selectable menu.

The red state clears when either:

- the user sends meaningful input to that LLM pane; or
- immediately after that input, the CLI repaints stale prompt/menu text while it
  begins work; or
- later output arrives that clearly looks idle/completed, such as usage/status,
  completed-turn, resume/quit, or connection-status screens; or
- a failed/unavailable choice-menu tool result arrives, such as
  `request_user_input is unavailable`; or
- the terminal screen is cleared from the shell context menu; or
- the pane exits or is removed.

Red is sticky across ambiguous output chunks. TUI apps often repaint a prompt in
several chunks, so a single non-prompt chunk must not bounce the indicator back
to green while the same prompt is still on screen.

When a completed-work marker and an interactive menu are emitted together, the
menu wins. For example, Codex Plan Mode can print `Worked for ...` immediately
above `Implement this plan?`; that should still turn the workspace dot red.

## Codex cases tested

Tested with Codex CLI `0.135.0` in temporary directories using
`CODEX_NO_DANGEROUS_DEFAULT=1` so the local wrapper did not force YOLO mode.
No repository files were modified by these probes.

Covered cases:

- Codex trust prompt:
  - `Do you trust the contents of this directory?`
  - `Yes, continue`
  - `Press enter to continue`
- Codex command approval prompt without YOLO:
  - `Would you like to run the following command?`
  - `Yes, proceed`
  - `Press enter to confirm or esc to cancel`

Plain assistant answer prompts, including English/Korean text that asks the user
to choose from a normal numbered list, should complete green. They should only
turn red when Codex shows an actual selectable menu or approval/trust prompt.

## Grok cases tested

Tested with Grok Build `0.2.14` in temporary directories. No repository files
were modified by these probes.

Covered cases:

- Grok command approval prompt:
  - `Yes, and don't ask again for anything (always-approve mode)`;
  - `Yes, proceed`;
  - `No, reject`;
  - `Ctrl+o:yolo`.

Approval cases should turn the workspace dot red. Plain text choice requests
without a selectable menu should not.

## Antigravity/Agy cases tested

The Antigravity command is `agy`; `antigravity` was not present on the tested
machine. Tested with Agy `1.0.3` in a temporary directory. Output was sanitized
before recording because Agy prints the signed-in account line.

Covered cases:

- Agy project trust prompt:
  - `Do you trust the contents of this project?`;
  - `Antigravity CLI requires permission to read, edit, and execute files here`;
  - `Yes, I trust this folder`.
- Agy command permission prompt:
  - `Requesting permission for:`;
  - `Do you want to proceed?`;
  - `Yes` / `No`;
  - `tab Amend` and `esc to cancel`.

Permission cases should turn the workspace dot red. Plain text choice requests
without a selectable menu should not.

## False-positive guardrails

Usage/status screens, idle menus, failed tool-call results, and plain text
questions should not turn the dot red just because they include key hints or
choice wording. In particular, standalone hints such as `Esc to cancel`,
`Resume session`, `Quit`, `Turn completed`, `Usage:`, `Connecting MCPs`, or
`request_user_input is unavailable` should clear or keep off the red waiting
state unless they are paired with a real approval/trust/selectable-menu prompt.

## Claude cases still pending

Claude could not be tested fully in the original implementation pass because
the available account was quota-limited. When quota is available, test at least:

- a normal Claude question asking the user to choose/confirm something, which
  should stay green unless Claude renders a real selectable menu;
- a Claude permission prompt for running a command or editing a file;
- a non-waiting Claude output stream to check false positives;
- user answer input to verify red clears and green activity resumes.

If Claude wording differs, update `llmOutputLooksLikeUserPrompt()` in
`src/main.ts` and add the exact sanitized prompt shape to this file.

## Safe retest recipe

Use a temp folder, not the repo root, and disable any local unsafe wrapper
defaults when probing approval UI:

```bash
mkdir -p /tmp/simple-vibe-ide-llm-waiting-probe
cd /tmp/simple-vibe-ide-llm-waiting-probe
CODEX_NO_DANGEROUS_DEFAULT=1 codex --no-alt-screen --ask-for-approval never --sandbox read-only \
  "도구를 실행하지 말고, 한국어로 세 선택지 중 하나를 고르라고 물어본 뒤 기다려."
```

For approval UI, use `--ask-for-approval untrusted` and a harmless temp-file
command under `/tmp`. Do not run probes that touch the repository or private
paths.
