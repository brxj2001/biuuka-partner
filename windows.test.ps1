$ErrorActionPreference = 'Stop'
$Count = 0
foreach ($Name in @('windows.ps1','run.ps1','tray-windows.ps1','chatgpt-install.ps1','uninstall-windows.ps1','desktop-switch.ps1')) {
    $Tokens = $null; $Errors = $null
    $Ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $Name), [ref]$Tokens, [ref]$Errors)
    if ($Errors.Count) { throw ($Errors | Out-String) }; $Count++
    if ($Name -eq 'uninstall-windows.ps1') { foreach ($Function in $Ast.FindAll({ param($N) $N -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { Invoke-Expression $Function.Extent.Text } }
    if ($Name -eq 'windows.ps1') {
        foreach ($Function in $Ast.FindAll({ param($N) $N -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $N.Name -in @('Read-Json','Verify','Write-Json','Get-Dependency') }, $true)) { Invoke-Expression $Function.Extent.Text }
    }
}
$TestBase = if ($IsMacOS) { '/private/tmp' } else { [IO.Path]::GetTempPath() }
$Folder = Join-Path $TestBase ('biuuka-verify-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $Folder | Out-Null
try {
    $State = Join-Path $Folder 'state'; $Utf8 = New-Object Text.UTF8Encoding($false)
    $PriorOfflineDir = $env:BIUUKA_OFFLINE_DIR; $PriorOfflineOnly = $env:BIUUKA_OFFLINE_ONLY
    try {
        $env:BIUUKA_OFFLINE_DIR = $Folder; $env:BIUUKA_OFFLINE_ONLY = '1'
        [IO.File]::WriteAllText((Join-Path $Folder 'node-cache'), 'verified fixture')
        $Source = @{ cacheFile='node-cache'; digest=(Get-FileHash (Join-Path $Folder 'node-cache')).Hash.ToLowerInvariant() }
        Get-Dependency $Source (Join-Path $Folder 'node-output'); $Count++
        if ((Get-Content -Raw (Join-Path $Folder 'node-output')) -ne 'verified fixture') { throw 'Offline cache not copied' }
        $Source.digest='invalid'; $Rejected=$false
        try { Get-Dependency $Source (Join-Path $Folder 'bad-output') } catch { $Rejected=$true }
        if (!$Rejected -or (Test-Path (Join-Path $Folder 'bad-output'))) { throw 'Corrupt offline cache accepted' }; $Count++
    } finally { $env:BIUUKA_OFFLINE_DIR=$PriorOfflineDir; $env:BIUUKA_OFFLINE_ONLY=$PriorOfflineOnly }
    [IO.File]::WriteAllText((Join-Path $Folder 'file.txt'), 'fixture')
    @(@{path='file.txt';sha256=(Get-FileHash (Join-Path $Folder 'file.txt')).Hash}) | ConvertTo-Json -AsArray | Set-Content (Join-Path $Folder 'manifest.json')
    $Hash = (Get-FileHash (Join-Path $Folder 'manifest.json')).Hash
    Verify $Folder $Hash; $Count++
    [IO.File]::WriteAllText((Join-Path $Folder 'file.txt'), 'tampered')
    $Rejected = $false; try { Verify $Folder $Hash } catch { $Rejected = $true }
    if (!$Rejected) { throw 'Tampered executable was accepted' }; $Count++
    @(@{path='../outside';sha256='x'}) | ConvertTo-Json -AsArray | Set-Content (Join-Path $Folder 'manifest.json')
    $Hash = (Get-FileHash (Join-Path $Folder 'manifest.json')).Hash
    $Rejected = $false; try { Verify $Folder $Hash } catch { $Rejected = $true }
    if (!$Rejected) { throw 'Path traversal accepted' }; $Count++
    $Owned = Join-Path $Folder 'owned'; $Codex = Join-Path $Folder 'codex'; New-Item -ItemType Directory $Owned,$Codex | Out-Null
    [IO.File]::WriteAllText((Join-Path $Codex 'auth.json'),'protected fixture')
    Assert-CleanupPath $Owned @($Codex); $Count++
    $Rejected=$false; try { Assert-CleanupPath $Owned @((Join-Path $Owned 'codex')) } catch { $Rejected=$true }
    if (!$Rejected) { throw 'Codex overlap was not rejected' }; $Count++
    New-Item -ItemType SymbolicLink -Path (Join-Path $Owned 'link') -Target $Codex | Out-Null
    Remove-OwnedTree $Owned
    if ((Test-Path $Owned) -or (Get-Content -Raw (Join-Path $Codex 'auth.json')) -ne 'protected fixture') { throw 'Cleanup followed link or left data behind' }; $Count++
} finally { Remove-Item -LiteralPath $Folder -Recurse -Force }
Write-Host "$Count PowerShell parsing and integrity checks passed. SCM and UAC require Windows."

& (Join-Path $PSScriptRoot 'tray-state.test.ps1')

& (Join-Path $PSScriptRoot 'desktop-switch.test.ps1')
