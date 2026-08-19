# Aluka Desktop smoke — 构建 UI、启动主进程、等待 host/ui-ready，再结束进程。
# 用法（仓库根）:
#   $env:ALUKA = "E:\codes\go_projects\aluka_lang\aluka_lang\bin\aluka.exe"
#   powershell -File scripts/smoke.ps1
#
# 可选: $env:SMOKE_TIMEOUT_SEC = "45"

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot | Split-Path -Parent
$App = Join-Path $Root "apps\desktop"
$TimeoutSec = if ($env:SMOKE_TIMEOUT_SEC) { [int]$env:SMOKE_TIMEOUT_SEC } else { 45 }

function Resolve-Aluka {
  if ($env:ALUKA -and (Test-Path $env:ALUKA)) { return $env:ALUKA }
  $candidates = @(
    "E:\codes\go_projects\aluka_lang\aluka_lang\bin\aluka.exe",
    (Join-Path $Root "..\..\..\go_projects\aluka_lang\aluka_lang\bin\aluka.exe")
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return (Resolve-Path $c).Path }
  }
  throw "ALUKA binary not found. Set `$env:ALUKA"
}

$Aluka = Resolve-Aluka
Write-Host "[smoke] ALUKA=$Aluka"
Write-Host "[smoke] app=$App"

Push-Location $App
try {
  npm run build:ui
  if ($LASTEXITCODE -ne 0) { throw "build:ui failed" }

  $log = Join-Path $env:TEMP ("aluka-desktop-smoke-{0}.log" -f [guid]::NewGuid().ToString("n"))
  if (Test-Path $log) { Remove-Item $log -Force }

  $env:ALUKA = $Aluka
  # 用 cmd 重定向，避免 PowerShell ReadLine 阻塞
  $cmd = "npm start > `"$log`" 2>&1"
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -WorkingDirectory $App -PassThru -WindowStyle Hidden

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $hostReady = $false
  $uiReady = $false

  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    Start-Sleep -Milliseconds 300
    if (Test-Path $log) {
      $text = Get-Content -Path $log -Raw -ErrorAction SilentlyContinue
      if ($text) {
        if ($text -match "host ready \(phase") { $hostReady = $true }
        if ($text -match "ui-ready") { $uiReady = $true }
      }
    }
    if ($hostReady -and $uiReady) { break }
    if ($p.HasExited -and -not ($hostReady -and $uiReady)) {
      $dump = if (Test-Path $log) { Get-Content $log -Raw } else { "(no log)" }
      throw "process exited early (code=$($p.ExitCode))`n$dump"
    }
  }

  Get-Process -Name "aluka" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if (-not $p.HasExited) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  }

  if (-not $hostReady) { throw "timeout: host ready not seen (log: $log)" }
  if (-not $uiReady) { throw "timeout: ui-ready not seen (log: $log)" }
  Write-Host "[smoke] OK host+ui ready within $($sw.Elapsed.TotalSeconds.ToString('0.0'))s"
  if (Test-Path $log) {
    Write-Host "[smoke] log: $log"
  }
  exit 0
}
finally {
  Pop-Location
}
