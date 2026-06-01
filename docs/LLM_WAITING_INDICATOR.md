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
- prompt-like text such as `waiting for your answer`, `choose/select`,
  `Would you like to run the following command?`, `Press enter to confirm`, and
  Korean `선택/골라/응답/답변` style prompts can set the red state.

The red state clears when either:

- the user sends meaningful input to that LLM pane; or
- later output arrives that no longer looks like a waiting prompt; or
- the pane exits or is removed.

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
- Codex English answer prompt:
  - `Please choose one meaningless option`
  - `Waiting for your answer`
- Codex Korean answer prompt:
  - `하나만 골라주세요: ...`

These cases should turn the workspace dot red.

## Grok cases tested

Tested with Grok Build `0.2.14` in temporary directories. No repository files
were modified by these probes.

Covered cases:

- Grok English answer prompt:
  - user-prompted choice request;
  - model response containing `for your input`;
  - turn returns to the prompt after the answer request.
- Grok command approval prompt:
  - `Yes, and don't ask again for anything (always-approve mode)`;
  - `Yes, proceed`;
  - `No, reject`;
  - `Ctrl+o:yolo`.

These cases should turn the workspace dot red.

## Antigravity/Agy cases tested

The Antigravity command is `agy`; `antigravity` was not present on the tested
machine. Tested with Agy `1.0.3` in a temporary directory. Output was sanitized
before recording because Agy prints the signed-in account line.

Covered cases:

- Agy project trust prompt:
  - `Do you trust the contents of this project?`;
  - `Antigravity CLI requires permission to read, edit, and execute files here`;
  - `Yes, I trust this folder`.
- Agy English answer prompt:
  - `I am waiting for your input to proceed`;
  - `Please choose one of the following options`;
  - `Please reply with your choice`.
- Agy command permission prompt:
  - `Requesting permission for:`;
  - `Do you want to proceed?`;
  - `Yes` / `No`;
  - `tab Amend` and `esc to cancel`.

These cases should turn the workspace dot red.

## Claude cases still pending

Claude could not be tested fully in the original implementation pass because
the available account was quota-limited. When quota is available, test at least:

- a normal Claude question asking the user to choose/confirm something;
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
