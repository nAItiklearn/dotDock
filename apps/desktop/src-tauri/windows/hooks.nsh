; dotDock NSIS hooks (Tauri installerHooks).
; Before uninstalling, return the desktop to stock Windows: remove launch-at-sign-in,
; restore the startup delay and the original wallpaper from the snapshot.
!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Restoring the Windows desktop..."
  ExecWait '"$INSTDIR\dotdock.exe" --restore-windows' $0
  DetailPrint "Restore finished with code $0"
!macroend
