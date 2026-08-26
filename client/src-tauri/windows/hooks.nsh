; StarBuddy NSIS installer hooks (Tauri bundle.windows.nsis.installerHooks).
;
; The client was renamed from StarMaker: its bundle identifier changed from
; io.github.ulrichdahl.starmaker to io.github.ulrichdahl.starbuddy, so the
; stock "uninstall previous version" logic no longer sees the old install.
; Before installing, run the old uninstaller silently (per-user first, then
; per-machine) so two copies never sit side by side.

!include "FileFunc.nsh"

!macro _STARBUDDY_REMOVE_OLD ROOT
  ReadRegStr $R0 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\io.github.ulrichdahl.starmaker" "UninstallString"
  ${If} $R0 != ""
    ; UninstallString is quoted: "C:\...\uninstall.exe"
    StrCpy $R1 $R0
    StrCpy $R2 $R1 1
    ${If} $R2 == '"'
      StrCpy $R1 $R1 "" 1
      StrCpy $R1 $R1 -1
    ${EndIf}
    ${GetParent} $R1 $R2
    DetailPrint "Removing the previous StarMaker-era installation from $R2"
    ExecWait '"$R1" /S _?=$R2'
    Delete "$R1"
    RMDir "$R2"
    DeleteRegKey ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\io.github.ulrichdahl.starmaker"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro _STARBUDDY_REMOVE_OLD HKCU
  !insertmacro _STARBUDDY_REMOVE_OLD HKLM
!macroend
