Option Explicit

Dim shell
Dim fso
Dim env
Dim scriptDir
Dim tempDir
Dim appRoot
Dim appDir
Dim sourceExe
Dim appExe

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set env = shell.Environment("PROCESS")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
tempDir = shell.ExpandEnvironmentStrings("%TEMP%")
appRoot = fso.BuildPath(tempDir, "simple-vibe-ide-target")
appDir = fso.BuildPath(appRoot, "release")
appExe = fso.BuildPath(appDir, "simple-vibe-ide.exe")
sourceExe = appExe

If Not fso.FileExists(sourceExe) Then
  sourceExe = fso.BuildPath(scriptDir, "src-tauri\target\release\simple-vibe-ide.exe")
End If

If Not fso.FileExists(sourceExe) Then
  MsgBox "Built app not found." & vbCrLf & vbCrLf & sourceExe & vbCrLf & vbCrLf & _
    "Build it first with: npm run tauri -- build --no-bundle", vbExclamation, "Simple Vibe IDE"
  WScript.Quit 1
End If

If Not fso.FolderExists(appRoot) Then fso.CreateFolder appRoot
If Not fso.FolderExists(appDir) Then fso.CreateFolder appDir

If LCase(sourceExe) <> LCase(appExe) Then
  fso.CopyFile sourceExe, appExe, True
End If
env("SIMPLE_VIBE_IDE_ROOT") = scriptDir
shell.CurrentDirectory = tempDir
shell.Run Chr(34) & appExe & Chr(34), 1, False
