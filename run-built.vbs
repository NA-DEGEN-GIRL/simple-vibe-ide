Option Explicit

Dim shell
Dim fso
Dim env
Dim scriptDir
Dim tempDir
Dim launchScript
Dim launchCommand
Dim launchExitCode

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set env = shell.Environment("PROCESS")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
tempDir = shell.ExpandEnvironmentStrings("%TEMP%")
launchScript = fso.BuildPath(scriptDir, "scripts\run-temp-release.ps1")

If Not fso.FileExists(launchScript) Then
  MsgBox "Launch helper not found: scripts\run-temp-release.ps1", vbExclamation, "Simple Vibe IDE"
  WScript.Quit 1
End If

env("SIMPLE_VIBE_IDE_ROOT") = scriptDir
launchCommand = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass " & _
  "-WindowStyle Hidden -File " & Chr(34) & launchScript & Chr(34) & " -SkipTerminal"

' Wait only for the copy/launcher helper, not for the application lifetime.
On Error Resume Next
shell.CurrentDirectory = tempDir
launchExitCode = shell.Run(launchCommand, 0, True)
If Err.Number <> 0 Then
  Err.Clear
  On Error GoTo 0
  MsgBox "Could not start the app. Run run-built.cmd to see diagnostics.", vbExclamation, "Simple Vibe IDE"
  WScript.Quit 1
End If
On Error GoTo 0

If launchExitCode <> 0 Then
  MsgBox "App launch failed. Run run-built.cmd to see diagnostics.", vbExclamation, "Simple Vibe IDE"
  WScript.Quit launchExitCode
End If
