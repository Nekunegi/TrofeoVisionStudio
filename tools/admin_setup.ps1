# Run ELEVATED. Frees the Trofeo Vision LCD from TRCC so our driver can claim it.
# Logs to admin_setup.log next to this script. Does NOT touch the USB driver
# (that is done manually in Zadig afterwards).

$log = Join-Path $PSScriptRoot "admin_setup.log"
"=== admin_setup $(Get-Date -Format o) ===" | Out-File $log

function Say($m) { $m | Tee-Object -FilePath $log -Append }

# 1) Kill the auto-restart scheduled task so processes stop respawning.
try {
    Stop-ScheduledTask -TaskName "TRCCAppStartup" -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName "TRCCAppStartup" -ErrorAction Stop | Out-Null
    Say "TRCCAppStartup: disabled"
} catch { Say "TRCCAppStartup disable failed: $($_.Exception.Message)" }

# 2) Kill the running processes.
foreach ($n in "TRCC","USBLCD","USBLCDNEW") {
    Stop-Process -Name $n -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 1500
$still = Get-Process | Where-Object { $_.ProcessName -match "TRCC|USBLCD" } | Select-Object -ExpandProperty ProcessName
if ($still) { Say "STILL running: $still" } else { Say "processes stopped, no respawn" }

# 3) Report current USB driver so we know if Zadig/WinUSB is still needed.
$d = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match "VID_0416&PID_5408" } | Select-Object -First 1
if ($d) {
    $svc = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_Service' -ErrorAction SilentlyContinue).Data
    Say "device 0416:5408 driver service = '$svc'  (WinUSB = ready for libusb; anything else = run Zadig)"
} else { Say "device 0416:5408 not found" }

Say "--- done. Next: Zadig -> WinUSB if service is not 'WinUSB'. ---"
