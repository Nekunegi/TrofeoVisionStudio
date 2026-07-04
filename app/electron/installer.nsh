; Custom NSIS steps for the per-machine installer (runs elevated).
;
; - Installs the PawnIO driver (signed, HVCI-compatible) so LibreHardwareMonitor
;   can read CPU temperature on systems with memory integrity enabled.
; - Launches the app while still elevated: the app itself registers/repairs the
;   TrofeoVisionStudio logon task (RunLevel Highest) on every elevated start,
;   which avoids NSIS<->schtasks quoting pitfalls entirely.

!macro customInstall
  DetailPrint "Installing PawnIO driver..."
  ExecWait '"$INSTDIR\resources\PawnIO_setup.exe" -install -silent'
  DetailPrint "Starting Trofeo Vision Studio (elevated)..."
  Exec '"$INSTDIR\Trofeo Vision Studio.exe"'
!macroend

!macro customUnInstall
  ExecWait 'schtasks /End /TN "TrofeoVisionStudio"'
  ExecWait 'schtasks /Delete /F /TN "TrofeoVisionStudio"'
!macroend
