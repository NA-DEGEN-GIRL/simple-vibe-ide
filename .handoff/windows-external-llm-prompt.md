# Prompt For External Windows Runtime LLM

You are operating on a real Windows machine with Node.js, Rustup, Cargo, and
Visual Studio Build Tools/MSVC available. Your task is to validate the current
Simple Vibe IDE performance optimization branch in a Windows runtime.

This branch intentionally builds the Windows release exe with `-C target-cpu=native`
for same-machine use. Do not treat the produced exe as a portable release binary.

Use repo state as authoritative. Do not reveal private paths, usernames,
tokens, private URLs, screenshots with private content, or secret config values.
Use placeholders like `[USER]`, `[DISTRO]`, and `[WORKSPACE]` in your final
report.

## Required commands

From PowerShell in the repo root:

```powershell
.\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall
```

If dependencies are missing, rerun without `-SkipNpmInstall`:

```powershell
.\scripts\windows-runtime-smoke.ps1
```

If PowerShell blocks unsigned local scripts, use an execution-policy bypass for
this process only:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-runtime-smoke.ps1 -SkipNpmInstall
```

If the script fails, capture the exact failing command and error text. If it
passes, launch the built app if the script did not already launch it.

## Manual smoke

Follow `docs/WINDOWS_RUNTIME_SMOKE.md` exactly. Focus on:

1. first paint and workspace switching,
2. Explorer large-directory fast scrolling,
3. terminal widgets/tabs with many panes,
4. Browser hidden vs visible states,
5. Browser console huge/nested payload logs,
6. Browser forwards/detected ports,
7. Editor/Image/Notes/Calculator/Export regressions.

## Required final report

Return:

- Windows runtime smoke result: pass/fail
- command results for each build gate
- whether the built exe launched
- manual smoke result by section
- any lag/regression found with reproduction steps
- performance notes
- exact files changed only if you had to patch anything

Do not claim pass for any item you did not run.
