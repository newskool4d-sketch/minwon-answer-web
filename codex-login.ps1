param(
  # The app passes its own app-only folder; run by hand, the default below is the same folder.
  [string]$CodexHome = (Join-Path $env:LOCALAPPDATA 'minwon-answer\codex-home'),
  # Keeps the window open at the end so the result can be read when the app opened this window.
  [switch]$Pause
)
$ErrorActionPreference = 'Stop'
$minwonCodexHome = $CodexHome
$minwonCodexPackage = Join-Path $env:APPDATA 'npm\node_modules\@openai\codex'
# Same candidates as server/providers.mjs: npm vendor binary first, then the official standalone install.
$minwonCodexNpmExe = Join-Path $minwonCodexPackage 'node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
$minwonCodexStandaloneExe = Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe'
$previousMinwonCodexHome = $env:CODEX_HOME
$previousMinwonPackageRoot = $env:CODEX_MANAGED_PACKAGE_ROOT
$previousMinwonManagedByNpm = $env:CODEX_MANAGED_BY_NPM
$minwonLoginFailed = $false
try {
  if (Test-Path -LiteralPath $minwonCodexNpmExe -PathType Leaf) { $minwonCodexExe = $minwonCodexNpmExe; $minwonCodexByNpm = $true }
  elseif (Test-Path -LiteralPath $minwonCodexStandaloneExe -PathType Leaf) { $minwonCodexExe = $minwonCodexStandaloneExe; $minwonCodexByNpm = $false }
  else { throw '공식 Codex CLI를 찾지 못했습니다. 자동 설치하지 않습니다. 설치 명령: npm install -g @openai/codex@0.160.0' }
  if ((Test-Path -LiteralPath (Join-Path $minwonCodexHome 'AGENTS.md')) -or (Test-Path -LiteralPath (Join-Path $minwonCodexHome 'AGENTS.override.md'))) { throw '앱 전용 Codex 폴더의 지침 파일을 확인해 주세요. 자동으로 수정하지 않습니다.' }
  Write-Host '민원답변 도우미 전용 Codex 로그인을 시작합니다. 브라우저에서 공식 ChatGPT 로그인을 완료해 주세요.'
  New-Item -ItemType Directory -Path $minwonCodexHome -Force | Out-Null
  $env:CODEX_HOME = $minwonCodexHome
  if ($minwonCodexByNpm) {
    $env:CODEX_MANAGED_PACKAGE_ROOT = $minwonCodexPackage
    $env:CODEX_MANAGED_BY_NPM = '1'
  } else {
    Remove-Item Env:CODEX_MANAGED_PACKAGE_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:CODEX_MANAGED_BY_NPM -ErrorAction SilentlyContinue
  }
  & $minwonCodexExe login
  if ($LASTEXITCODE -ne 0) { throw 'Codex 로그인이 완료되지 않았습니다. 공식 로그인 화면을 확인해 주세요.' }
  Write-Host ''
  Write-Host 'Codex 로그인을 마쳤습니다. 민원답변 도우미의 AI 연결 설정에서 ‘연결 상태 다시 확인’을 눌러 주세요.' -ForegroundColor Green
} catch {
  # Show the reason before the window closes instead of an unreadable error record.
  $minwonLoginFailed = $true
  Write-Host ''
  Write-Host ('오류: ' + $_.Exception.Message) -ForegroundColor Red
} finally {
  if ($null -eq $previousMinwonCodexHome) { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue } else { $env:CODEX_HOME = $previousMinwonCodexHome }
  if ($null -eq $previousMinwonPackageRoot) { Remove-Item Env:CODEX_MANAGED_PACKAGE_ROOT -ErrorAction SilentlyContinue } else { $env:CODEX_MANAGED_PACKAGE_ROOT = $previousMinwonPackageRoot }
  if ($null -eq $previousMinwonManagedByNpm) { Remove-Item Env:CODEX_MANAGED_BY_NPM -ErrorAction SilentlyContinue } else { $env:CODEX_MANAGED_BY_NPM = $previousMinwonManagedByNpm }
  if ($Pause) {
    Write-Host ''
    [void](Read-Host 'Enter 키를 누르면 이 창을 닫습니다')
  }
}
if ($minwonLoginFailed) { exit 1 }
