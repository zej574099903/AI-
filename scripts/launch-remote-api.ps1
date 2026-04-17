$ErrorActionPreference = "Stop"

$ROOT_DIR = Resolve-Path "$PSScriptRoot\.."
$LOG_DIR = Join-Path $ROOT_DIR ".runtime"
$SERVER_LOG = Join-Path $LOG_DIR "server.log"
$TUNNEL_LOG = Join-Path $LOG_DIR "cloudflared.log"
$SERVER_PID_FILE = Join-Path $LOG_DIR "server.pid"
$TUNNEL_PID_FILE = Join-Path $LOG_DIR "cloudflared.pid"
$PORT = if ($env:PORT) { $env:PORT } else { 8787 }
$TARGET_URL = "http://127.0.0.1:$PORT"

if (-not (Test-Path $LOG_DIR)) {
    New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null
}

$CLOUDFLARED_EXE = "cloudflared"
$LOCAL_CLOUDFLARED = Join-Path $PSScriptRoot "cloudflared.exe"
if (Test-Path $LOCAL_CLOUDFLARED) {
    $CLOUDFLARED_EXE = "`"$LOCAL_CLOUDFLARED`""
}

function Stop-ProcessFromFile {
    param([string]$PidFile)
    if (Test-Path $PidFile) {
        $targetPid = Get-Content $PidFile -Raw
        if ($targetPid -and (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
}

# Stop existing tunnel if any
Stop-ProcessFromFile $TUNNEL_PID_FILE

# Check if backend is already running
$running = $false
try {
    $resp = Invoke-RestMethod -Uri "$TARGET_URL/api/health" -TimeoutSec 2
    if ($resp.ok) { $running = $true }
} catch {}

if ($running) {
    Write-Host "Backend already running on $TARGET_URL" -ForegroundColor Cyan
} else {
    Stop-ProcessFromFile $SERVER_PID_FILE
    Write-Host "Starting backend on $TARGET_URL ..." -ForegroundColor Cyan
    
    $process = Start-Process powershell -ArgumentList "-Command `"node `"$ROOT_DIR\server.js`" *>&1 | Out-File -FilePath `"$SERVER_LOG`" -Encoding utf8`"" -WorkingDirectory $ROOT_DIR -NoNewWindow -PassThru
    $process.Id | Out-File $SERVER_PID_FILE

    # Wait for healthy
    Write-Host "Waiting for backend to become healthy..." -NoNewline
    for ($i = 0; $i -lt 20; $i++) {
        try {
            $resp = Invoke-RestMethod -Uri "$TARGET_URL/api/health" -TimeoutSec 1
            if ($resp.ok) { 
                Write-Host " OK" -ForegroundColor Green
                break 
            }
        } catch {}
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 1
    }
}

# Double check health
try {
    $resp = Invoke-RestMethod -Uri "$TARGET_URL/api/health" -TimeoutSec 2
} catch {
    Write-Host "`nBackend failed to start. Check log: $SERVER_LOG" -ForegroundColor Red
    exit 1
}

# Start Tunnel
if (Test-Path $TUNNEL_LOG) { Clear-Content $TUNNEL_LOG }
Write-Host "Starting cloudflared tunnel ..." -ForegroundColor Cyan

$tunnelProcess = Start-Process powershell -ArgumentList "-Command `"$CLOUDFLARED_EXE tunnel --url $TARGET_URL --no-autoupdate *>&1 | Out-File -FilePath `"$TUNNEL_LOG`" -Encoding utf8`"" -NoNewWindow -PassThru
$tunnelProcess.Id | Out-File $TUNNEL_PID_FILE

$TUNNEL_URL = ""
Write-Host "Waiting for tunnel URL..." -NoNewline
for ($i = 0; $i -lt 30; $i++) {
    if (Test-Path $TUNNEL_LOG) {
        $content = Get-Content $TUNNEL_LOG
        $match = $content | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
        if ($match) {
            $TUNNEL_URL = $match.Matches.Value
            Write-Host " OK" -ForegroundColor Green
            break
        }
    }
    Write-Host "." -NoNewline
    Start-Sleep -Seconds 1
}

if (-not $TUNNEL_URL) {
    Write-Host "`nTunnel started but URL was not detected yet. Check log: $TUNNEL_LOG" -ForegroundColor Red
    exit 1
}

Set-Clipboard -Value $TUNNEL_URL

Write-Host "`nDone." -ForegroundColor Green
Write-Host "Backend health: $TARGET_URL/api/health"
Write-Host "Remote API URL: $TUNNEL_URL" -ForegroundColor Yellow
Write-Host "The URL has been copied to your clipboard."

Write-Host "`nLogs:"
Write-Host "  Backend    $SERVER_LOG"
Write-Host "  Tunnel     $TUNNEL_LOG"

Write-Host "`nIf you want to stop them later, run the stop script."
