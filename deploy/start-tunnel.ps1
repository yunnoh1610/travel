<#
  PC에서 여행 기록 앱을 켜고, Cloudflare 무료 임시 터널로 인터넷에 공개해요.
  친구들은 화면에 나오는 https://....trycloudflare.com 주소로 접속하면 돼요.

  사용법 (travel_diary 폴더의 PowerShell에서):
    powershell -ExecutionPolicy Bypass -File deploy\start-tunnel.ps1

  끄기: 이 창에서 Ctrl+C (서버와 터널이 같이 꺼져요)

  앱을 고친 뒤 반영하기 (공개 주소는 그대로 유지):
    powershell -ExecutionPolicy Bypass -File deploy\restart-app.ps1
    → 앱 서버만 꺼지고, 이 창이 알아서 새 코드로 다시 켜요.

  알아둘 점
  - 이 창이 켜져 있고 PC가 깨어 있는 동안만 접속돼요. (실행 중에는 PC가 절전모드로 가지 않게 막아요)
  - 이 창을 껐다 다시 켜면 주소가 바뀌어요. 예전 주소로 만든 초대 링크는 안 열리니 새로 보내 주세요.
#>
param([int]$Port = 3002, [string]$DataDir = '')

function Fail($msg) { Write-Host "`n✖ $msg" -ForegroundColor Red; exit 1 }

$root = Split-Path -Parent $PSScriptRoot
$dataDir = if ($DataDir) { $DataDir } else { Join-Path $root 'data' }
New-Item -ItemType Directory -Force $dataDir | Out-Null

# ---------- cloudflared 찾기 (winget으로 막 설치하면 PATH가 아직 안 바뀌었을 수 있음) ----------
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe'),
    (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe')
  )
  $candidates += Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter cloudflared*.exe -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName }
  $cf = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $cf) { Fail 'cloudflared가 없어요. 먼저 설치해 주세요:  winget install Cloudflare.cloudflared' }

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Fail "포트 $Port 를 이미 다른 프로그램이 쓰고 있어요. 그 서버를 끄거나  -Port 3005  처럼 다른 번호로 실행해 주세요."
}

# ---------- 실행 중엔 PC 절전 막기 ----------
try {
  Add-Type -Namespace TravelDiary -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
  [void][TravelDiary.Power]::SetThreadExecutionState([uint32]'0x80000001') # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
} catch { Write-Host '※ 절전 방지 설정을 못 했어요. PC가 잠들면 접속이 끊겨요.' -ForegroundColor Yellow }

# ---------- 앱 서버 (운영 모드, PC 안에서만 접속 가능 → 바깥은 터널로만) ----------
$env:NODE_ENV = 'production'
$env:HOST = '127.0.0.1'
$env:PORT = "$Port"
$env:DATA_DIR = $dataDir
$env:TRUST_PROXY = '1'
$logOut = Join-Path $dataDir 'server.log'
$logErr = Join-Path $dataDir 'server-error.log'

function Start-App {
  $p = Start-Process -FilePath node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $logOut -RedirectStandardError $logErr
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if ($p.HasExited) { break }
    try {
      if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/healthz").StatusCode -eq 200) { return $p }
    } catch { }
  }
  Get-Content $logErr -ErrorAction SilentlyContinue | Select-Object -Last 15
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  return $null
}

Write-Host "`n▶ 앱 서버 켜는 중 (포트 $Port)" -ForegroundColor Cyan
$server = Start-App
if (-not $server) { Fail "앱 서버가 켜지지 않았어요. 위 오류 내용을 확인해 주세요. (로그: $logErr)" }
Write-Host '✔ 앱 서버 실행 중' -ForegroundColor Green

# ---------- 터널 열기 ----------
Write-Host '▶ Cloudflare 터널 여는 중 (10초 정도 걸려요)' -ForegroundColor Cyan
$tunLog = Join-Path $dataDir 'tunnel.log'
$tunOut = Join-Path $dataDir 'tunnel-out.log'
$urlFile = Join-Path $dataDir 'public-url.txt'
$tunnel = Start-Process -FilePath $cf -ArgumentList 'tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port" `
  -WindowStyle Hidden -PassThru -RedirectStandardError $tunLog -RedirectStandardOutput $tunOut

$url = $null
$failures = 0
try {
  while ($true) {
    Start-Sleep -Seconds 2

    if (-not $url) {
      $m = Select-String -Path $tunLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($m) {
        $url = $m.Matches[0].Value
        Set-Content -Path $urlFile -Value $url -Encoding ASCII
        Write-Host ''
        Write-Host '==============================================================' -ForegroundColor Green
        Write-Host "  공개 주소:  $url" -ForegroundColor Green
        Write-Host '  친구들에게 이 주소를 보내거나, 앱에서 초대 링크를 만들어 보내세요.' -ForegroundColor Green
        Write-Host '  끄려면 이 창에서 Ctrl+C' -ForegroundColor Green
        Write-Host '==============================================================' -ForegroundColor Green
      }
    }

    if ($tunnel.HasExited) {
      Write-Host "`n✖ 터널이 끊겼어요. 최근 기록:" -ForegroundColor Red
      Get-Content $tunLog -Tail 10 -ErrorAction SilentlyContinue
      break
    }

    # 앱 서버가 꺼졌으면 (restart-app.ps1 로 껐거나 오류로 죽었으면) 새 코드로 다시 켬. 터널 주소는 그대로.
    if ($server.HasExited) {
      Write-Host "`n▶ $(Get-Date -Format 'HH:mm:ss')  앱 서버를 다시 켜요 (공개 주소는 그대로)" -ForegroundColor Cyan
      $server = Start-App
      if ($server) {
        $failures = 0
        Write-Host '✔ 앱 서버 실행 중' -ForegroundColor Green
      } else {
        $failures++
        if ($failures -ge 3) { Write-Host '✖ 앱 서버가 계속 안 켜져서 멈춰요. 오류 내용을 확인해 주세요.' -ForegroundColor Red; break }
        $server = [pscustomobject]@{ HasExited = $true; Id = 0 }
        Start-Sleep -Seconds 5
      }
    }
  }
} finally {
  Write-Host "`n▶ 끄는 중..." -ForegroundColor Cyan
  if ($server -and $server.Id -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item $urlFile -ErrorAction SilentlyContinue
  Write-Host '✔ 서버와 터널을 껐어요.' -ForegroundColor Green
}
