$ErrorActionPreference = "SilentlyContinue"

$ROOT_DIR = Resolve-Path "$PSScriptRoot\.."
$LOG_DIR = Join-Path $ROOT_DIR ".runtime"
$SERVER_PID_FILE = Join-Path $LOG_DIR "server.pid"
$TUNNEL_PID_FILE = Join-Path $LOG_DIR "cloudflared.pid"

function Stop-FromPidFile {
    param([string]$Label, [string]$PidFile)

    if (-not (Test-Path $PidFile)) {
        Write-Host "$($Label): not running"
        return
    }

    $targetPid = Get-Content $PidFile -Raw
    if ($targetPid -and (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $targetPid -Force
        Write-Host "$($Label): stopped ($targetPid)" -ForegroundColor Green
    } else {
        Write-Host "$($Label): stale pid file cleaned" -ForegroundColor Gray
    }

    Remove-Item $PidFile -Force
}

Stop-FromPidFile "Tunnel" $TUNNEL_PID_FILE
Stop-FromPidFile "Backend" $SERVER_PID_FILE
