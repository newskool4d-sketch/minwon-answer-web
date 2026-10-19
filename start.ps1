$ErrorActionPreference = 'Stop'
& node (Join-Path -Path $PSScriptRoot -ChildPath 'server/index.mjs')
