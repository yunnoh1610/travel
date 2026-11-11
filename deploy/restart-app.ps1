<#
  공개 중인 앱 서버만 다시 켜서 고친 코드를 반영해요. Cloudflare 터널(공개 주소)은 그대로예요.
  start-tunnel.ps1 이 켜져 있을 때만 의미가 있어요. (그 창이 서버를 자동으로 다시 켬)

  사용법:
    powershell -ExecutionPolicy Bypass -File deploy\restart-app.ps1
#>
param([int]$Port = 3002, [string]$DataDir = '')

$root = Split-Path -Parent $PSScriptRoot
if (-not $DataDir) { $DataDir = Join-Path $root 'data' }
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) { Write-Host "포트 $Port 에서 실행 중인 앱 서버가 없어요. start-tunnel.ps1 을 먼저 켜 주세요." -ForegroundColor Yellow; exit 1 }

$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
if ($proc.Name -ne 'node.exe' -or $proc.CommandLine -notmatch 'server\.js') {
  Write-Host "포트 $Port 를 쓰는 프로그램이 이 앱이 아니에요: $($proc.Name)" -ForegroundColor Yellow; exit 1
}

Write-Host '▶ 앱 서버를 끄면 start-tunnel 창이 새 코드로 다시 켜요...' -ForegroundColor Cyan
Stop-Process -Id $proc.ProcessId -Force

for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/healthz").StatusCode -eq 200) {
      $url = Get-Content (Join-Path $DataDir 'public-url.txt') -ErrorAction SilentlyContinue
      Write-Host "✔ 다시 켜졌어요. 공개 주소는 그대로예요: $url" -ForegroundColor Green
      exit 0
    }
  } catch { }
}
Write-Host '✖ 20초 안에 다시 켜지지 않았어요. start-tunnel 창의 메시지를 확인해 주세요.' -ForegroundColor Red
exit 1
