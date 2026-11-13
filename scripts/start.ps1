param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command node.exe).Source
$serverProcess = Start-Process -FilePath $nodePath -ArgumentList @('--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$healthUrl = 'http://127.0.0.1:3101'
$appUrl = 'http://localhost:3101'
$ready = $false
try {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($serverProcess.HasExited) { throw "GenshinDex server exited with code $($serverProcess.ExitCode)." }
    try {
      $response = Invoke-RestMethod -Uri "$healthUrl/health" -TimeoutSec 1
      if ($response.data.status -eq 'ok') { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw 'GenshinDex did not become ready on http://localhost:3101.' }
  if (-not $NoBrowser) { Start-Process $appUrl }
  Write-Host 'GenshinDex is running at http://localhost:3101. Press Ctrl+C here to stop it.'
  while (-not $serverProcess.HasExited) { Start-Sleep -Seconds 1 }
} finally {
  if (-not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
}
