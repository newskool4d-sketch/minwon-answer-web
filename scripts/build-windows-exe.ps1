[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Get-Sha256Hex([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToUpperInvariant()
    }
    finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'package.json version must be a stable x.y.z version.' }

$outputRoot = Join-Path $root 'release-output'
if (-not (Test-Path -LiteralPath $outputRoot)) { New-Item -ItemType Directory -Path $outputRoot | Out-Null }
$exeName = "minwon-answer-$version-win-x64.exe"
$exePath = Join-Path $outputRoot $exeName
$hashPath = "$exePath.sha256"
if (Test-Path -LiteralPath $exePath) { throw "Build output already exists; preserve it or remove that exact file before rebuilding: $exePath" }
if (Test-Path -LiteralPath $hashPath) { throw "Checksum output already exists; preserve it or remove that exact file before rebuilding: $hashPath" }

$runtimeCommand = Get-Command node.exe -ErrorAction Stop
$runtimePath = $runtimeCommand.Source
$runtimeVersion = (& $runtimePath --version).Trim()
$expectedRuntimeVersion = 'v24.14.1'
$expectedRuntimeHash = '58E74BF02FC5BBACC41DCB8BEF089961CD5BDDD37830B87784E4FC624D145D1F'
$runtimeHash = Get-Sha256Hex $runtimePath
$runtimeSignature = 'Verified by exact official release SHA-256'
if ($runtimeVersion -ne $expectedRuntimeVersion -or $runtimeHash -ne $expectedRuntimeHash) {
    throw 'Bundled Node.js must be the verified OpenJS Foundation v24.14.1 Windows x64 runtime.'
}

$licensePath = Join-Path $root 'licenses\nodejs-v24.14.1-LICENSE.txt'
if (-not (Test-Path -LiteralPath $licensePath)) { throw "Missing bundled Node.js license: $licensePath" }

# WebView2 SDK from nuget.org (Microsoft-signed); only these three files are shipped next to the installed launcher.
$webViewVersion = '1.0.4258.31'
$webViewRoot = Join-Path $root "vendor\webview2\$webViewVersion"
$webViewFiles = [ordered]@{
    'Microsoft.Web.WebView2.Core.dll'     = 'D60E6E94245078CB56E44EBD5F360DC04BF18E460136BE93BFC4CFCA43B98505'
    'Microsoft.Web.WebView2.WinForms.dll' = '6A9E6856F23C463783C3AFB0CA5D78F56324C86657162CCB16D5227B3233B32A'
    'WebView2Loader.dll'                  = '3426DCC55FDFB8B5E7AC623CF33B4CCF283FBF68A0C5A65BDDFDB4D749A8ABEE'
}
foreach ($name in $webViewFiles.Keys) {
    $file = Join-Path $webViewRoot $name
    if (-not (Test-Path -LiteralPath $file)) { throw "Missing WebView2 SDK file: $file" }
    if ((Get-Sha256Hex $file) -ne $webViewFiles[$name]) { throw "WebView2 SDK file does not match the pinned SHA-256: $name" }
}
$webViewLicensePath = Join-Path $root "licenses\webview2-sdk-$webViewVersion-LICENSE.txt"
if (-not (Test-Path -LiteralPath $webViewLicensePath)) { throw "Missing WebView2 SDK license: $webViewLicensePath" }
$sourcePath = Join-Path $PSScriptRoot 'windows-launcher.cs'
if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Missing Windows launcher source: $sourcePath" }

$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compilerPath = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compilerPath) { throw 'The built-in .NET Framework C# compiler was not found.' }
$frameworkDir = Split-Path -Parent $compilerPath
$compressionAssembly = Join-Path $frameworkDir 'System.IO.Compression.dll'
$formsAssembly = Join-Path $frameworkDir 'System.Windows.Forms.dll'
$drawingAssembly = Join-Path $frameworkDir 'System.Drawing.dll'
foreach ($assembly in @($compressionAssembly, $formsAssembly, $drawingAssembly)) {
    if (-not (Test-Path -LiteralPath $assembly)) { throw "The built-in .NET Framework assembly was not found: $assembly" }
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("minwon-answer-build-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$success = $false
try {
    $payloadRoot = Join-Path $tempRoot 'payload'
    New-Item -ItemType Directory -Path $payloadRoot | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $payloadRoot 'runtime') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $payloadRoot 'licenses') | Out-Null

    Copy-Item -LiteralPath (Join-Path $root 'server') -Destination $payloadRoot -Recurse
    Copy-Item -LiteralPath (Join-Path $root 'public') -Destination $payloadRoot -Recurse
    Copy-Item -LiteralPath (Join-Path $root 'codex-login.ps1') -Destination $payloadRoot
    Copy-Item -LiteralPath $licensePath -Destination (Join-Path $payloadRoot 'licenses')
    Copy-Item -LiteralPath $webViewLicensePath -Destination (Join-Path $payloadRoot 'licenses')
    foreach ($name in $webViewFiles.Keys) { Copy-Item -LiteralPath (Join-Path $webViewRoot $name) -Destination $payloadRoot }
    Copy-Item -LiteralPath $runtimePath -Destination (Join-Path $payloadRoot 'runtime\node.exe')
    [IO.File]::WriteAllText((Join-Path $payloadRoot 'app-version.txt'), "$version`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $payloadRoot 'runtime-version.txt'), "$runtimeVersion`n", [Text.UTF8Encoding]::new($false))

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipPath = Join-Path $tempRoot 'MinwonPayload.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($payloadRoot, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
    $versionPath = Join-Path $tempRoot 'MinwonVersion.txt'
    [IO.File]::WriteAllText($versionPath, "$version`n", [Text.UTF8Encoding]::new($false))
    # Build identity: a rebuilt EXE of the same version installs beside, never runs, an older install.
    $buildId = (Get-Sha256Hex $zipPath).Substring(0, 12).ToLowerInvariant()
    $buildPath = Join-Path $tempRoot 'MinwonBuild.txt'
    [IO.File]::WriteAllText($buildPath, "$buildId`n", [Text.UTF8Encoding]::new($false))

    $compilerArguments = @(
        '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/debug-', '/codepage:65001',
        "/out:$exePath",
        "/reference:$compressionAssembly",
        "/reference:$formsAssembly",
        "/reference:$drawingAssembly",
        "/reference:$(Join-Path $webViewRoot 'Microsoft.Web.WebView2.Core.dll')",
        "/reference:$(Join-Path $webViewRoot 'Microsoft.Web.WebView2.WinForms.dll')",
        "/resource:$zipPath,MinwonPayload.zip",
        "/resource:$versionPath,MinwonVersion.txt",
        "/resource:$buildPath,MinwonBuild.txt",
        $sourcePath
    )
    & $compilerPath @compilerArguments
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exePath)) { throw "C# launcher build failed with exit code $LASTEXITCODE." }

    # The launcher is a windowed program, so its self-test output is read back from redirected files.
    $testOutput = Join-Path $tempRoot 'self-test.out.txt'
    $testError = Join-Path $tempRoot 'self-test.err.txt'
    $test = Start-Process -FilePath $exePath -ArgumentList '--self-test' -PassThru -Wait -NoNewWindow -RedirectStandardOutput $testOutput -RedirectStandardError $testError
    foreach ($log in @($testOutput, $testError)) { if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Encoding UTF8 | Write-Output } }
    if ($test.ExitCode -ne 0) { throw "Packaged executable self-test failed with exit code $($test.ExitCode)." }

    $sha256 = (Get-Sha256Hex $exePath).ToLowerInvariant()
    [IO.File]::WriteAllText($hashPath, "$sha256  $exeName`n", [Text.UTF8Encoding]::new($false))
    $size = (Get-Item -LiteralPath $exePath).Length
    Write-Output "EXE=$exePath"
    Write-Output "VERSION=$version"
    Write-Output "BUILD=$buildId"
    Write-Output "SIZE_BYTES=$size"
    Write-Output "SHA256=$sha256"
    Write-Output 'SIGNATURE=NotSigned (no signing certificate configured)'
    Write-Output "RUNTIME=$runtimeVersion ($runtimeHash; $runtimeSignature)"
    Write-Output "WEBVIEW2_SDK=$webViewVersion (pinned SHA-256 verified)"
    $success = $true
}
finally {
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $tempFull = [IO.Path]::GetFullPath($tempRoot)
    if (-not $tempFull.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove a build directory outside the system temp folder.' }
    if (Test-Path -LiteralPath $tempFull) { Remove-Item -LiteralPath $tempFull -Recurse -Force }
    if (-not $success) { Write-Output 'Build did not complete; generated output files were preserved for inspection.' }
}
