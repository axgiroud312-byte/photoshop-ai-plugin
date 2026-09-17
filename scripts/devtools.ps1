param(
    [ValidateSet('Install', 'Enable', 'Start', 'Apps', 'LoadProbe')]
    [string]$Action = 'Apps'
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolRoot = Join-Path $repoRoot '.local\uxp-tools'
$cli = Join-Path $toolRoot 'node_modules\@adobe\uxp-devtools-cli\src\uxp.js'

if ($Action -eq 'Install') {
    & npm install --prefix $toolRoot --package-lock=false --no-save --ignore-scripts '@adobe/uxp-devtools-cli@1.2.0' 'tar@7.5.22'
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $helperRoot = Join-Path $toolRoot 'node_modules\@adobe\uxp-devtools-helper'
    $helperBuild = [IO.Path]::GetFullPath((Join-Path $helperRoot 'build'))
    if (-not $helperBuild.StartsWith(($repoRoot + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Helper output must remain inside this project.'
    }
    # Adobe setup recreates only this validated helper build directory.
    & node (Join-Path $helperRoot 'scripts\devtools_setup.js')
    exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $cli)) {
    throw '先运行 scripts/devtools.ps1 -Action Install 安装项目本地开发工具。'
}
switch ($Action) {
    'Enable' { & node $cli devtools enable }
    'Start' { & node $cli service start }
    'Apps' { & node $cli apps list }
    'LoadProbe' { & node $cli plugin load --manifest (Join-Path $repoRoot 'tools\uxp-probe\manifest.json') --apps PS }
}
exit $LASTEXITCODE
