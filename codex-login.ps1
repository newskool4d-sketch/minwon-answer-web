$ErrorActionPreference = 'Stop'
$minwonCodexHome = Join-Path $env:LOCALAPPDATA 'minwon-answer\codex-home'
$minwonCodexPackage = Join-Path $env:APPDATA 'npm\node_modules\@openai\codex'
# Same candidates as server/providers.mjs: npm vendor binary first, then the official standalone install.
$minwonCodexNpmExe = Join-Path $minwonCodexPackage 'node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
$minwonCodexStandaloneExe = Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe'
if (Test-Path -LiteralPath $minwonCodexNpmExe -PathType Leaf) { $minwonCodexExe = $minwonCodexNpmExe; $minwonCodexByNpm = $true }
elseif (Test-Path -LiteralPath $minwonCodexStandaloneExe -PathType Leaf) { $minwonCodexExe = $minwonCodexStandaloneExe; $minwonCodexByNpm = $false }
else { throw '공식 Codex CLI를 찾지 못했습니다. 자동 설치하지 않습니다. 설치 명령: npm install -g @openai/codex@0.160.0' }
if ((Test-Path -LiteralPath (Join-Path $minwonCodexHome 'AGENTS.md')) -or (Test-Path -LiteralPath (Join-Path $minwonCodexHome 'AGENTS.override.md'))) { throw '앱 전용 Codex 폴더의 지침 파일을 확인해 주세요. 자동으로 수정하지 않습니다.' }
$previousMinwonCodexHome = $env:CODEX_HOME
$previousMinwonPackageRoot = $env:CODEX_MANAGED_PACKAGE_ROOT
$previousMinwonManagedByNpm = $env:CODEX_MANAGED_BY_NPM
try {
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
} finally {
  if ($null -eq $previousMinwonCodexHome) { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue } else { $env:CODEX_HOME = $previousMinwonCodexHome }
  if ($null -eq $previousMinwonPackageRoot) { Remove-Item Env:CODEX_MANAGED_PACKAGE_ROOT -ErrorAction SilentlyContinue } else { $env:CODEX_MANAGED_PACKAGE_ROOT = $previousMinwonPackageRoot }
  if ($null -eq $previousMinwonManagedByNpm) { Remove-Item Env:CODEX_MANAGED_BY_NPM -ErrorAction SilentlyContinue } else { $env:CODEX_MANAGED_BY_NPM = $previousMinwonManagedByNpm }
}
